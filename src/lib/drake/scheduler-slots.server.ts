import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DrakeScheduleSlot = {
  key: string;
  scheduledFor: string;
};

export async function tryClaimDrakeScheduleSlot(
  db: SupabaseClient,
  slot: DrakeScheduleSlot,
  claimedBy: string,
): Promise<boolean> {
  const { error } = await db.from("drake_scheduler_slots").insert({
    slot_key: slot.key,
    scheduled_for: slot.scheduledFor,
    claimed_by: claimedBy,
    status: "running",
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Não foi possível reservar a janela automática do Drake: ${error.message}`);
}

export async function completeDrakeScheduleSlot(
  db: SupabaseClient,
  slotKey: string,
  status: "success" | "error",
  errorMessage?: string,
): Promise<void> {
  const { error } = await db
    .from("drake_scheduler_slots")
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_message: errorMessage?.slice(0, 2000) ?? null,
    })
    .eq("slot_key", slotKey);
  if (error)
    throw new Error(`Não foi possível concluir a janela automática do Drake: ${error.message}`);
}
