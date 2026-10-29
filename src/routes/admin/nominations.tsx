import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { pageTitle } from "@/lib/pageTitle";
import { useAuth } from "@/hooks/useAuth";

type NominationsSearch = { aba?: string };

export const Route = createFileRoute("/admin/nominations")({
  head: () => pageTitle("Nomeações"),
  component: AdminNominations,
  // "aba" permite o sininho do topo abrir direto a aba Notificações (?aba=notificacoes).
  validateSearch: (s: Record<string, unknown>): NominationsSearch => ({
    aba: typeof s.aba === "string" ? s.aba : undefined,
  }),
});

// Qualidade enxerga só o kanban (sem abas extras nem "Nova Solicitação"). Solicitante Master
// (Projetos ADM) continua com "Nova Solicitação" e as demais abas normais, só sem Aptidão
// (Matriz de Qualificação não é assunto dele — pedido dela, 2026-10-02). Produção
// (aprovacao_tecnica) passou a ver todas as abas, incluindo Aptidão (pedido dela, 2026-10-05).
function AdminNominations() {
  const { role } = useAuth();
  const { aba } = Route.useSearch();
  const navigate = useNavigate();
  // Depois que a página troca pra aba pedida, limpa a URL — senão clicar no sino de novo (com a
  // URL já em ?aba=notificacoes) não mudaria nada.
  const limparAba = useCallback(
    () => navigate({ to: "/admin/nominations", search: {}, replace: true }),
    [navigate],
  );
  return (
    <NominationsPage
      onlyKanban={role === "qualidade"}
      hideAptidao={role === "solicitante_master"}
      hideCreate={role === "aprovacao_tecnica"}
      abaInicial={aba}
      onAbaConsumida={limparAba}
    />
  );
}
