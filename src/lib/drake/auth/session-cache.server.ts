import "@tanstack/react-start/server-only";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageState } from "./types";
import { env } from "../config.server";

export async function readSessionCache(): Promise<StorageState | null> {
  if (!env.DRAKE_SESSION_CACHE_ENABLED) return null;
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
  return parsed;
}

export async function writeSessionCache(state: StorageState): Promise<void> {
  if (!env.DRAKE_SESSION_CACHE_ENABLED) return;
  const filePath = path.resolve(env.DRAKE_SESSION_CACHE_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, filePath);
}

export async function clearSessionCache(): Promise<void> {
  const filePath = path.resolve(env.DRAKE_SESSION_CACHE_PATH);
  try {
    await unlink(filePath);
  } catch {
    /* ignore */
  }
}
