import { createFileRoute } from "@tanstack/react-router";
import { HistogramaOffshoreNovo } from "@/components/histograma/HistogramaOffshoreNovo";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/histograma-novo")({
  head: () => pageTitle("Histograma Offshore"),
  component: HistogramaOffshoreNovo,
});
