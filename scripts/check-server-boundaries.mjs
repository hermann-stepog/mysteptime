/**
 * Garante que arquivos client/shared não importam módulos server-only
 * (Playwright, node:fs, *.server, undici via supabase-server-fetch).
 *
 * Uso: node scripts/check-server-boundaries.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const CLIENT_ROOTS = ["src/components", "src/hooks", "src/stores"];
const SHARED_SAFE = [
  "src/lib/drake/update-types.ts",
  "src/lib/drake/auth/errors.ts",
  "src/lib/drake/auth/types.ts",
  "src/lib/drake/report-contracts.ts",
  "src/lib/drake/report-parameter-builder.ts",
  "src/lib/drake/date-range.ts",
  "src/lib/drake/text.ts",
  "src/lib/drake/logger.ts",
  "src/lib/drake/api-report-types.ts",
  "src/lib/supabase/app-auth-errors.ts",
  "src/lib/drake/ndjson-stream.ts",
];

const FORBIDDEN_RUNTIME = [
  /\bfrom\s+["']playwright["']/,
  /\bfrom\s+["']playwright-core["']/,
  /\bfrom\s+["']chromium-bidi/,
  /\brequire\s*\(\s*["']playwright/,
  /\bfrom\s+["']node:fs/,
  /\bfrom\s+["']node:path["']/,
  /\bfrom\s+["']undici["']/,
  /environment-credentials-auth\.server/,
  /update-service\.server/,
  /api-session\.server/,
  /headless-login\.server/,
  /supabase-server-fetch/,
  /app-auth\.server/,
  /drake-auth\.server/,
  /drake-update\.server/,
];

// Import type is allowed for shared types only — still forbid type imports of playwright.
const FORBIDDEN_TYPE = [
  /\bimport\s+type\s+.*from\s+["']playwright["']/,
  /\bimport\s+type\s+.*from\s+["']playwright-core["']/,
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walk(p, out);
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !name.endsWith(".server.ts") &&
      !name.endsWith(".test.ts")
    ) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];

function checkFile(absPath, { allowDynamicServerImport = false } = {}) {
  const rel = relative(ROOT, absPath).replace(/\\/g, "/");
  const src = readFileSync(absPath, "utf8");
  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Dynamic import inside createServerFn handlers is allowed only in drake.functions.ts
    if (allowDynamicServerImport && /await\s+import\s*\(/.test(line)) continue;

    for (const re of FORBIDDEN_RUNTIME) {
      if (re.test(line) && !trimmed.startsWith("import type")) {
        // import type of shared modules is OK; runtime forbidden patterns shouldn't match type-only
        if (/^\s*import\s+type\s/.test(trimmed) && !FORBIDDEN_TYPE.some((t) => t.test(line))) {
          continue;
        }
        violations.push(`${rel}:${i + 1}: ${trimmed}`);
      }
    }
    for (const re of FORBIDDEN_TYPE) {
      if (re.test(line)) violations.push(`${rel}:${i + 1}: ${trimmed}`);
    }
  }
}

for (const root of CLIENT_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    checkFile(file);
  }
}

for (const rel of SHARED_SAFE) {
  checkFile(join(ROOT, rel));
}

// Rotas de UI (exceto /api) não podem importar server-only estaticamente.
for (const file of walk(join(ROOT, "src/routes"))) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (rel.startsWith("src/routes/api/")) continue;
  checkFile(file);
}

// Extra: scan components for any static .server imports
for (const file of walk(join(ROOT, "src/components"))) {
  const src = readFileSync(file, "utf8");
  if (/\.server["']/.test(src) && !/import\s+type/.test(src)) {
    // already caught by FORBIDDEN_RUNTIME patterns for known modules; catch generic
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/from\s+["'][^"']*\.server["']/.test(line) && !/^\s*import\s+type\s/.test(line.trim())) {
        violations.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length) {
  console.error("Server boundary violations:\n" + violations.join("\n"));
  process.exit(1);
}

console.log("check:server-boundaries OK — nenhum import server-only no grafo client/shared.");
