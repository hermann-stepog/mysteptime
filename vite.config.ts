// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Planilhas e gráficos são grandes e usados apenas em telas específicas. Mantê-los
          // fora do núcleo permite que o login/menu carreguem sem baixar esses pacotes e faz
          // o navegador reutilizá-los entre as rotas que realmente precisam deles.
          manualChunks(id) {
            if (id.includes("node_modules/xlsx/")) return "vendor-xlsx";
            if (
              id.includes("node_modules/recharts/") ||
              id.includes("node_modules/d3-") ||
              id.includes("node_modules/@visx/")
            ) {
              return "vendor-charts";
            }
          },
        },
      },
    },
  },
});
