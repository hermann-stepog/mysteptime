import { describe, expect, it, vi } from "vitest";
import { saveNominationRequest } from "./nomination-creation";
import type { Nomination } from "./nominations";

describe("cadastro de várias funções", () => {
  const rows = [
    { funcao: "SUPERVISOR", quantidade: 1, request_group_id: "grupo" },
    { funcao: "MECANICO", quantidade: 3, request_group_id: "grupo" },
  ];
  it("envia todas as funções e a equipe fixa em uma única gravação", async () => {
    const saved = rows.map((r, i) => ({ ...r, id: String(i) })) as Nomination[];
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
    expect(await saveNominationRequest(rpc, rows, "2026-11-17")).toEqual(saved);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("nomination_create_request", { p_rows: rows, p_proxima_troca: "2026-11-17" });
  });
  it("não confirma sucesso se a gravação integral falhar", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Falha ao salvar equipe fixa" } });
    await expect(saveNominationRequest(rpc, rows, "2026-11-17")).rejects.toThrow("Falha ao salvar equipe fixa");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("não aceita retorno com apenas a primeira função", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [rows[0]], error: null });
    await expect(saveNominationRequest(rpc, rows, null)).rejects.toThrow("confirmar todas as funções");
  });
});