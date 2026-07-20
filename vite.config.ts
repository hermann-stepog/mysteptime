// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const PLAYWRIGHT_EXTERNALS = ["playwright", "playwright-core", "chromium-bidi"] as const;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    optimizeDeps: {
      // Playwright é exclusivamente server-side — não pré-empacotar no grafo do cliente.
      exclude: [...PLAYWRIGHT_EXTERNALS],
    },
    ssr: {
      // Deixar o Node resolver Playwright em runtime; o Vite/esbuild não deve empacotá-lo
      // (evita "Could not resolve chromium-bidi/..." em coreBundle.js).
      external: [...PLAYWRIGHT_EXTERNALS],
    },
  },
});
