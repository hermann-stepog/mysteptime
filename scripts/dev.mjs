import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// vite-tanstack-config only loads VITE_-prefixed vars from .env into
// import.meta.env. Server-only secrets (no VITE_ prefix, e.g. SMTP_*) are meant
// to be read via plain process.env inside .server.ts modules/handlers, but that
// only works if they're actually present in the OS environment. Load .env here
// so every key — not just VITE_* — ends up in process.env for the dev server.
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Some corporate networks (antivirus/proxy SSL inspection, e.g. Kaspersky) re-sign
// outbound HTTPS with a local root CA that Node doesn't trust by default (unlike
// curl/browsers, which read the OS trust store). If a dev has exported that root
// into .certs/, point Node at it so server-side fetch() calls (e.g. Smartsheet) work.
const certPath = fileURLToPath(new URL("../.certs/kaspersky-root.pem", import.meta.url));

const env = { ...process.env };
if (existsSync(certPath)) env.NODE_EXTRA_CA_CERTS = certPath;

const child = spawn("vite dev", { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
