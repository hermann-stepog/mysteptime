// Título de aba por rota — usado no `head()` de cada arquivo de rota, ex.:
// head: () => pageTitle("Histograma Offshore")
// O nome da marca fica centralizado aqui (ver __root.tsx pro título padrão da raiz).
export function pageTitle(name: string) {
  const title = `${name} - My Step Time`;
  const description = `${name} no My Step Time: gestão de logística de pessoal e operações da STEP.`;
  return { meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] };
}
