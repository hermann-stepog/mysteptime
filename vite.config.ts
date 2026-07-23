// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

const PLAYWRIGHT_EXTERNALS = ["playwright", "playwright-core", "chromium-bidi"] as const;

function isPlaywrightRelated(id: string): boolean {
  return (
    id === "playwright" ||
    id === "playwright-core" ||
    id === "chromium-bidi" ||
    id.startsWith("playwright/") ||
    id.startsWith("playwright-core/") ||
    id.startsWith("chromium-bidi/")
  );
}

/** Impede empacotamento parcial de Playwright/chromium-bidi no SSR (Nitro/Cloudflare). */
function drakeExternalizePlaywrightPlugin(): Plugin {
  return {
    name: "drake-externalize-playwright",
    enforce: "pre",
    apply: "build",
    resolveId(id) {
      if (isPlaywrightRelated(id)) {
        return { id, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [drakeExternalizePlaywrightPlugin()],
    optimizeDeps: {
      // Playwright é exclusivamente server-side — não pré-empacotar no grafo do cliente.
      exclude: [...PLAYWRIGHT_EXTERNALS],
    },
    ssr: {
      // Nunca transformar/empacotar Playwright no SSR — carregar só via import dinâmico no Node.
      external: [...PLAYWRIGHT_EXTERNALS],
      noExternal: [],
    },
    build: {
      rollupOptions: {
        external: (id) => isPlaywrightRelated(id),
      },
    },
  },
});
