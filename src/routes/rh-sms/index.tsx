import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { PassagensAereasPage } from "@/routes/admin/passagens-aereas";
import { HistogramaOffshoreNovo } from "@/components/histograma/HistogramaOffshoreNovo";
import { EfetivoOffshoreTab } from "@/components/rh/EfetivoOffshoreTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/rh-sms/")({
  head: () => pageTitle("Validação de Nomeações"),
  component: RhSmsHome,
});

// SMS só precisa ver/validar Nomeações (pedido dela) — sem mais nada. RH tem um ambiente bem
// mais completo: Nomeações (só os cartões da própria etapa se movem — ver STAGE_ROLE), o
// Relatório de Viagens Internacionais (já acompanhava antes dentro de /admin/passagens-aereas —
// aqui só o relatório, "Solicitações" fica escondida via onlyInternational), Dashboard +
// Histograma do Histograma Offshore (mesmo componente do operador — ele mesmo já restringe
// Lançamentos/Planejamento de Embarque a quem é operador de verdade, então RH só vê as duas
// abas de consulta) e "Efetivo Offshore", aba nova onde o RH marca bloqueio/justificativa por
// colaborador (ver EfetivoOffshoreTab.tsx e o flag piscando que isso gera em Planejamento de
// Embarque, do lado da Logística).
function RhSmsHome() {
  const { role } = useAuth();
  // Efetivo Offshore é a primeira aba (pedido dela), depois Dashboard e Histograma.
  const [tab, setTab] = useState("efetivo");

  if (role === "sms") return <NominationsPage onlyKanban />;

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="efetivo">Efetivo Offshore</TabsTrigger>
        <TabsTrigger value="histograma">Dashboard e Histograma</TabsTrigger>
        <TabsTrigger value="nomeacoes">Nomeações</TabsTrigger>
        <TabsTrigger value="viagens">Viagens Internacionais</TabsTrigger>
      </TabsList>
      <TabsContent value="efetivo" className="pt-4">
        <EfetivoOffshoreTab />
      </TabsContent>
      <TabsContent value="histograma" className="pt-4">
        {/* Mesmo componente do operador — ele já restringe Lançamentos/Planejamento de
            Embarque a quem é operador de verdade, então aqui só aparecem Dashboard e
            Histograma (as duas sub-abas internas dele), sem precisar de nenhuma prop especial. */}
        <HistogramaOffshoreNovo />
      </TabsContent>
      <TabsContent value="nomeacoes" className="pt-4">
        <NominationsPage onlyKanban />
      </TabsContent>
      <TabsContent value="viagens" className="pt-4">
        <PassagensAereasPage onlyInternational />
      </TabsContent>
    </Tabs>
  );
}
