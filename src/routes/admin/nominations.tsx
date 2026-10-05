import { createFileRoute } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/admin/nominations")({
  head: () => pageTitle("Nomeações"),
  component: AdminNominations,
});

// Qualidade enxerga só o kanban (sem abas extras nem "Nova Solicitação"). Solicitante Master
// (Projetos ADM) continua com "Nova Solicitação" e as demais abas normais, só sem Aptidão
// (Matriz de Qualificação não é assunto dele — pedido dela, 2026-10-02). Produção
// (aprovacao_tecnica) passou a ver todas as abas, incluindo Aptidão (pedido dela, 2026-10-05).
function AdminNominations() {
  const { role } = useAuth();
  return (
    <NominationsPage
      onlyKanban={role === "qualidade"}
      hideAptidao={role === "solicitante_master"}
      hideCreate={role === "aprovacao_tecnica"}
    />
  );
}
