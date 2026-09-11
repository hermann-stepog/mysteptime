// O Supabase/PostgREST corta silenciosamente em 1000 linhas por padrão quando a consulta não
// usa `.range()` — várias tabelas do app já passam disso (timesheet_dias, timesheet_semanas,
// timesheet_embarques, hist_novo_periodos), então uma consulta "select tudo" sem paginação
// perde linhas sem erro nenhum. Usar sempre que a consulta puder razoavelmente devolver mais
// de 1000 linhas. `buildQuery` monta a query do zero a cada página (não reaproveita builder),
// só trocando o `.range(from, to)` do final.
//
// Busca páginas em pequenos lotes paralelos e interrompe no primeiro lote que chega ao fim.
// Antes, qualquer resultado com 1.000+ linhas disparava imediatamente outras 39 requisições,
// mesmo quando a tabela tinha apenas 1.001 linhas. A concorrência limitada mantém a velocidade
// nas tabelas grandes sem saturar o navegador/PostgREST nas telas que montam várias consultas.
export async function selectAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const MAX_PAGES = 40;
  const CONCURRENT_PAGES = 4;

  const primeira = await buildQuery(0, PAGE - 1);
  if (primeira.error) throw primeira.error;
  const primeiraData = (primeira.data ?? []) as T[];
  if (primeiraData.length < PAGE) return primeiraData;

  const all = [...primeiraData];
  for (let firstPage = 1; firstPage < MAX_PAGES; firstPage += CONCURRENT_PAGES) {
    const pageNumbers = Array.from(
      { length: Math.min(CONCURRENT_PAGES, MAX_PAGES - firstPage) },
      (_, index) => firstPage + index,
    );
    const batch = await Promise.all(
      pageNumbers.map((pageNumber) =>
        Promise.resolve(buildQuery(pageNumber * PAGE, pageNumber * PAGE + PAGE - 1)),
      ),
    );

    let reachedEnd = false;
    for (const { data, error } of batch) {
      if (error) throw error;
      const rows = (data ?? []) as T[];
      if (!reachedEnd) all.push(...rows);
      if (rows.length < PAGE) reachedEnd = true;
    }
    if (reachedEnd) return all;
  }
  return all;
}

// Versão conservadora para fluxos críticos de fechamento/medição. Busca somente a próxima
// página necessária e para assim que o Supabase devolver menos de PAGE linhas. Isso evita
// abrir dezenas de requisições simultâneas no navegador e transformar uma falha transitória
// (limite de conexões/rate limit) em um resultado aparentemente vazio.
export async function selectAllPagesSequential<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
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
  buildQuery: (chunk: V[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
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
