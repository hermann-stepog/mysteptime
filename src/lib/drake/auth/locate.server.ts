import "@tanstack/react-start/server-only";
import type { Frame, Locator, Page } from "playwright";

export interface LocatedElement {
  frame: Frame;
  locator: Locator;
  selectorDescription: string;
}

const EXCLUDED_IDENTITY_TERMS = /search|busca|filtro|filter|query|pesquisa/i;

const AVOID_BUTTON_TERMS =
  /voltar|back|cancelar|cancel|configura[cç][aã]o|configuration|esqueci|forgot|cadastrar|register/i;

const ACCEPT_BUTTON_TERMS =
  /entrar|acessar|login|sign\s*in|continuar|continue|pr[oó]ximo|proximo|next|avan[cç]ar|prosseguir|enviar|submit/i;

const USERNAME_SELECTORS_HIGH = [
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name="email" i]',
  'input[name="username" i]',
  'input[name="user" i]',
  'input[name="login" i]',
  'input[id*="email" i]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[placeholder*="email" i]',
  'input[placeholder*="e-mail" i]',
  'input[placeholder*="usuário" i]',
  'input[placeholder*="usuario" i]',
  'input[placeholder*="login" i]',
] as const;

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[name="password" i]',
  'input[name="senha" i]',
  'input[id*="password" i]',
  'input[id*="senha" i]',
  'input[placeholder*="password" i]',
  'input[placeholder*="senha" i]',
] as const;

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  '[role="button"]',
] as const;

function isFrameUsable(frame: Frame): boolean {
  try {
    return !frame.isDetached();
  } catch {
    return false;
  }
}

export function usableFrames(page: Page): Frame[] {
  return page.frames().filter(isFrameUsable);
}

async function isVisibleAndEnabled(locator: Locator): Promise<boolean> {
  try {
    const visible = await locator.isVisible({ timeout: 400 });
    if (!visible) {
      return false;
    }
    const enabled = await locator.isEnabled({ timeout: 400 });
    return enabled;
  } catch {
    return false;
  }
}

function identityFingerprint(attrs: {
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
}): string {
  return [attrs.name, attrs.id, attrs.placeholder].filter(Boolean).join(" ").toLowerCase();
}

async function readInputIdentity(locator: Locator): Promise<{
  name: string | null;
  id: string | null;
  placeholder: string | null;
}> {
  return locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    return {
      name: input.getAttribute("name"),
      id: input.getAttribute("id"),
      placeholder: input.getAttribute("placeholder"),
    };
  });
}

function isExcludedIdentity(attrs: {
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
}): boolean {
  return EXCLUDED_IDENTITY_TERMS.test(identityFingerprint(attrs));
}

async function collectMatchesInFrames(
  page: Page,
  selectors: readonly string[],
): Promise<LocatedElement[]> {
  const matches: LocatedElement[] = [];

  for (const frame of usableFrames(page)) {
    for (const selector of selectors) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        if (!(await isVisibleAndEnabled(candidate))) {
          continue;
        }

        const identity = await readInputIdentity(candidate).catch(() => ({
          name: null,
          id: null,
          placeholder: null,
        }));

        if (isExcludedIdentity(identity)) {
          continue;
        }

        matches.push({
          frame,
          locator: candidate,
          selectorDescription: `${selector} @ ${frame.url()}`,
        });
      }
    }
  }

  return matches;
}

export async function findFirstVisibleInFrames(
  page: Page,
  selectors: readonly string[],
): Promise<LocatedElement | null> {
  const matches = await collectMatchesInFrames(page, selectors);
  return matches[0] ?? null;
}

export async function findUsernameField(page: Page): Promise<LocatedElement | "ambiguous" | null> {
  const high = await collectMatchesInFrames(page, USERNAME_SELECTORS_HIGH);
  if (high.length === 1) {
    return high[0] ?? null;
  }
  if (high.length > 1) {
    // Preferência estável: primeiro seletor de prioridade alta que bateu
    return high[0] ?? null;
  }

  const roleMatches: LocatedElement[] = [];
  for (const frame of usableFrames(page)) {
    const locator = frame.getByRole("textbox");
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (!(await isVisibleAndEnabled(candidate))) {
        continue;
      }
      const identity = await readInputIdentity(candidate).catch(() => ({
        name: null,
        id: null,
        placeholder: null,
      }));
      if (isExcludedIdentity(identity)) {
        continue;
      }
      roleMatches.push({
        frame,
        locator: candidate,
        selectorDescription: `getByRole(textbox) @ ${frame.url()}`,
      });
    }
  }

  if (roleMatches.length === 1) {
    return roleMatches[0] ?? null;
  }
  if (roleMatches.length > 1) {
    return "ambiguous";
  }

  const generic = await collectMatchesInFrames(page, ['input[type="text"]', "input:not([type])"]);

  if (generic.length === 1) {
    return generic[0] ?? null;
  }
  if (generic.length > 1) {
    return "ambiguous";
  }

  return null;
}

export async function findPasswordField(page: Page): Promise<LocatedElement | null> {
  return findFirstVisibleInFrames(page, PASSWORD_SELECTORS);
}

async function buttonText(locator: Locator): Promise<string> {
  const text = await locator.innerText().catch(async () => {
    return locator.getAttribute("value").catch(() => "");
  });
  return (text ?? "").trim();
}

export async function findSubmitButtons(page: Page): Promise<LocatedElement[]> {
  const found: LocatedElement[] = [];
  const seen = new Set<string>();

  const pushUnique = async (frame: Frame, locator: Locator, description: string): Promise<void> => {
    if (!(await isVisibleAndEnabled(locator))) {
      return;
    }
    const text = await buttonText(locator);
    if (AVOID_BUTTON_TERMS.test(text)) {
      return;
    }
    const key = `${frame.url()}::${description}::${text}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    found.push({ frame, locator, selectorDescription: description });
  };

  for (const frame of usableFrames(page)) {
    const byRole = frame.getByRole("button", { name: ACCEPT_BUTTON_TERMS });
    const roleCount = await byRole.count().catch(() => 0);
    for (let i = 0; i < roleCount; i += 1) {
      await pushUnique(frame, byRole.nth(i), `role=button name~accept @ ${frame.url()}`);
    }

    for (const selector of SUBMIT_SELECTORS) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        const text = await buttonText(candidate);
        if (text && !ACCEPT_BUTTON_TERMS.test(text) && selector === '[role="button"]') {
          continue;
        }
        if (AVOID_BUTTON_TERMS.test(text)) {
          continue;
        }
        await pushUnique(frame, candidate, `${selector} @ ${frame.url()}`);
      }
    }
  }

  return found;
}

export async function findPreferredSubmitButton(page: Page): Promise<LocatedElement | null> {
  const buttons = await findSubmitButtons(page);
  return buttons[0] ?? null;
}

export async function detectContinueOrCompanyUi(page: Page): Promise<{
  kind: "continue-only" | "ambiguous-company" | "none";
  continueButton: LocatedElement | null;
}> {
  const bodyTexts: string[] = [];
  for (const frame of usableFrames(page)) {
    const text = await frame
      .locator("body")
      .innerText()
      .catch(() => "");
    bodyTexts.push(text);
  }
  const combined = bodyTexts.join("\n").toLowerCase();

  const hints =
    /connected|conectado|continue|continuar|company|empresa|configuration|configura[cç][aã]o/i.test(
      combined,
    );

  if (!hints) {
    return { kind: "none", continueButton: null };
  }

  const username = await findUsernameField(page);
  const password = await findPasswordField(page);
  if (username !== null || password !== null) {
    return { kind: "none", continueButton: null };
  }

  const continueButtons = await findSubmitButtons(page);
  const companyLike = continueButtons.filter((item) =>
    /empresa|company|configura/i.test(item.selectorDescription),
  );

  if (continueButtons.length === 1 && companyLike.length === 0) {
    return {
      kind: "continue-only",
      continueButton: continueButtons[0] ?? null,
    };
  }

  if (continueButtons.length > 1 || /empresa|company/i.test(combined)) {
    return { kind: "ambiguous-company", continueButton: null };
  }

  if (continueButtons.length === 1) {
    return {
      kind: "continue-only",
      continueButton: continueButtons[0] ?? null,
    };
  }

  return { kind: "none", continueButton: null };
}
