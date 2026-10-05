import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EnvironmentCredentialsDrakeAuthProvider } from "@/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "@/lib/drake/http/create-drake-http-client.server";
import { fetchDrakeWorkers } from "@/lib/drake/worker-annual-position-api.server";
import {
  fetchLogisticScheduling,
  statusAtualViaLogisticScheduling,
  type StatusLogisticScheduling,
} from "@/lib/drake/logistic-scheduling-api.server";

async function assertAdministrador(supabase: any, userId: string) {
  const { data: roleRow, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (roleRow?.role !== "administrador") throw new Error("Sem permissão pra essa consulta ao Drake.");
}

function normalizeMatricula(m: string | null | undefined): string | null {
  const t = (m ?? "").trim();
  return t ? t.replace(/^0+(?=\d)/, "") : null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const CONCURRENCY = 8;
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// Checagem ao vivo (nada gravado no banco) pra Auditoria Status x Drake (src/components/
// histograma/PlanejamentoStatusAuditoria.tsx) — pedido dela, 2026-10-02: a Ficha Anual de
// Posição já sincronizada (GetPositionsByYear) pode estar desatualizada; LogisticScheduling é
// uma segunda fonte do Drake, mais em tempo real, que confirma se a pessoa já embarcou de
// verdade. Só administrador pode disparar (checado aqui de novo, não só na tela).
export const fetchLogisticSchedulingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ matriculas: z.array(z.string()).max(500) }))
  .handler(async ({ data, context }): Promise<Record<string, StatusLogisticScheduling>> => {
    await assertAdministrador(context.supabase, context.userId);
    if (data.matriculas.length === 0) return {};

    const auth = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
    const client = createDrakeHttpClientFromAuthenticatedSession(auth.authenticatedSession);
    try {
      const workers = await fetchDrakeWorkers(client);
      // Diagnóstico (2026-10-05): o Drake pode ter mais de um cadastro ATIVO com a mesma
      // matrícula (ex.: direto + terceirizado) — se isso acontecer, a Map abaixo fica com
      // qualquer um dos dois arbitrariamente, podendo escolher um worker "errado" e devolver
      // uma programação logística de outro vínculo. Loga pra confirmar se é isso.
      const porMatricula = new Map<string, typeof workers>();
      for (const w of workers) {
        const m = normalizeMatricula(w.registration);
        if (!m) continue;
        if (!porMatricula.has(m)) porMatricula.set(m, []);
        porMatricula.get(m)!.push(w);
      }
      for (const matricula of data.matriculas) {
        const candidatos = porMatricula.get(normalizeMatricula(matricula) ?? "") ?? [];
        if (candidatos.length > 1) {
          console.warn("[planejamentoStatusAuditoria] matrícula com mais de um cadastro ATIVO no Drake", { matricula, candidatos });
        }
      }
      const workerIdPorMatricula = new Map(
        workers.map((w) => [normalizeMatricula(w.registration), w.id] as const).filter(([m]) => m !== null),
      );

      const hoje = todayStr();
      const resultado: Record<string, StatusLogisticScheduling> = {};
      await mapWithConcurrency(data.matriculas, CONCURRENCY, async (matricula) => {
        const workerId = workerIdPorMatricula.get(normalizeMatricula(matricula));
        if (!workerId) {
          console.warn("[planejamentoStatusAuditoria] matrícula sem correspondência de colaborador ATIVO no Drake", { matricula });
          resultado[matricula] = null;
          return;
        }
        try {
          const rows = await fetchLogisticScheduling(client, workerId);
          resultado[matricula] = statusAtualViaLogisticScheduling(rows, hoje);
          console.info("[planejamentoStatusAuditoria]", { matricula, workerId, rows, hoje, status: resultado[matricula] });
        } catch (err) {
          // Falha pontual numa pessoa não derruba a checagem das outras — fica "sem dado" pra ela.
          console.error("[planejamentoStatusAuditoria] falha ao consultar LogisticScheduling", { matricula, workerId, err });
          resultado[matricula] = null;
        }
      });
      return resultado;
    } finally {
      await client.dispose();
    }
  });
