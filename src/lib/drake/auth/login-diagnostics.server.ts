import "@tanstack/react-start/server-only";
import path from "node:path";
import type { Frame, Page } from "playwright";
import { env } from "../config.server";
import { getCurrentDrakeRunFiles, writeJsonAtomic, writeFileAtomic } from "../drake-files.server";
import { getDiagnosticsDir } from "../filesystem.server";
import { logger } from "../logger";
import { usableFrames } from "./locate.server";

const MAX_HTML_BYTES = 2 * 1024 * 1024;

type ControlSnapshot = {
  frameUrl: string;
  tagName: string;
  type: string | null;
  id: string | null;
  name: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  ariaLabel: string | null;
  role: string | null;
  visible: boolean;
  enabled: boolean;
};

type ButtonSnapshot = {
  frameUrl: string;
  tagName: string;
  id: string | null;
  name: string | null;
  text: string | null;
  ariaLabel: string | null;
  role: string | null;
  visible: boolean;
  enabled: boolean;
};

export type LoginDiagnosticsReport = {
  timestamp: string;
  pageUrl: string;
  frames: Array<{ url: string; name: string }>;
  inputs: ControlSnapshot[];
  textareas: ControlSnapshot[];
  selects: ControlSnapshot[];
  buttons: ButtonSnapshot[];
  linkButtons: ButtonSnapshot[];
  roleButtons: ButtonSnapshot[];
  roleTextboxes: ControlSnapshot[];
};

async function snapshotControl(frame: Frame, selector: string): Promise<ControlSnapshot[]> {
  const locator = frame.locator(selector);
  const count = await locator.count().catch(() => 0);
  const items: ControlSnapshot[] = [];
  for (let i = 0; i < Math.min(count, 80); i += 1) {
    const el = locator.nth(i);
    items.push({
      frameUrl: frame.url(),
      tagName: (await el
        .evaluate((node) => node.tagName.toLowerCase())
        .catch(() => "unknown")) as string,
      type: (await el.getAttribute("type").catch(() => null)) ?? null,
      id: (await el.getAttribute("id").catch(() => null)) ?? null,
      name: (await el.getAttribute("name").catch(() => null)) ?? null,
      placeholder: (await el.getAttribute("placeholder").catch(() => null)) ?? null,
      autocomplete: (await el.getAttribute("autocomplete").catch(() => null)) ?? null,
      ariaLabel: (await el.getAttribute("aria-label").catch(() => null)) ?? null,
      role: (await el.getAttribute("role").catch(() => null)) ?? null,
      visible: await el.isVisible().catch(() => false),
      enabled: await el.isEnabled().catch(() => false),
    });
  }
  return items;
}

async function snapshotButtons(frame: Frame, selector: string): Promise<ButtonSnapshot[]> {
  const locator = frame.locator(selector);
  const count = await locator.count().catch(() => 0);
  const items: ButtonSnapshot[] = [];
  for (let i = 0; i < Math.min(count, 80); i += 1) {
    const el = locator.nth(i);
    items.push({
      frameUrl: frame.url(),
      tagName: (await el
        .evaluate((node) => node.tagName.toLowerCase())
        .catch(() => "unknown")) as string,
      id: (await el.getAttribute("id").catch(() => null)) ?? null,
      name: (await el.getAttribute("name").catch(() => null)) ?? null,
      text: ((await el.innerText().catch(() => "")) || "").trim().slice(0, 120) || null,
      ariaLabel: (await el.getAttribute("aria-label").catch(() => null)) ?? null,
      role: (await el.getAttribute("role").catch(() => null)) ?? null,
      visible: await el.isVisible().catch(() => false),
      enabled: await el.isEnabled().catch(() => false),
    });
  }
  return items;
}

export async function collectLoginDiagnostics(page: Page): Promise<LoginDiagnosticsReport> {
  const frames = usableFrames(page);
  const report: LoginDiagnosticsReport = {
    timestamp: new Date().toISOString(),
    pageUrl: page.url(),
    frames: frames.map((frame) => ({
      url: frame.url(),
      name: frame.name(),
    })),
    inputs: [],
    textareas: [],
    selects: [],
    buttons: [],
    linkButtons: [],
    roleButtons: [],
    roleTextboxes: [],
  };

  for (const frame of frames) {
    report.inputs.push(...(await snapshotControl(frame, "input")));
    report.textareas.push(...(await snapshotControl(frame, "textarea")));
    report.selects.push(...(await snapshotControl(frame, "select")));
    report.buttons.push(...(await snapshotButtons(frame, "button")));
    report.linkButtons.push(
      ...(await snapshotButtons(frame, 'a[role="button"], a.btn, a.button, a[class*="btn"]')),
    );
    report.roleButtons.push(...(await snapshotButtons(frame, '[role="button"]')));
    report.roleTextboxes.push(...(await snapshotControl(frame, '[role="textbox"]')));
  }

  return report;
}

export async function saveLoginDiagnostics(
  page: Page,
  options?: { saveHtmlWhenEmpty?: boolean },
): Promise<{ report: LoginDiagnosticsReport; jsonPath: string | null; htmlPath?: string | null }> {
  const report = await collectLoginDiagnostics(page);

  if (!env.DRAKE_DIAGNOSTICS_ENABLED) {
    return { report, jsonPath: null, htmlPath: null };
  }

  const run = getCurrentDrakeRunFiles();
  const dir = run?.diagnosticsDirectory ?? getDiagnosticsDir();
  const jsonPath = path.resolve(dir, "login-controls.json");
  await writeJsonAtomic(jsonPath, report);
  logger.info({ file: "login-controls.json" }, "Diagnostico de login salvo");

  const hasInteractive =
    report.inputs.some((item) => item.visible) ||
    report.textareas.some((item) => item.visible) ||
    report.roleTextboxes.some((item) => item.visible);

  if (options?.saveHtmlWhenEmpty !== false && !hasInteractive) {
    const htmlPath = await saveSanitizedLoginHtml(page);
    return { report, jsonPath, htmlPath };
  }

  return { report, jsonPath };
}

function sanitizeHtml(raw: string): string {
  let html = raw;
  html = html.replace(/\svalue=(["']).*?\1/gi, "");
  html = html.replace(/\svalue=[^\s>]+/gi, "");
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>");
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>");
  html = html.replace(/\s([a-zA-Z_:][\w:.-]*)=(["'])[\s\S]*?\2/gi, (full, attrName: string) => {
    const lower = attrName.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("authorization") ||
      lower.includes("cookie")
    ) {
      return "";
    }
    return full;
  });

  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    html = Buffer.from(html, "utf8").subarray(0, MAX_HTML_BYTES).toString("utf8");
    html += "\n<!-- truncated -->\n";
  }

  return html;
}

export async function saveSanitizedLoginHtml(page: Page): Promise<string | null> {
  if (!env.DRAKE_DIAGNOSTICS_ENABLED) return null;
  const raw = await page.content();
  const sanitized = sanitizeHtml(raw);
  const run = getCurrentDrakeRunFiles();
  const dir = run?.diagnosticsDirectory ?? getDiagnosticsDir();
  const filePath = path.resolve(dir, "login-page.html");
  await writeFileAtomic(filePath, sanitized);
  logger.info({ file: "login-page.html" }, "HTML diagnostico sanitizado salvo");
  return filePath;
}

export async function hasFilledPasswordField(page: Page): Promise<boolean> {
  for (const frame of usableFrames(page)) {
    const passwords = frame.locator('input[type="password"]');
    const count = await passwords.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const value = await passwords
        .nth(i)
        .inputValue()
        .catch(() => "");
      if (value.length > 0) {
        return true;
      }
    }
  }
  return false;
}
