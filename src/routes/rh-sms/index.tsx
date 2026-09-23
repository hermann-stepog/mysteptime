import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { PassagensAereasPage } from "@/routes/admin/passagens-aereas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/rh-sms/")({
  head: () => pageTitle("Validação de Nomeações"),
  component: RhSmsHome,
});

// Só duas coisas nessa área (pedido dela): o kanban de Nomeações (só os cartões da própria
// etapa se movem — ver STAGE_ROLE) e o Relatório de Viagens Internacionais, que RH/SMS já
// acompanhavam antes dentro de /admin/passagens-aereas.
function RhSmsHome() {
  const [tab, setTab] = useState("nomeacoes");
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
        <PassagensAereasPage />
      </TabsContent>
    </Tabs>
  );
}
