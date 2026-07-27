import "@tanstack/react-start/server-only";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageState } from "./types";
import { env } from "../config.server";
import { isDrakeBrowserRemoteMode } from "../browser/create-drake-browser-runtime.server";

/** Sessão em memória do processo — usada em local e remote (Lovable efêmero). */
let memorySession: StorageState | null = null;

function allowFileSessionCache(): boolean {
  if (isDrakeBrowserRemoteMode()) return false;
  return env.DRAKE_SESSION_CACHE_ENABLED;
}

export async function readSessionCache(): Promise<StorageState | null> {
  if (memorySession) return memorySession;

  if (!allowFileSessionCache()) return null;

  const filePath = path.resolve(env.DRAKE_SESSION_CACHE_PATH);
  try {
    await access(filePath);
  } catch {
    return null;
  }
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as StorageState;
  if (!parsed || typeof parsed !== "object") return null;
  memorySession = parsed;
  return parsed;
}

export async function writeSessionCache(state: StorageState): Promise<void> {
  // Sempre em memória — permite reutilizar sessão no remoto sem Chromium a cada request.
  memorySession = state;

  if (!allowFileSessionCache()) return;

  const filePath = path.resolve(env.DRAKE_SESSION_CACHE_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, filePath);
}

export async function clearSessionCache(): Promise<void> {
  memorySession = null;
  const filePath = path.resolve(env.DRAKE_SESSION_CACHE_PATH);
  try {
    await unlink(filePath);
  } catch {
    /* ignore */
  }
}

/** Apenas para testes. */
export function __resetSessionCacheMemoryForTests(): void {
  memorySession = null;
}
