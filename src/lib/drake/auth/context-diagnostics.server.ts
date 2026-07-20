import "@tanstack/react-start/server-only";
import path from "node:path";
import type { Frame, Page } from "playwright";
import { env } from "../config.server";
import { getCurrentDrakeRunFiles, writeJsonAtomic } from "../drake-files.server";
import { getDiagnosticsDir } from "../filesystem.server";
import { logger } from "../logger";
import { normalizeText } from "../text";
import { usableFrames } from "./locate.server";

export { normalizeText };

export function isExactContextLabel(text: string): boolean {
  return normalizeText(text) === normalizeText(env.DRAKE_CONTEXT_NAME);
}

const COMBO_SELECTORS = [
  '[role="combobox"]',
  'input[role="combobox"]',
  'button[role="combobox"]',
  '[aria-haspopup="listbox"]',
  '[aria-haspopup="menu"]',
  ".select2-selection",
  ".select2-container",
  ".mat-mdc-select",
  ".mat-select",
  ".ng-select",
  ".react-select__control",
  '[class*="select" i]',
  '[class*="dropdown" i]',
] as const;

type SelectDump = {
  frameUrl: string;
  id: string | null;
  name: string | null;
  className: string | null;
  ariaLabel: string | null;
  visible: boolean;
  enabled: boolean;
  optionTexts: string[];
  selectedText: string | null;
};

type ComboboxDump = {
  frameUrl: string;
  tag: string;
  id: string | null;
  className: string | null;
  role: string | null;
  ariaLabel: string | null;
  ariaExpanded: string | null;
  ariaControls: string | null;
  ariaOwns: string | null;
  placeholder: string | null;
  visibleText: string;
  visible: boolean;
  enabled: boolean;
};

type StepElementDump = {
  frameUrl: string;
  tag: string;
  id: string | null;
  className: string | null;
  role: string | null;
  visible: boolean;
  nearestOptionAncestorRole: string | null;
};

type ContextDiagnosticsReport = {
  timestamp: string;
  pageUrl: string;
  expectedContext: string;
  frames: Array<{ url: string; name: string }>;
  selects: SelectDump[];
  comboboxes: ComboboxDump[];
  stepElements: StepElementDump[];
};

async function dumpSelects(frame: Frame): Promise<SelectDump[]> {
  const locator = frame.locator("select");
  const count = await locator.count().catch(() => 0);
  const items: SelectDump[] = [];

  for (let i = 0; i < count; i += 1) {
    const select = locator.nth(i);
    const meta = await select
      .evaluate((el) => {
        const element = el as HTMLSelectElement;
        const options = [...element.options].map((opt) => (opt.textContent ?? "").trim());
        const selected = element.selectedOptions[0];
        return {
          id: element.getAttribute("id"),
          name: element.getAttribute("name"),
          className: element.getAttribute("class"),
          ariaLabel: element.getAttribute("aria-label"),
          optionTexts: options,
          selectedText: (selected?.textContent ?? "").trim() || null,
        };
      })
      .catch(() => null);

    if (!meta) {
      continue;
    }

    items.push({
      frameUrl: frame.url(),
      id: meta.id,
      name: meta.name,
      className: meta.className,
      ariaLabel: meta.ariaLabel,
      visible: await select.isVisible().catch(() => false),
      enabled: await select.isEnabled().catch(() => false),
      optionTexts: meta.optionTexts,
      selectedText: meta.selectedText,
    });
  }

  return items;
}

async function dumpComboboxes(frame: Frame): Promise<ComboboxDump[]> {
  const items: ComboboxDump[] = [];
  const seen = new Set<string>();

  for (const selector of COMBO_SELECTORS) {
    const locator = frame.locator(selector);
    const count = await locator.count().catch(() => 0);

    for (let i = 0; i < count; i += 1) {
      const el = locator.nth(i);
      const meta = await el
        .evaluate((node) => {
          const element = node as HTMLElement;
          return {
            tag: element.tagName.toLowerCase(),
            id: element.getAttribute("id"),
            className: element.getAttribute("class"),
            role: element.getAttribute("role"),
            ariaLabel: element.getAttribute("aria-label"),
            ariaExpanded: element.getAttribute("aria-expanded"),
            ariaControls: element.getAttribute("aria-controls"),
            ariaOwns: element.getAttribute("aria-owns"),
            placeholder: element.getAttribute("placeholder"),
            visibleText: (element.innerText || element.textContent || "").trim().slice(0, 150),
          };
        })
        .catch(() => null);

      if (!meta) {
        continue;
      }

      const key = `${frame.url()}|${meta.tag}|${meta.id}|${meta.className}|${meta.visibleText}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      items.push({
        frameUrl: frame.url(),
        tag: meta.tag,
        id: meta.id,
        className: meta.className,
        role: meta.role,
        ariaLabel: meta.ariaLabel,
        ariaExpanded: meta.ariaExpanded,
        ariaControls: meta.ariaControls,
        ariaOwns: meta.ariaOwns,
        placeholder: meta.placeholder,
        visibleText: meta.visibleText,
        visible: await el.isVisible().catch(() => false),
        enabled: await el.isEnabled().catch(() => false),
      });
    }
  }

  return items;
}

async function dumpStepElements(frame: Frame): Promise<StepElementDump[]> {
  const locator = frame.getByText(env.DRAKE_CONTEXT_NAME, { exact: true });
  const count = await locator.count().catch(() => 0);
  const items: StepElementDump[] = [];

  for (let i = 0; i < count; i += 1) {
    const el = locator.nth(i);
    const meta = await el
      .evaluate((node) => {
        const element = node as HTMLElement;
        let ancestor: HTMLElement | null = element;
        let nearestOptionAncestorRole: string | null = null;
        while (ancestor) {
          const role = ancestor.getAttribute("role");
          if (role === "option" || role === "menuitem" || role === "listitem") {
            nearestOptionAncestorRole = role;
            break;
          }
          ancestor = ancestor.parentElement;
        }

        return {
          tag: element.tagName.toLowerCase(),
          id: element.getAttribute("id"),
          className: element.getAttribute("class"),
          role: element.getAttribute("role"),
          nearestOptionAncestorRole,
          text: (element.innerText || element.textContent || "").trim(),
        };
      })
      .catch(() => null);

    if (!meta || !isExactContextLabel(meta.text)) {
      continue;
    }

    items.push({
      frameUrl: frame.url(),
      tag: meta.tag,
      id: meta.id,
      className: meta.className,
      role: meta.role,
      visible: await el.isVisible().catch(() => false),
      nearestOptionAncestorRole: meta.nearestOptionAncestorRole,
    });
  }

  return items;
}

export async function dumpContextControls(page: Page): Promise<ContextDiagnosticsReport> {
  const frames = usableFrames(page);
  const report: ContextDiagnosticsReport = {
    timestamp: new Date().toISOString(),
    pageUrl: page.url(),
    expectedContext: env.DRAKE_CONTEXT_NAME,
    frames: frames.map((frame) => ({
      url: frame.url(),
      name: frame.name(),
    })),
    selects: [],
    comboboxes: [],
    stepElements: [],
  };

  for (const frame of frames) {
    report.selects.push(...(await dumpSelects(frame)));
    report.comboboxes.push(...(await dumpComboboxes(frame)));
    report.stepElements.push(...(await dumpStepElements(frame)));
  }

  // Diagnósticos desabilitados por padrão — manter só em memória.
  if (!env.DRAKE_DIAGNOSTICS_ENABLED) {
    return report;
  }

  const run = getCurrentDrakeRunFiles();
  const dir = run?.diagnosticsDirectory ?? getDiagnosticsDir();
  const filePath = path.resolve(dir, "context-controls.json");
  await writeJsonAtomic(filePath, report);
  logger.info({ file: "context-controls.json" }, "Diagnostico de contexto salvo");
  return report;
}
