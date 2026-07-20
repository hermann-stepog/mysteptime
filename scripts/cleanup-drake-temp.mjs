#!/usr/bin/env node
/**
 * Limpa somente temporários Drake legados/antigos.
 * Padrão: --dry-run (lista quantidade e caminhos, não apaga).
 * Apagar de fato: --confirm
 *
 * Escopos:
 * - <project-root>/tmp/drake
 * - DRAKE_TEMP_DIR (se definido)
 * - os.tmpdir()/mysteptime-drake
 * - os.tmpdir()/mysteptime-drake-last-error (somente com --confirm e --include-last-error)
 *
 * Nunca apaga storage-state de autenticação nem código-fonte.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--confirm");
const includeLastError = args.has("--include-last-error");
const maxAgeMinutes = Number.parseInt(process.env.DRAKE_TEMP_MAX_AGE_MINUTES ?? "0", 10);
/** 0 = listar/apagar tudo sob escopos Drake (script manual). */
const maxAgeMs = Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 ? maxAgeMinutes * 60_000 : 0;

function isDrakeTempRoot(candidate) {
  const normalized = path.resolve(candidate).toLowerCase().replace(/\\/g, "/");
  return (
    normalized.endsWith("/tmp/drake") ||
    normalized.includes("/mysteptime-drake") ||
    normalized.endsWith("/tmp/drake/") ||
    /\/tmp\/drake(\/|$)/.test(normalized)
  );
}

function assertSafeTarget(target) {
  const resolved = path.resolve(target);
  const lower = resolved.toLowerCase().replace(/\\/g, "/");
  const banned = [
    path.resolve(projectRoot, "src"),
    path.resolve(projectRoot, "public"),
    path.resolve(projectRoot, "node_modules"),
    path.resolve(projectRoot, "supabase"),
    path.resolve(projectRoot, ".git"),
    path.resolve(homedir()),
  ];
  for (const ban of banned) {
    if (resolved === ban || resolved.startsWith(ban + path.sep)) {
      if (ban === path.resolve(homedir()) && isDrakeTempRoot(resolved)) {
        continue;
      }
      if (ban === path.resolve(homedir())) continue;
      throw new Error(`Caminho protegido: ${path.basename(resolved)}`);
    }
  }
  if (lower.includes("/node_modules/") || lower.endsWith("/src") || lower.includes("/src/")) {
    if (lower.includes("/mysteptime-drake") || lower.includes("/tmp/drake")) {
      /* ok */
    } else {
      throw new Error("Caminho protegido (source/node_modules).");
    }
  }
  if (!isDrakeTempRoot(resolved) && !path.basename(resolved).startsWith("run-")) {
    const parent = path.dirname(resolved);
    if (!isDrakeTempRoot(parent) && !isDrakeTempRoot(path.dirname(parent))) {
      throw new Error("Alvo fora da estrutura Drake esperada.");
    }
  }
  return resolved;
}

async function collectTargets(root) {
  const resolved = path.resolve(root);
  let entries;
  try {
    entries = await readdir(resolved, { withFileTypes: true });
  } catch {
    return [];
  }

  const now = Date.now();
  const found = [];
  for (const entry of entries) {
    const full = path.join(resolved, entry.name);
    if (entry.name === "storage-state.json" || entry.name.endsWith(".storage-state.json")) {
      continue;
    }
    try {
      const st = await stat(full);
      if (maxAgeMs > 0 && now - st.mtimeMs < maxAgeMs) continue;
      found.push(full);
    } catch {
      /* ignore */
    }
  }
  return found;
}

async function main() {
  const configured = (process.env.DRAKE_TEMP_DIR ?? "").trim();
  const roots = new Set([
    path.resolve(projectRoot, "tmp", "drake"),
    path.resolve(tmpdir(), "mysteptime-drake"),
  ]);
  if (configured) roots.add(path.resolve(configured));
  if (includeLastError) {
    const last =
      (process.env.DRAKE_LAST_DIAGNOSTIC_DIR ?? "").trim() ||
      path.resolve(tmpdir(), "mysteptime-drake-last-error");
    roots.add(path.resolve(last));
  }

  const all = [];
  for (const root of roots) {
    if (!isDrakeTempRoot(root) && !root.toLowerCase().includes("mysteptime-drake-last-error")) {
      console.warn(`Ignorando raiz nao-Drake: ${path.basename(root)}`);
      continue;
    }
    const targets = await collectTargets(root);
    all.push(...targets);
  }

  console.log(
    dryRun
      ? `[dry-run] ${all.length} caminho(s) seriam removidos:`
      : `[confirm] removendo ${all.length} caminho(s):`,
  );
  for (const target of all) {
    console.log(`  - ${target}`);
  }

  if (dryRun) {
    console.log("Nada foi apagado. Use --confirm para remover.");
    return;
  }

  for (const target of all) {
    const safe = assertSafeTarget(target);
    await rm(safe, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  console.log("Limpeza concluida.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
