import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("segurança de bundle do frontend", () => {
  it("app-auth-errors (importado pelo card) não usa undici, node:fs nem módulos server-only", () => {
    const source = read("src/lib/supabase/app-auth-errors.ts");
    expect(source).not.toMatch(/from\s+["']undici["']/);
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/supabase-server-fetch|app-auth\.server/);
  });

  it("DrakeUpdateCard não importa undici, fs, playwright nem módulos server-only", () => {
    const source = read("src/components/histograma/DrakeUpdateCard.tsx");
    expect(source).not.toMatch(
      /undici|node:fs|app-auth\.server|supabase-server-fetch|playwright|update-service\.server/,
    );
  });

  it("API Drake update é server-only e usa fetch customizado do Supabase via auth", () => {
    const source = read("src/routes/api/integrations/drake/update.ts");
    expect(source).toMatch(/await import\(["']@\/lib\/supabase\/app-auth\.server["']\)/);
    expect(source).toMatch(/await import\(["']@\/lib\/drake\/update-service\.server["']\)/);
    expect(source).not.toMatch(/from\s+["']playwright["']/);
  });

  it("cliente Supabase do navegador permanece sem fetch customizado server-side", () => {
    const source = read("src/integrations/supabase/client.ts");
    expect(source).not.toMatch(/undici|node:fs|supabase-server-fetch/);
  });

  it("nenhum código usa NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
    for (const file of [
      "src/lib/supabase/supabase-server-fetch.ts",
      "src/lib/supabase/app-auth.server.ts",
      "src/routes/api/integrations/drake/update.ts",
    ]) {
      expect(read(file)).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    }
  });
});
