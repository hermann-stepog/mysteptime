import type { Nomination } from "./nominations";

export async function saveNominationRequest(
  rpc: (name: string, args: { p_rows: Record<string, unknown>[]; p_proxima_troca: string | null }) => PromiseLike<{ data: Nomination[] | null; error: { message: string } | null }>,
  rows: Record<string, unknown>[],
  nextRotation: string | null,
): Promise<Nomination[]> {
  const { data, error } = await rpc("nomination_create_request", {
    p_rows: rows,
    p_proxima_troca: nextRotation,
  });
  if (error) throw new Error(error.message);
  if (!data || data.length !== rows.length) {
    throw new Error("Não foi possível confirmar todas as funções. Confira as solicitações antes de tentar novamente.");
  }
  return data;
}