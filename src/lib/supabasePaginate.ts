// O Supabase/PostgREST corta silenciosamente em 1000 linhas por padrão quando a consulta não
// usa `.range()` — várias tabelas do app já passam disso (timesheet_dias, timesheet_semanas,
// timesheet_embarques, hist_novo_periodos), então uma consulta "select tudo" sem paginação
// perde linhas sem erro nenhum. Usar sempre que a consulta puder razoavelmente devolver mais
// de 1000 linhas. `buildQuery` monta a query do zero a cada página (não reaproveita builder),
// só trocando o `.range(from, to)` do final.
//
// Busca em pequenos lotes concorrentes e para no primeiro retorno incompleto. O limite de
// concorrência é intencional: disparar todas as 40 páginas possíveis de uma vez saturava o
// PostgREST, mesmo quando a tabela tinha pouco mais de 1.000 linhas, e transformava a abertura
// das telas em dezenas de requisições desnecessárias.
export async function selectAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const PAGE = 1000;
  const MAX_PAGES = 40;
  const CONCURRENT_PAGES = 4;

  const primeira = await buildQuery(0, PAGE - 1);
  if (primeira.error) throw primeira.error;
  const primeiraData = (primeira.data ?? []) as T[];
  if (primeiraData.length < PAGE) return primeiraData;

  const all = [...primeiraData];

  for (let inicio = 1; inicio < MAX_PAGES; inicio += CONCURRENT_PAGES) {
    const paginas = Array.from(
      { length: Math.min(CONCURRENT_PAGES, MAX_PAGES - inicio) },
      (_, indice) => inicio + indice,
    );
    const resultados = await Promise.all(
      paginas.map((pagina) =>
        Promise.resolve(buildQuery(pagina * PAGE, pagina * PAGE + PAGE - 1)),
      ),
    );

    for (const { data, error } of resultados) {
      if (error) throw error;
      const rows = (data ?? []) as T[];
      all.push(...rows);
      if (rows.length < PAGE) return all;
    }
  }

  throw new Error("A consulta ultrapassou o limite seguro de 40.000 registros.");
}

// Versão conservadora para fluxos críticos de fechamento/medição. Busca somente a próxima
// página necessária e para assim que o Supabase devolver menos de PAGE linhas. Isso evita
// abrir dezenas de requisições simultâneas no navegador e transformar uma falha transitória
// (limite de conexões/rate limit) em um resultado aparentemente vazio.
export async function selectAllPagesSequential<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const PAGE = 1000;
  const MAX_PAGES = 40;
  const all: T[] = [];

  for (let pagina = 0; pagina < MAX_PAGES; pagina += 1) {
    const from = pagina * PAGE;
    const result = await buildQuery(from, from + PAGE - 1);
    if (result.error) throw result.error;

    const rows = (result.data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }

  throw new Error("A consulta ultrapassou o limite seguro de 40.000 registros.");
}

// Divide filtros `.in(...)` grandes para não ultrapassar o tamanho máximo da URL do
// PostgREST. Um mês de timesheet pode ter milhares de IDs de semana distintos.
export async function selectInChunks<T, V>(
  values: V[],
  buildQuery: (chunk: V[]) => PromiseLike<{ data: T[] | null; error: any }>,
  chunkSize = 200,
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    const result = await buildQuery(values.slice(i, i + chunkSize));
    if (result.error) throw result.error;
    all.push(...((result.data ?? []) as T[]));
  }
  return all;
}
