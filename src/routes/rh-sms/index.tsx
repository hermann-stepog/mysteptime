import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { PassagensAereasPage } from "@/routes/admin/passagens-aereas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/rh-sms/")({
  head: () => pageTitle("Validação de Nomeações"),
  component: RhSmsHome,
});

// SMS só precisa ver/validar Nomeações (pedido dela) — sem a aba de Viagens Internacionais.
// RH continua com as duas: o kanban de Nomeações (só os cartões da própria etapa se movem — ver
// STAGE_ROLE) e o Relatório de Viagens Internacionais, que já acompanhava antes dentro de
// /admin/passagens-aereas (aqui só o relatório — "Solicitações" fica escondida, ver
// onlyInternational em PassagensAereasPage).
function RhSmsHome() {
  const { role } = useAuth();
  const [tab, setTab] = useState("nomeacoes");

  if (role === "sms") return <NominationsPage onlyKanban />;

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="nomeacoes">Nomeações</TabsTrigger>
        <TabsTrigger value="viagens">Viagens Internacionais</TabsTrigger>
      </TabsList>
      <TabsContent value="nomeacoes" className="pt-4">
        <NominationsPage onlyKanban />
      </TabsContent>
      <TabsContent value="viagens" className="pt-4">
        <PassagensAereasPage onlyInternational />
      </TabsContent>
    </Tabs>
  );
}
