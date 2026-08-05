import "@tanstack/react-start/server-only";
import path from "node:path";
import { getCurrentDrakeRunFiles, getDrakeTempRoot } from "./drake-files.server";

export function getDiagnosticsDir(): string {
  const run = getCurrentDrakeRunFiles();
  if (run) return run.diagnosticsDirectory;
  return path.resolve(getDrakeTempRoot(), "diagnostics");
}

export function getScreenshotsDir(): string {
  const run = getCurrentDrakeRunFiles();
  if (run) return path.resolve(run.rootDirectory, "screenshots");
  return path.resolve(getDrakeTempRoot(), "screenshots");
}

export function getDownloadsDir(): string {
  const run = getCurrentDrakeRunFiles();
  if (run) return run.downloadsDirectory;
  return path.resolve(getDrakeTempRoot(), "downloads");
}

/** @deprecated Prefer getDiagnosticsDir() — não criar pasta no projeto. */
export const DIAGNOSTICS_DIR = "./tmp/drake/diagnostics";
/** @deprecated Prefer getScreenshotsDir() */
export const SCREENSHOTS_DIR = "./tmp/drake/screenshots";

export function sanitizeFileName(name: string): string {
  const unsafe = new Set('<>:"/\\|?*');
  const base = path
    .basename(name)
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || unsafe.has(ch)) return "_";
      return ch;
    })
    .join("");
  const trimmed = base.trim() || "download.bin";
  return trimmed.replace(/^\.+/, "_");
}

/** @deprecated Prefer nomes fixos (context-controls.json) para não acumular. */
export function withTimestamp(prefix: string, extension = "json"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.${extension}`;
}
