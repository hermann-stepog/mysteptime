import { describe, expect, it, vi } from "vitest";
import { completeDrakeScheduleSlot, tryClaimDrakeScheduleSlot } from "./scheduler-slots.server";

const slot = {
  key: "drake:60:123",
  scheduledFor: "2026-09-11T12:00:00.000Z",
};

describe("Drake scheduler slots", () => {
  it("reserva uma janela inédita", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn().mockReturnValue({ insert }) } as never;

    await expect(tryClaimDrakeScheduleSlot(db, slot, "user-1")).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ slot_key: slot.key, status: "running" }),
    );
  });

  it("ignora uma janela já reservada por outra instância", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
    const db = { from: vi.fn().mockReturnValue({ insert }) } as never;

    await expect(tryClaimDrakeScheduleSlot(db, slot, "user-1")).resolves.toBe(false);
  });

  it("registra a conclusão da janela", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const db = { from: vi.fn().mockReturnValue({ update }) } as never;

    await completeDrakeScheduleSlot(db, slot.key, "success");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", error_message: null }),
    );
    expect(eq).toHaveBeenCalledWith("slot_key", slot.key);
  });
});
