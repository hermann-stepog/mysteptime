import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const REQUIRED_MIGRATION = "20260805130000_drake_histogram_atomic_sync.sql";
const LEASE_SECONDS = 3_600;

export async function acquireDrakeHistogramSyncLease(
  db: SupabaseClient,
  owner: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("try_acquire_drake_histogram_sync", {
    p_owner: owner,
    p_ttl_seconds: LEASE_SECONDS,
  });
  if (error) throw storageError(error);
  return data === true;
}

export async function releaseDrakeHistogramSyncLease(
  db: SupabaseClient,
  owner: string,
): Promise<void> {
  const { error } = await db.rpc("release_drake_histogram_sync", { p_owner: owner });
  if (error) throw storageError(error);
}

function storageError(error: { message: string }): Error {
  if (
    /try_acquire_drake_histogram_sync|release_drake_histogram_sync|schema cache|PGRST202/i.test(
      error.message,
    )
  ) {
    return new Error(
      `O banco ainda não possui o bloqueio distribuído da atualização Drake. Aplique a migration ${REQUIRED_MIGRATION} antes de atualizar novamente.`,
    );
  }
  return new Error(error.message);
}
