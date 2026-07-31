import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

export type DrakeSyncRunStatus = "success" | "partial" | "error";

export interface DrakeSyncRunPayload {
  startedAtMs: number;
  status: DrakeSyncRunStatus;
  triggeredBy: string | null;
  triggeredByLabel: string | null;
  embarquesCriados?: number;
  embarquesAtualizados?: number;
  embarquesEventos?: number;
  disponibilidadeEventos?: number;
  skipped?: number;
  errorMessage?: string;
}

// Grava um registro por execução do "Atualizar dados do Drake" em drake_sync_runs — alimenta a
// lista de logs de sincronização na aba Lançamentos. Nunca deve derrubar a atualização em si por
// causa de um erro aqui (mesma postura de persistIntegrationFailure), só loga um aviso.
export async function recordDrakeSyncRun(
  db: SupabaseClient,
  payload: DrakeSyncRunPayload,
): Promise<void> {
  try {
    const { error } = await (db as any).from("drake_sync_runs").insert({
      started_at: new Date(payload.startedAtMs).toISOString(),
      finished_at: new Date().toISOString(),
      status: payload.status,
      triggered_by: payload.triggeredBy,
      triggered_by_label: payload.triggeredByLabel,
      embarques_criados: payload.embarquesCriados ?? null,
      embarques_atualizados: payload.embarquesAtualizados ?? null,
      embarques_eventos: payload.embarquesEventos ?? null,
      disponibilidade_eventos: payload.disponibilidadeEventos ?? null,
      skipped: payload.skipped ?? null,
      error_message: payload.errorMessage?.slice(0, 2000) ?? null,
    });
    if (error) throw error;
  } catch (error) {
    logger.warn("drake-update", "Falha ao gravar drake_sync_runs (aviso, não bloqueia a atualização)", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
