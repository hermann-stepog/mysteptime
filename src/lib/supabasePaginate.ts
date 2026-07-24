// O Supabase/PostgREST corta silenciosamente em 1000 linhas por padrão quando a consulta não
// usa `.range()` — várias tabelas do app já passam disso (timesheet_dias, timesheet_semanas,
// timesheet_embarques, hist_novo_periodos), então uma consulta "select tudo" sem paginação
// perde linhas sem erro nenhum. Usar sempre que a consulta puder razoavelmente devolver mais
// de 1000 linhas. `buildQuery` monta a query do zero a cada página (não reaproveita builder),
// só trocando o `.range(from, to)` do final.
export async function selectAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: T[] = [];
  for (;;) {
    const { data, error } = await buildQuery(offset, offset + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}
