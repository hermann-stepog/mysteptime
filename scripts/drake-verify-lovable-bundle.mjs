/**
 * Verifica que o build SSR/client não contém imports parciais quebrados do Playwright.
 * npm run drake:verify:lovable-bundle
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, ".output");

const FORBIDDEN = [
  "_ssr/chromium-bidi",
  "bidiMapper/BidiMapper",
  'No such module "_ssr/chromium-bidi"',
  "Cannot find module 'playwright'",
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(js|mjs|cjs|map)$/i.test(name)) acc.push(full);
  }
  return acc;
}

function main() {
  if (!existsSync(OUTPUT)) {
    console.error(
      "[drake:verify:lovable-bundle] Pasta .output ausente. Execute npm run build antes.",
    );
    process.exitCode = 1;
    return;
  }

  const files = walk(OUTPUT);
  const hits = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      if (text.includes(pattern)) {
        hits.push({ file: path.relative(ROOT, file), pattern });
      }
    }
    if (
      file.includes(`${path.sep}public${path.sep}`) ||
      file.includes(`${path.sep}client${path.sep}`)
    ) {
      if (
        /\bfrom\s+["']playwright["']/.test(text) ||
        /\bfrom\s+["']playwright-core["']/.test(text)
      ) {
        hits.push({
          file: path.relative(ROOT, file),
          pattern: "client-side playwright import",
        });
      }
    }
  }

  const ssrFiles = files.filter((f) => f.includes(`${path.sep}server${path.sep}`));
  for (const file of ssrFiles) {
    const text = readFileSync(file, "utf8");
    if (/chromium-bidi\/lib\/cjs\/bidiMapper/i.test(text)) {
      hits.push({
        file: path.relative(ROOT, file),
        pattern: "chromium-bidi/lib/cjs/bidiMapper",
      });
    }
  }

  if (hits.length > 0) {
    console.error("[drake:verify:lovable-bundle] FALHOU — padrões proibidos encontrados:");
    for (const hit of hits.slice(0, 40)) {
      console.error(`  - ${hit.pattern} @ ${hit.file}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[drake:verify:lovable-bundle] OK", {
    scannedFiles: files.length,
    output: ".output",
  });
}

main();
