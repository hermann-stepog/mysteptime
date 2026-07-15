// Título de aba por rota — usado no `head()` de cada arquivo de rota, ex.:
// head: () => pageTitle("Histograma Offshore")
// O nome da marca fica centralizado aqui (ver __root.tsx pro título padrão da raiz).
export function pageTitle(name: string) {
  return { meta: [{ title: `${name} - My Step Time` }] };
}
