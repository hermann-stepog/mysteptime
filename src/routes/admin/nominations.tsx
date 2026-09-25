import { createFileRoute } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/admin/nominations")({
  head: () => pageTitle("Nomeações"),
  component: AdminNominations,
});

// Qualidade enxerga só o kanban (sem abas extras nem "Nova Solicitação").
function AdminNominations() {
  const { role } = useAuth();
  return <NominationsPage onlyKanban={role === "qualidade"} />;
}
