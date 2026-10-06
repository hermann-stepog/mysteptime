import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Calculator, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/pageTitle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BannerSimulacao } from "@/components/costSimulator/BannerSimulacao";
import { NovaSimulacaoTab } from "@/components/costSimulator/NovaSimulacaoTab";
import { CenariosSalvosTab } from "@/components/costSimulator/CenariosSalvosTab";
import type { CostSimulationRow } from "@/lib/api/costSimulator.functions";

export const Route = createFileRoute("/admin/cost-simulator")({
  head: () => pageTitle("Simulador de Custos Logísticos"),
  component: CostSimulatorPage,
});

// "Editar" num cenário salvo carrega ele na aba Nova Simulação (chave muda pra remontar o form
// com os valores dele). Salvar um cenário novo devolve a linha pra que "Atualizar" funcione.
function CostSimulatorPage() {
  const [aba, setAba] = useState<"nova" | "salvos">("nova");
  const [carregado, setCarregado] = useState<CostSimulationRow | null>(null);
  const [chaveFormulario, setChaveFormulario] = useState(0);

  function editar(row: CostSimulationRow) {
    setCarregado(row);
    setChaveFormulario((k) => k + 1);
    setAba("nova");
  }

  function limpar() {
    setCarregado(null);
    setChaveFormulario((k) => k + 1);
    setAba("nova");
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Calculator className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Simulador de Custos Logísticos</h1>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={limpar}>
          <Eraser className="mr-1 h-4 w-4" /> Limpar
        </Button>
      </div>
      <BannerSimulacao />

      <Tabs value={aba} onValueChange={(v) => setAba(v as "nova" | "salvos")}>
        <TabsList>
          <TabsTrigger value="nova">Nova Simulação</TabsTrigger>
          <TabsTrigger value="salvos">Cenários Salvos</TabsTrigger>
        </TabsList>
        <TabsContent value="nova" forceMount className={aba === "nova" ? undefined : "hidden"}>
          <NovaSimulacaoTab
            key={chaveFormulario}
            carregado={carregado}
            onSalvo={(row) => setCarregado(row)}
          />
        </TabsContent>
        <TabsContent value="salvos">
          <CenariosSalvosTab onEditar={editar} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
