// Seleção de colaboradores no assistente de BM de Mão de Obra Offshore.
// Funções puras pra a busca/filtro não alterar o conjunto selecionado e pra o BM
// persistir somente quem a usuária marcou — sem incluir automaticamente todo o BSP.

export function normalizeBmSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function filterColaboradoresBySearch<T extends { colaborador_nome: string; funcao: string }>(
  items: T[],
  query: string,
): T[] {
  const needle = normalizeBmSearch(query);
  if (!needle) return items;
  return items.filter((item) => {
    const nome = normalizeBmSearch(item.colaborador_nome);
    const funcao = normalizeBmSearch(item.funcao);
    return nome.includes(needle) || funcao.includes(needle);
  });
}

export function filterLinesBySelectedIds<T extends { colaborador_id: string | null }>(
  lines: T[],
  selectedIds: Iterable<string>,
): T[] {
  const selected = new Set(selectedIds);
  return lines.filter((line) => !!line.colaborador_id && selected.has(line.colaborador_id));
}

export function toggleIdInSet(current: Iterable<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
