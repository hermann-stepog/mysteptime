import { createFileRoute } from "@tanstack/react-router";
import { Calculator } from "lucide-react";
import { pageTitle } from "@/lib/pageTitle";
import { BannerSimulacao } from "@/components/costSimulator/BannerSimulacao";
import { NovaSimulacaoTab } from "@/components/costSimulator/NovaSimulacaoTab";

export const Route = createFileRoute("/admin/cost-simulator")({
  head: () => pageTitle("Simulador de Custos Logísticos"),
  component: CostSimulatorPage,
});

// Etapa 2 do módulo (ver plano): RPC + motor de cálculo + formulário básico sem estilo — as
// abas (Nova Simulação / Cenários Salvos), o layout final e os gráficos entram nas próximas etapas.
function CostSimulatorPage() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Simulador de Custos Logísticos</h1>
      </div>
      <BannerSimulacao />
      <NovaSimulacaoTab />
    </div>
  );
}
