import "@tanstack/react-start/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDrakeConfig } from "./config.server";

export interface DrakeRunFiles {
  rootDirectory: string;
  downloadsDirectory: string;
  diagnosticsDirectory: string;
}

const runContext = new AsyncLocalStorage<DrakeRunFiles>();

export function getCurrentDrakeRunFiles(): DrakeRunFiles | null {
  return runContext.getStore() ?? null;
}

export function runWithDrakeFiles<T>(files: DrakeRunFiles, fn: () => Promise<T>): Promise<T> {
  return runContext.run(files, fn);
}

/** Raiz temporária Drake (OS tmp por padrão; DRAKE_TEMP_DIR se configurado). */
export function getDrakeTempRoot(): string {
  const configured = (getDrakeConfig().DRAKE_TEMP_DIR ?? "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(tmpdir(), "mysteptime-drake");
}

export function getDrakeLastDiagnosticDir(): string {
  const configured = (process.env.DRAKE_LAST_DIAGNOSTIC_DIR ?? "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(tmpdir(), "mysteptime-drake-last-error");
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const resolved = path.resolve(filePath);
  await ensureParentDirectory(resolved);
  const tmp = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, resolved);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeFileAtomic(filePath: string, data: Buffer | string): Promise<void> {
  const resolved = path.resolve(filePath);
  await ensureParentDirectory(resolved);
  const tmp = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, resolved);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createDrakeRunFiles(): Promise<DrakeRunFiles> {
  const root = getDrakeTempRoot();
  await mkdir(root, { recursive: true });
  await cleanupStaleDrakeRuns().catch(() => undefined);

  const runRoot = await mkdtemp(path.join(root, "run-"));
  const downloadsDirectory = path.join(runRoot, "downloads");
  const diagnosticsDirectory = path.join(runRoot, "diagnostics");
  await mkdir(downloadsDirectory, { recursive: true });
  await mkdir(diagnosticsDirectory, { recursive: true });

  return {
    rootDirectory: runRoot,
    downloadsDirectory,
    diagnosticsDirectory,
  };
}

function assertSafeToDelete(targetPath: string, allowedRoot: string): void {
  const target = path.resolve(targetPath);
  const allowed = path.resolve(allowedRoot);
  const rel = path.relative(allowed, target);

  if (!path.isAbsolute(target)) {
    throw new Error("DRAKE_TEMP_STORAGE_ERROR: caminho temporario invalido.");
  }
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("DRAKE_TEMP_STORAGE_ERROR: limpeza fora da raiz temporaria Drake.");
  }

  const banned = ["src", "public", "node_modules", "supabase", ".git"];
  const lower = target.toLowerCase().replace(/\\/g, "/");
  for (const part of banned) {
    if (lower.includes(`/${part}/`) || lower.endsWith(`/${part}`)) {
      throw new Error("DRAKE_TEMP_STORAGE_ERROR: caminho protegido.");
    }
  }
}

export async function safeRm(
  targetPath: string,
  allowedRoot: string,
  options?: { recursive?: boolean },
): Promise<void> {
  assertSafeToDelete(targetPath, allowedRoot);
  await rm(path.resolve(targetPath), {
    recursive: options?.recursive ?? true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}

export async function cleanupDrakeRunFiles(runFiles: DrakeRunFiles): Promise<void> {
  if (getDrakeConfig().DRAKE_KEEP_TEMP_FILES) return;
  const root = getDrakeTempRoot();
  try {
    await safeRm(runFiles.rootDirectory, root, { recursive: true });
  } catch (error) {
    console.warn("[drake-files] Falha ao limpar diretorio da execucao (aviso sanitizado)");
    void error;
  }
}

export async function cleanupStaleDrakeRuns(): Promise<void> {
  const root = getDrakeTempRoot();
  const maxAgeMinutes = getDrakeConfig().DRAKE_TEMP_MAX_AGE_MINUTES;
  const maxAgeMs = Math.max(1, maxAgeMinutes) * 60_000;
  const now = Date.now();

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const name of entries) {
    if (!name.startsWith("run-")) continue;
    const full = path.join(root, name);
    try {
      const st = await stat(full);
      if (!st.isDirectory()) continue;
      if (now - st.mtimeMs < maxAgeMs) continue;
      await safeRm(full, root, { recursive: true });
    } catch {
      /* ignore entry */
    }
  }
}

/** Preserva somente o diagnóstico mais recente (nomes fixos), sobrescrevendo o anterior. */
export async function saveLastErrorDiagnostic(files: Record<string, unknown>): Promise<void> {
  if (!getDrakeConfig().DRAKE_KEEP_DIAGNOSTICS_ON_ERROR) return;
  const dir = getDrakeLastDiagnosticDir();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
    await writeJsonAtomic(path.join(dir, safeName), value);
  }
}

export async function removeFileIfExists(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  const run = getCurrentDrakeRunFiles();
  const allowed = run?.rootDirectory ?? getDrakeTempRoot();
  try {
    assertSafeToDelete(filePath, allowed);
    await rm(path.resolve(filePath), { force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* ignore */
  }
}

export function isTempStorageError(error: unknown): boolean {
  const text = [
    error instanceof Error ? error.message : String(error ?? ""),
    error instanceof Error && typeof (error as Error & { code?: string }).code === "string"
      ? (error as Error & { code: string }).code
      : "",
  ].join("\n");
  return /ENOENT|no such file or directory|DRAKE_TEMP_STORAGE_ERROR|context-controls|tmp[/\\]drake|EPERM|EBUSY/i.test(
    text,
  );
}
