import { createFileRoute } from "@tanstack/react-router";
import { HistogramaOffshoreNovo } from "@/components/histograma/HistogramaOffshoreNovo";
import { pageTitle } from "@/lib/pageTitle";

type HistogramaNovoSearch = { tab?: string };

export const Route = createFileRoute("/admin/histograma-novo")({
  head: () => pageTitle("Histograma Offshore"),
  component: HistogramaOffshoreNovo,
  // "tab" permite deep-link direto pra uma aba (ex.: voltar da página de Histórico do
  // Planejamento de Embarque direto pra aba Planejamento, em vez de cair no Dashboard).
  validateSearch: (s: Record<string, unknown>): HistogramaNovoSearch => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
});
