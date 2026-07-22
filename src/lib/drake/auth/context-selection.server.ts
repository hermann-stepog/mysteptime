import "@tanstack/react-start/server-only";
import path from "node:path";
import type { Frame, Locator, Page } from "playwright";
import { env } from "../config.server";
import { ensureParentDirectory } from "../drake-files.server";
import { getScreenshotsDir } from "../filesystem.server";
import { logger } from "../logger";
import { sanitizeError } from "../sanitize-error.server";
import { dumpContextControls, isExactContextLabel } from "./context-diagnostics.server";
import { hasFilledPasswordField } from "./login-diagnostics.server";
import { findPasswordField, type LocatedElement, usableFrames } from "./locate.server";

const CONTEXT_HINTS =
  /empresa|company|ambiente|environment|configura[cç][aã]o|configuration|contexto|context|\bbase\b/i;

const CONTEXT_CONTINUE_NAMES =
  /continuar|continue|entrar|acessar|prosseguir|avan[cç]ar|avancar|next|selecionar|confirmar/i;

const AVOID_CONTEXT_BUTTONS = /voltar|cancelar|sair|logout|configura[cç][aã]o|configuration/i;

const ACCESSIBLE_COMBO_SELECTORS = [
  '[role="combobox"]',
  'input[role="combobox"]',
  'button[role="combobox"]',
  '[aria-haspopup="listbox"]',
] as const;

const OPTION_SELECTORS = [
  '[role="option"]',
  '[role="menuitem"]',
  '[role="listitem"]',
  ".mat-mdc-option",
  ".mat-option",
  ".ng-option",
  ".select2-results__option",
  ".react-select__option",
  ".dropdown-item",
  "li",
] as const;

type RankedOption = {
  locator: Locator;
  score: number;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoginUrl(url: string): boolean {
  return url.toLowerCase().includes("/logon");
}

export function isAuthenticatedRoute(url: string): boolean {
  if (isLoginUrl(url)) {
    return false;
  }
  try {
    const current = new URL(url);
    return current.pathname.includes("/m/");
  } catch {
    return url.includes("/m/");
  }
}

async function pageBodyText(page: Page): Promise<string> {
  const chunks: string[] = [];
  for (const frame of usableFrames(page)) {
    chunks.push(
      await frame
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  return chunks.join("\n");
}

async function highlightLocator(locator: Locator, color: string): Promise<() => Promise<void>> {
  if (!env.DRAKE_CONTEXT_DEBUG) {
    return async () => undefined;
  }

  await locator
    .evaluate((el, borderColor) => {
      const element = el as HTMLElement;
      element.dataset["drakePrevOutline"] = element.style.outline;
      element.style.outline = `3px solid ${borderColor}`;
    }, color)
    .catch(() => undefined);

  return async () => {
    await locator
      .evaluate((el) => {
        const element = el as HTMLElement;
        element.style.outline = element.dataset["drakePrevOutline"] ?? "";
        delete element.dataset["drakePrevOutline"];
      })
      .catch(() => undefined);
  };
}

async function maybeScreenshot(page: Page, prefix: string): Promise<void> {
  if (!env.DRAKE_DIAGNOSTICS_ENABLED && !env.DRAKE_CONTEXT_DEBUG) {
    return;
  }
  if (await hasFilledPasswordField(page)) {
    logger.info("Screenshot de contexto omitida: senha preenchida");
    return;
  }

  const filePath = path.resolve(getScreenshotsDir(), `${prefix}.png`);
  await ensureParentDirectory(filePath);
  await page.screenshot({ path: filePath, fullPage: true });
  logger.info({ file: `${prefix}.png` }, "Screenshot de contexto salva");
}

async function clickReliable(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await locator.click({ timeout: 3_000 });
  } catch {
    await locator.click({ force: true, timeout: 3_000 });
  }
}

type NativeSelectMatch = {
  frame: Frame;
  select: Locator;
  value: string;
  labelScore: number;
};

async function scoreSelectByNearbyLabel(select: Locator): Promise<number> {
  const nearby = await select
    .evaluate((el) => {
      const element = el as HTMLElement;
      const id = element.getAttribute("id");
      const parts: string[] = [];
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) {
          parts.push(label.textContent ?? "");
        }
      }
      const parentLabel = element.closest("label");
      if (parentLabel) {
        parts.push(parentLabel.textContent ?? "");
      }
      const prev = element.previousElementSibling;
      if (prev) {
        parts.push(prev.textContent ?? "");
      }
      parts.push(element.getAttribute("aria-label") ?? "");
      parts.push(element.getAttribute("name") ?? "");
      return parts.join(" ");
    })
    .catch(() => "");

  return CONTEXT_HINTS.test(nearby) ? 10 : 0;
}

async function collectNativeSelectsWithStep(page: Page): Promise<NativeSelectMatch[]> {
  const matches: NativeSelectMatch[] = [];

  for (const frame of usableFrames(page)) {
    const locator = frame.locator("select");
    const count = await locator.count().catch(() => 0);

    for (let i = 0; i < count; i += 1) {
      const select = locator.nth(i);
      const visible = await select.isVisible().catch(() => false);
      const enabled = await select.isEnabled().catch(() => false);
      if (!visible || !enabled) {
        continue;
      }

      const options = await select
        .locator("option")
        .evaluateAll((items) =>
          items.map((item) => {
            const option = item as HTMLOptionElement;
            return {
              value: option.value,
              label: (option.textContent ?? "").trim(),
            };
          }),
        )
        .catch(() => [] as Array<{ value: string; label: string }>);

      const matched = options.find((item) => isExactContextLabel(item.label));
      if (!matched) {
        continue;
      }

      matches.push({
        frame,
        select,
        value: matched.value,
        labelScore: await scoreSelectByNearbyLabel(select),
      });
    }
  }

  matches.sort((a, b) => b.labelScore - a.labelScore);
  return matches;
}

async function tryNativeSelect(page: Page): Promise<boolean> {
  const matches = await collectNativeSelectsWithStep(page);
  logger.info(`Quantidade de selects encontrados: ${matches.length}`);
  if (matches.length === 0) {
    return false;
  }

  logger.info("Select contendo Step encontrado");
  const best = matches[0];
  if (!best) {
    return false;
  }

  const clear = await highlightLocator(best.select, "red");
  if (env.DRAKE_CONTEXT_DEBUG) {
    await sleep(1_000);
  }

  await best.select.selectOption({ value: best.value });
  await best.select.evaluate((element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await clear();

  const selectedText = await best.select
    .evaluate((el) => {
      const selectEl = el as HTMLSelectElement;
      return (selectEl.selectedOptions[0]?.textContent ?? "").trim();
    })
    .catch(() => "");

  if (!isExactContextLabel(selectedText)) {
    return false;
  }

  logger.info("Selecao Step confirmada");
  return true;
}

async function collectComboboxCandidates(page: Page): Promise<LocatedElement[]> {
  const candidates: LocatedElement[] = [];
  const seen = new Set<string>();

  for (const frame of usableFrames(page)) {
    for (const selector of ACCESSIBLE_COMBO_SELECTORS) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        const enabled = await candidate.isEnabled().catch(() => false);
        if (!visible || !enabled) {
          continue;
        }

        const meta = await candidate
          .evaluate((el) => {
            const element = el as HTMLElement;
            return {
              id: element.id,
              ariaLabel: element.getAttribute("aria-label") ?? "",
              placeholder: element.getAttribute("placeholder") ?? "",
              text: (element.innerText || element.textContent || "").trim(),
              className: element.getAttribute("class") ?? "",
            };
          })
          .catch(() => null);

        if (!meta) {
          continue;
        }

        const key = `${frame.url()}|${selector}|${meta.id}|${meta.className}|${i}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        candidates.push({
          frame,
          locator: candidate,
          selectorDescription: `${selector} @ ${frame.url()}`,
        });
      }
    }

    const extras = [
      ".select2-selection",
      "mat-select",
      ".mat-select",
      ".mat-mdc-select",
      ".ng-select",
      ".react-select__control",
      '[class*="react-select__control"]',
    ];
    for (const selector of extras) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        if (!(await candidate.isVisible().catch(() => false))) {
          continue;
        }
        if (!(await candidate.isEnabled().catch(() => true))) {
          continue;
        }
        candidates.push({
          frame,
          locator: candidate,
          selectorDescription: `${selector} @ ${frame.url()}`,
        });
      }
    }
  }

  return candidates;
}

function rankCombobox(candidate: LocatedElement): Promise<number> {
  return candidate.locator
    .evaluate((el) => {
      const element = el as HTMLElement;
      const blob = [
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("placeholder") ?? "",
        element.innerText ?? "",
        element.className ?? "",
        element.getAttribute("name") ?? "",
        element.id ?? "",
      ].join(" ");
      return blob;
    })
    .then((blob) => (CONTEXT_HINTS.test(blob) ? 20 : 1))
    .catch(() => 1);
}

async function findExactStepOptions(page: Page): Promise<RankedOption[]> {
  const ranked: RankedOption[] = [];
  const expected = env.DRAKE_CONTEXT_NAME;

  for (const frame of usableFrames(page)) {
    const byRole = frame.getByRole("option", {
      name: new RegExp(`^${escapeRegExp(expected)}$`, "i"),
      exact: true,
    });
    const roleCount = await byRole.count().catch(() => 0);
    for (let i = 0; i < roleCount; i += 1) {
      const option = byRole.nth(i);
      if (!(await option.isVisible().catch(() => false))) {
        continue;
      }
      const text = (await option.innerText().catch(() => "")).trim();
      if (!isExactContextLabel(text)) {
        continue;
      }
      ranked.push({ locator: option, score: 100 });
    }

    for (const selector of OPTION_SELECTORS) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const option = locator.nth(i);
        if (!(await option.isVisible().catch(() => false))) {
          continue;
        }
        const text = (await option.innerText().catch(() => "")).trim();
        if (!isExactContextLabel(text)) {
          continue;
        }

        const role = await option.getAttribute("role").catch(() => null);
        const inListbox = await option
          .evaluate((el) =>
            Boolean(
              el.closest(
                '[role="listbox"], .cdk-overlay-pane, .select2-results, .react-select__menu',
              ),
            ),
          )
          .catch(() => false);
        const inMenu = await option
          .evaluate((el) => Boolean(el.closest('[role="menu"], .dropdown-menu')))
          .catch(() => false);

        let score = 10;
        if (role === "option") {
          score = 90;
        } else if (inListbox) {
          score = 80;
        } else if (inMenu) {
          score = 70;
        } else if (selector.includes("option") || selector.includes("dropdown-item")) {
          score = 60;
        }

        ranked.push({ locator: option, score });
      }
    }

    const filtered = frame
      .locator("*")
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(expected)}\\s*$`, "i") });
    const filteredCount = Math.min(await filtered.count().catch(() => 0), 40);
    for (let i = 0; i < filteredCount; i += 1) {
      const option = filtered.nth(i);
      if (!(await option.isVisible().catch(() => false))) {
        continue;
      }
      const text = (await option.innerText().catch(() => "")).trim();
      if (!isExactContextLabel(text)) {
        continue;
      }
      ranked.push({ locator: option, score: 20 });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickExactStepOption(page: Page): Promise<boolean> {
  const options = await findExactStepOptions(page);
  if (options.length === 0) {
    return false;
  }

  logger.info("Opcao Step visivel encontrada");
  const best = options[0];
  if (!best) {
    return false;
  }

  const clear = await highlightLocator(best.locator, "green");
  if (env.DRAKE_CONTEXT_DEBUG) {
    await sleep(1_000);
  }

  await clickReliable(best.locator);
  await clear();
  logger.info("Opcao Step clicada");
  return true;
}

async function openCombobox(locator: Locator, page: Page): Promise<void> {
  const clear = await highlightLocator(locator, "red");
  await maybeScreenshot(page, "context-before-open");
  if (env.DRAKE_CONTEXT_DEBUG) {
    await sleep(1_000);
  }
  await clickReliable(locator);
  await sleep(300 + Math.floor(Math.random() * 700));
  await maybeScreenshot(page, "context-opened");
  logger.info("Dropdown aberto");
  await clear();
}

async function tryAccessibleCombobox(page: Page): Promise<boolean> {
  const candidates = await collectComboboxCandidates(page);
  logger.info(`Quantidade de comboboxes encontrados: ${candidates.length}`);
  if (candidates.length === 0) {
    return false;
  }

  const ranked = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      score: await rankCombobox(candidate),
    })),
  );
  ranked.sort((a, b) => b.score - a.score);

  for (const item of ranked) {
    logger.info({ selector: item.candidate.selectorDescription }, "Combobox candidato encontrado");
    await openCombobox(item.candidate.locator, page);
    if (await clickExactStepOption(page)) {
      return true;
    }
  }

  return false;
}

async function trySelect2(page: Page): Promise<boolean> {
  for (const frame of usableFrames(page)) {
    const selection = frame.locator(".select2-selection").first();
    if (!(await selection.isVisible().catch(() => false))) {
      continue;
    }

    logger.info("Combobox candidato encontrado");
    await openCombobox(selection, page);
    await frame
      .locator(".select2-container--open")
      .first()
      .waitFor({ state: "visible", timeout: 3_000 })
      .catch(() => undefined);

    const search = frame.locator(".select2-search__field").first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(env.DRAKE_CONTEXT_NAME);
      await sleep(400);
    }

    const options = frame.locator(".select2-results__option");
    const count = await options.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const option = options.nth(i);
      if (!(await option.isVisible().catch(() => false))) {
        continue;
      }
      const text = (await option.innerText().catch(() => "")).trim();
      if (!isExactContextLabel(text)) {
        continue;
      }
      logger.info("Opcao Step visivel encontrada");
      await clickReliable(option);
      logger.info("Opcao Step clicada");
      return true;
    }
  }

  return false;
}

async function tryAngularMaterial(page: Page): Promise<boolean> {
  for (const frame of usableFrames(page)) {
    const trigger = frame
      .locator('mat-select, .mat-select, .mat-mdc-select, [role="combobox"]')
      .first();
    if (!(await trigger.isVisible().catch(() => false))) {
      continue;
    }

    logger.info("Combobox candidato encontrado");
    await openCombobox(trigger, page);

    for (const searchFrame of usableFrames(page)) {
      const options = searchFrame.locator(
        "mat-option, .mat-option, .mat-mdc-option, .cdk-overlay-container [role='option']",
      );
      const count = await options.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const option = options.nth(i);
        if (!(await option.isVisible().catch(() => false))) {
          continue;
        }
        const text = (await option.innerText().catch(() => "")).trim();
        if (!isExactContextLabel(text)) {
          continue;
        }
        logger.info("Opcao Step visivel encontrada");
        await clickReliable(option);
        logger.info("Opcao Step clicada");
        return true;
      }
    }
  }

  return false;
}

async function tryReactSelect(page: Page): Promise<boolean> {
  for (const frame of usableFrames(page)) {
    const control = frame
      .locator(".react-select__control, [class*='react-select__control'], [class*='-control']")
      .first();
    if (!(await control.isVisible().catch(() => false))) {
      continue;
    }

    logger.info("Combobox candidato encontrado");
    await openCombobox(control, page);

    const input = frame
      .locator(
        ".react-select__input input, input[class*='react-select'], [class*='-input'] input, input",
      )
      .first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill("");
      await input.pressSequentially(env.DRAKE_CONTEXT_NAME, { delay: 80 });
      await sleep(500);
    }

    if (!(await clickExactStepOption(page))) {
      continue;
    }
    return true;
  }

  return false;
}

async function tryKeyboardSelection(page: Page, combobox: Locator): Promise<boolean> {
  await combobox.focus().catch(() => undefined);
  await combobox.press("Home").catch(() => undefined);

  const tag = await combobox.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
  if (tag === "input" || tag === "textarea") {
    await combobox.fill(env.DRAKE_CONTEXT_NAME);
  } else {
    const innerInput = combobox.locator("input").first();
    if (await innerInput.isVisible().catch(() => false)) {
      await innerInput.fill(env.DRAKE_CONTEXT_NAME);
    } else {
      await combobox.pressSequentially(env.DRAKE_CONTEXT_NAME, { delay: 100 });
    }
  }

  await sleep(500);
  const options = await findExactStepOptions(page);
  if (options.length === 0) {
    return false;
  }

  logger.info("Opcao Step visivel encontrada");
  await combobox.press("Enter");
  logger.info("Opcao Step clicada");
  return true;
}

async function tryKeyboardFallback(page: Page): Promise<boolean> {
  const candidates = await collectComboboxCandidates(page);
  for (const candidate of candidates) {
    await openCombobox(candidate.locator, page);
    const clicked = await clickExactStepOption(page);
    if (clicked) {
      return true;
    }
    if (await tryKeyboardSelection(page, candidate.locator)) {
      return true;
    }

    // ArrowDown scan with verification
    for (let i = 0; i < 30; i += 1) {
      await candidate.locator.press("ArrowDown").catch(() => undefined);
      await sleep(150);
      const activeText = await page
        .locator(
          '[aria-selected="true"], .select2-results__option--highlighted, .mat-mdc-option-active, .react-select__option--is-focused',
        )
        .first()
        .innerText()
        .catch(() => "");
      if (isExactContextLabel(activeText)) {
        await candidate.locator.press("Enter");
        logger.info("Opcao Step clicada");
        return true;
      }
    }
  }

  return false;
}

async function isSelectionConfirmed(page: Page): Promise<boolean> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    for (const frame of usableFrames(page)) {
      const select = frame.locator("select");
      const selectCount = await select.count().catch(() => 0);
      for (let i = 0; i < selectCount; i += 1) {
        const text = await select
          .nth(i)
          .evaluate((el) => {
            const element = el as HTMLSelectElement;
            return (element.selectedOptions[0]?.textContent ?? "").trim();
          })
          .catch(() => "");
        if (isExactContextLabel(text)) {
          return true;
        }
      }

      const rendered = frame.locator(
        [
          ".select2-selection__rendered",
          ".mat-mdc-select-value-text",
          ".mat-select-value-text",
          ".react-select__single-value",
          '[class*="-singleValue"]',
          '[role="combobox"]',
        ].join(", "),
      );
      const renderedCount = await rendered.count().catch(() => 0);
      for (let i = 0; i < renderedCount; i += 1) {
        const el = rendered.nth(i);
        if (!(await el.isVisible().catch(() => false))) {
          continue;
        }
        const text = (
          (await el.innerText().catch(async () => el.inputValue().catch(() => ""))) ?? ""
        ).trim();
        if (isExactContextLabel(text)) {
          return true;
        }
      }

      const inputs = frame.locator("input");
      const inputCount = Math.min(await inputs.count().catch(() => 0), 30);
      for (let i = 0; i < inputCount; i += 1) {
        const value = await inputs
          .nth(i)
          .inputValue()
          .catch(() => "");
        if (isExactContextLabel(value)) {
          return true;
        }
      }
    }

    await sleep(250);
  }

  return false;
}

export async function findContextContinueButton(page: Page): Promise<LocatedElement | null> {
  for (const frame of usableFrames(page)) {
    const byRole = frame.getByRole("button", { name: CONTEXT_CONTINUE_NAMES });
    const roleCount = await byRole.count().catch(() => 0);
    for (let i = 0; i < roleCount; i += 1) {
      const button = byRole.nth(i);
      const text = (await button.innerText().catch(() => "")).trim();
      if (AVOID_CONTEXT_BUTTONS.test(text)) {
        continue;
      }
      const visible = await button.isVisible().catch(() => false);
      const enabled = await button.isEnabled().catch(() => false);
      if (visible && enabled) {
        return {
          frame,
          locator: button,
          selectorDescription: `role=button continue @ ${frame.url()}`,
        };
      }
    }
  }

  return null;
}

async function clickContextContinue(page: Page): Promise<boolean> {
  const button = await findContextContinueButton(page);
  if (!button) {
    return false;
  }

  logger.info("Confirmando entrada no contexto");
  await clickReliable(button.locator);
  await sleep(1_000);
  return true;
}

export async function isContextSelectionScreen(page: Page): Promise<boolean> {
  const body = await pageBodyText(page);
  const hasHints = CONTEXT_HINTS.test(body);
  const selects = await page
    .locator("select")
    .count()
    .catch(() => 0);
  const combos = (await collectComboboxCandidates(page)).length;
  const hasContinue = (await findContextContinueButton(page)) !== null;
  const hasStepText = (await findExactStepOptions(page)).length > 0;

  return (selects > 0 || combos > 0 || hasStepText) && (hasHints || hasStepText || hasContinue);
}

async function waitForContextUi(page: Page): Promise<boolean> {
  logger.info("Procurando dropdown de contexto");
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const selects = await page
      .locator("select")
      .count()
      .catch(() => 0);
    const combos = await collectComboboxCandidates(page);
    const body = await pageBodyText(page);
    const hasHints = CONTEXT_HINTS.test(body);
    const hasStep = (await findExactStepOptions(page)).length > 0;

    const enabledSelect = await page
      .locator("select")
      .evaluateAll((els) =>
        els.some((el) => {
          const select = el as HTMLSelectElement;
          const style = window.getComputedStyle(select);
          return style.visibility !== "hidden" && style.display !== "none" && !select.disabled;
        }),
      )
      .catch(() => false);

    if (
      (selects > 0 || combos.length > 0 || hasStep || hasHints) &&
      (enabledSelect || combos.length > 0 || hasStep)
    ) {
      logger.info("Tela de selecao de contexto detectada");
      return true;
    }

    await sleep(500);
  }

  return false;
}

async function runManualContextSelection(page: Page): Promise<void> {
  if (env.DRAKE_HEADLESS || !env.DRAKE_ALLOW_MANUAL_LOGIN) {
    throw new Error(
      "Nao foi possivel selecionar automaticamente o contexto Step e login manual nao esta disponivel.",
    );
  }

  console.log(
    [
      "",
      "Nao foi possivel selecionar automaticamente o contexto Step.",
      "Selecione Step manualmente no dropdown e confirme a entrada.",
      "A automacao continuara quando a area interna do Drake for carregada.",
      "",
    ].join("\n"),
  );

  const started = Date.now();
  while (Date.now() - started < 600_000) {
    if (
      isAuthenticatedRoute(page.url()) &&
      !(await isContextSelectionScreen(page)) &&
      !(await findPasswordField(page))
    ) {
      logger.info("Area autenticada do Drake carregada");
      return;
    }
    await sleep(1_000);
  }

  throw new Error("Timeout aguardando selecao manual do contexto Step / area interna do Drake.");
}

export async function selectDrakeContext(page: Page): Promise<void> {
  if (
    isAuthenticatedRoute(page.url()) &&
    !(await isContextSelectionScreen(page)) &&
    !(await findPasswordField(page))
  ) {
    return;
  }

  const ready = await waitForContextUi(page);
  if (!ready) {
    if (isAuthenticatedRoute(page.url()) && !(await findPasswordField(page))) {
      return;
    }
    await dumpContextControls(page);
    throw new Error("Tela de selecao de contexto nao apareceu.");
  }

  await dumpContextControls(page);
  logger.info("Diagnostico previo a selecao coletado");

  const strategies: Array<() => Promise<boolean>> = [
    () => tryNativeSelect(page),
    () => trySelect2(page),
    () => tryAngularMaterial(page),
    () => tryReactSelect(page),
    () => tryAccessibleCombobox(page),
    () => tryKeyboardFallback(page),
  ];

  let selected = false;
  for (const strategy of strategies) {
    try {
      selected = await strategy();
    } catch (error: unknown) {
      logger.warn({ error: sanitizeError(error) }, "Estrategia de contexto falhou");
      selected = false;
    }
    if (!selected) {
      continue;
    }

    if (await isSelectionConfirmed(page)) {
      logger.info("Selecao Step confirmada");
      await maybeScreenshot(page, "context-selected");
      break;
    }

    selected = false;
  }

  if (!selected) {
    await dumpContextControls(page);
    logger.warn("Falha ao selecionar Step");
    await runManualContextSelection(page);
    return;
  }

  const continued = await clickContextContinue(page);
  if (!continued) {
    logger.warn("Botao Continuar nao encontrado apos selecionar Step");
    await runManualContextSelection(page);
  }
}
