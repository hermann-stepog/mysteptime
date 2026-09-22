import { createFileRoute } from "@tanstack/react-router";
import { PlanejamentoEmbarqueHistoricoPage } from "@/components/histograma/PlanejamentoEmbarqueHistorico";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/planejamento-embarque-historico")({
  head: () => pageTitle("Histórico — Planejamento de Embarque"),
  component: PlanejamentoEmbarqueHistoricoPage,
});
