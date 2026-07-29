// O Supabase/PostgREST corta silenciosamente em 1000 linhas por padrão quando a consulta não
// usa `.range()` — várias tabelas do app já passam disso (timesheet_dias, timesheet_semanas,
// timesheet_embarques, hist_novo_periodos), então uma consulta "select tudo" sem paginação
// perde linhas sem erro nenhum. Usar sempre que a consulta puder razoavelmente devolver mais
// de 1000 linhas. `buildQuery` monta a query do zero a cada página (não reaproveita builder),
// só trocando o `.range(from, to)` do final.
//
// Busca a 1ª página primeiro; se ela vier cheia (sinal de que há mais), dispara as páginas
// seguintes em paralelo (em vez de uma de cada vez) — reduz um carregamento de ~15-20s em
// telas com tabelas grandes (ex.: Timesheet Offshore) pra pouco mais que o tempo de uma única
// requisição. MAX_PAGES cobre até 40.000 linhas, bem acima das maiores tabelas do app hoje
// (timesheet_dias, a maior, tem uns 25.000); páginas além do fim real só voltam vazias — uma
// consulta indexada rápida, não um problema mesmo disparando várias em paralelo.
export async function selectAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const PAGE = 1000;
  const MAX_PAGES = 40;

  const primeira = await buildQuery(0, PAGE - 1);
  if (primeira.error) throw primeira.error;
  const primeiraData = (primeira.data ?? []) as T[];
  if (primeiraData.length < PAGE) return primeiraData;

  const resto = await Promise.all(
    Array.from({ length: MAX_PAGES - 1 }, (_, i) => {
      const pagina = i + 1;
      return Promise.resolve(buildQuery(pagina * PAGE, pagina * PAGE + PAGE - 1));
    }),
  );

  const all = [...primeiraData];
  for (const { data, error } of resto) {
    if (error) throw error;
    if (data && data.length) all.push(...(data as T[]));
  }
  return all;
}
