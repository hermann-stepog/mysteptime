import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type Nomination, type NominationStatus } from "@/lib/nominations";

// Sininho de solicitações de nomeação pra Logística de Pessoal (pedido dela, 2026-10-28). As
// notificações nascem no banco (gatilho nomination_notificar_logistica, ver migration
// 20261028000002) pra logistics_operator e administrador; o sino fica no topo do sistema e
// leva pra aba "Notificações" dentro de Nomeações. Também avisa das reprovações de qualquer
// etapa (migration 20261028000003).
export const NOTIFICACOES_NOMEACOES_ROLES = ["logistics_operator", "administrador"];

const PREFIXO_LINK = "/admin/nominations";

export interface NotificacaoNomeacao {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

// `card` do link é o request_group_id da solicitação (ou o id, quando não tem grupo).
export function cardDaNotificacao(n: NotificacaoNomeacao): string | null {
  if (!n.link) return null;
  const q = n.link.split("?")[1];
  return q ? new URLSearchParams(q).get("card") : null;
}

export function useNotificacoesNomeacoes() {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;
  const ativo = !!userId && NOTIFICACOES_NOMEACOES_ROLES.includes(role ?? "");
  const qc = useQueryClient();

  const query = useQuery<NotificacaoNomeacao[]>({
    queryKey: ["notificacoes-nomeacoes", userId],
    enabled: ativo,
    // Fallback caso o Realtime não esteja ligado pra tabela.
    refetchInterval: 60_000,
    queryFn: async () => {
      // Filtra pelo próprio usuário: a policy deixa operador ver as notificações de todo mundo.
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, link, read, created_at")
        .eq("user_id", userId!)
        .like("link", `${PREFIXO_LINK}%`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!ativo) return;
    const canal = supabase
      .channel(`notificacoes-nomeacoes-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["notificacoes-nomeacoes", userId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [ativo, userId, qc]);

  const marcarLidas = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from("notifications").update({ read: true }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notificacoes-nomeacoes", userId] }),
  });

  const lista = query.data ?? [];
  const naoLidas = lista.filter((n) => !n.read).length;
  return { ativo, lista, naoLidas, isLoading: query.isLoading, marcarLidas };
}

// Sino do topo: só o contador; o clique leva pra aba Notificações de Nomeações.
export function SinoNotificacoesNomeacoes({ className }: { className?: string }) {
  const { ativo, naoLidas } = useNotificacoesNomeacoes();
  if (!ativo) return null;
  return (
    <Link
      to="/admin/nominations"
      search={{ aba: "notificacoes" }}
      title={
        naoLidas > 0
          ? `${naoLidas} notificação${naoLidas > 1 ? "ões" : ""} de nomeações não lida${naoLidas > 1 ? "s" : ""}`
          : "Notificações de nomeações"
      }
      className={cn("relative shrink-0 transition-colors", className)}
    >
      <Bell className="h-5 w-5" />
      {naoLidas > 0 && (
        <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#0f2744]">
          {naoLidas > 99 ? "99+" : naoLidas}
        </span>
      )}
    </Link>
  );
}

// Reprovações (Qualidade, PM, SMS, DP, recusa, devolução de etapa — ver migration
// 20261028000003) aparecem em vermelho na lista. Reconhecidas pelo título gravado no banco.
export function ehReprovacao(n: NotificacaoNomeacao) {
  return /reprova|recusada|cancelada|devolvida|bloqueio|não está em dia|não apto/i.test(n.title);
}

function tempoRelativo(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Aba "Notificações" dentro de Nomeações: clicar na notificação marca como lida e mostra o card
// da solicitação destacado no kanban; clicar numa função abre o detalhe dela direto.
export function NotificacoesNomeacoesTab({
  nominations,
  onOpen,
  onVerNoKanban,
}: {
  nominations: Nomination[];
  onOpen: (n: Nomination) => void;
  onVerNoKanban: (funcoes: Nomination[]) => void;
}) {
  const { lista, naoLidas, isLoading, marcarLidas } = useNotificacoesNomeacoes();

  const porCard = useMemo(() => {
    const m = new Map<string, Nomination[]>();
    nominations.forEach((n) => {
      const k = n.request_group_id ?? n.id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    });
    return m;
  }, [nominations]);

  const funcoesDoCard = (card: string | null) =>
    card ? (porCard.get(card) ?? nominations.filter((n) => n.id === card)) : [];

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {naoLidas > 0
            ? `${naoLidas} não lida${naoLidas > 1 ? "s" : ""}`
            : "Tudo lido"}
        </p>
        {naoLidas > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={marcarLidas.isPending}
            onClick={() => marcarLidas.mutate(lista.filter((n) => !n.read).map((n) => n.id))}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Marcar todas como lidas
          </Button>
        )}
      </div>

      {lista.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-sm text-muted-foreground">
          <Bell className="h-6 w-6" />
          Nenhuma notificação de solicitação ainda.
        </Card>
      ) : (
        <div className="space-y-2">
          {lista.map((n) => {
            const funcoes = funcoesDoCard(cardDaNotificacao(n));
            const primeira = funcoes[0];
            const status = primeira?.current_status as NominationStatus | undefined;
            const reprovacao = ehReprovacao(n);
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!n.read) marcarLidas.mutate([n.id]);
                  if (funcoes.length > 0) onVerNoKanban(funcoes);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.click();
                }}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
                  n.read
                    ? "bg-background"
                    : reprovacao
                      ? "border-red-200 bg-red-50/70"
                      : "border-blue-200 bg-blue-50/70",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    n.read ? "bg-transparent" : reprovacao ? "bg-red-500" : "bg-blue-500",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p
                      className={cn(
                        "flex items-center gap-1.5 text-sm",
                        !n.read && "font-semibold",
                        reprovacao && "text-red-700",
                      )}
                    >
                      {reprovacao && <XCircle className="h-3.5 w-3.5 shrink-0" />}
                      {n.title}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {tempoRelativo(n.created_at)}
                    </span>
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                  {funcoes.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {funcoes.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          title="Abrir esta função"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!n.read) marcarLidas.mutate([n.id]);
                            onOpen(f);
                          }}
                          className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium hover:border-primary hover:text-primary"
                        >
                          {f.funcao}
                          {f.quantidade > 1 && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              ×{f.quantidade}
                            </span>
                          )}
                        </button>
                      ))}
                      {status && (
                        <span className="text-xs text-muted-foreground">
                          etapa atual: {STATUS_LABELS[status] ?? status}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      Solicitação não encontrada (pode ter sido excluída).
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
