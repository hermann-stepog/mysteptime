import { createFileRoute } from "@tanstack/react-router";

// API PÚBLICA somente leitura (sem autenticação). Expõe apenas campos operacionais.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};
const HEADERS = { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

const PE_COLUMNS =
  "id, matricula, nome, funcao, especialidade, status, unidade, bsp, embarque, desembarque, duracao_embarque_dias, folga_inicio, folga_fim, ferias_inicio, ferias_fim, programado_1, programado_2, updated_at";
const HIST_COLUMNS = "id, matricula, nome, empresa, funcao, funcao_operacao, ativo";

function norm(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const normMat = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").replace(/^0+/, "") || norm(v);

export function isMontadorAndaimeHabitat(funcao: string | null | undefined): boolean {
  const f = norm(funcao);
  return f.includes("MONTADOR") && f.includes("ANDAIM") && f.includes("HABITAT");
}

async function fetchAll(client: any, table: string, cols: string, order: string) {
  const all: any[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await client.from(table).select(cols).order(order).order("id").range(from, from + page - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return all;
}

export const Route = createFileRoute("/api/public/montadores-andaime-habitat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const [pe, hist] = await Promise.all([
            fetchAll(supabaseAdmin, "planejamento_embarque", PE_COLUMNS, "nome"),
            fetchAll(supabaseAdmin, "hist_novo_colaboradores", HIST_COLUMNS, "nome"),
          ]);

          const byMat = new Map<string, any[]>();
          const byNome = new Map<string, any[]>();
          for (const h of hist) {
            const m = normMat(h.matricula);
            const n = norm(h.nome);
            if (m) byMat.set(m, [...(byMat.get(m) ?? []), h]);
            if (n) byNome.set(n, [...(byNome.get(n) ?? []), h]);
          }

          const colaboradores = pe
            .filter((r) => isMontadorAndaimeHabitat(r.funcao))
            .map((r) => {
              const m = r.matricula ? normMat(r.matricula) : "";
              const n = norm(r.nome);
              const porMat = m ? byMat.get(m) ?? [] : [];
              const porNome = byNome.get(n) ?? [];
              let match: any = null;
              let ambiguo = false;
              const ambos = porMat.filter((h) => norm(h.nome) === n);
              if (ambos.length === 1) match = ambos[0];
              else if (ambos.length > 1) ambiguo = true;
              else if (porMat.length === 1) match = porMat[0];
              else if (porMat.length > 1) ambiguo = true;
              else if (porNome.length === 1) match = porNome[0];
              else if (porNome.length > 1) ambiguo = true;
              return {
                id: r.id,
                matricula: r.matricula,
                nome: r.nome,
                funcao: r.funcao,
                especialidade: r.especialidade,
                status: r.status,
                unidade: r.unidade,
                bsp: r.bsp,
                embarque: r.embarque,
                desembarque: r.desembarque,
                duracao_embarque_dias: r.duracao_embarque_dias,
                folga_inicio: r.folga_inicio,
                folga_fim: r.folga_fim,
                ferias_inicio: r.ferias_inicio,
                ferias_fim: r.ferias_fim,
                programado_1: r.programado_1,
                programado_2: r.programado_2,
                updated_at: r.updated_at,
                atualizado_em: r.updated_at,
                cadastro_drake_id: match?.id ?? null,
                empresa: match?.empresa ?? null,
                funcao_cadastro: match?.funcao ?? null,
                funcao_operacao: match?.funcao_operacao ?? null,
                cadastro_ativo: match ? !!match.ativo : null,
                cadastro_drake_ambiguo: ambiguo,
              };
            });

          const por_status: Record<string, number> = {};
          for (const c of colaboradores) {
            const s = (c.status ?? "").trim() || "SEM STATUS";
            por_status[s] = (por_status[s] ?? 0) + 1;
          }

          return new Response(
            JSON.stringify({
              generated_at: new Date().toISOString(),
              filtro_funcao: "MONTADOR DE ANDAIMES / HABITAT",
              total: colaboradores.length,
              por_status,
              colaboradores,
            }),
            { status: 200, headers: HEADERS },
          );
        } catch {
          return new Response(JSON.stringify({ error: "Falha ao consultar dados" }), { status: 500, headers: HEADERS });
        }
      },
    },
  },
});
