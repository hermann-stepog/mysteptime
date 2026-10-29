import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { selectAllPages } from "@/lib/supabasePaginate";
import type { Nomination } from "@/lib/nominations";
import {
  calcularTempoPorEtapa,
  calcularTemposMedios,
  contarPorUnidade,
  formatarDuracao,
  type HistoricoIndicador,
  type UnidadeIndicador,
} from "@/lib/nominationIndicadores";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Aba "Dashboard" de Nomeações (pedido dela, 2026-10-29 — primeiro tentou-se um painel na faixa
// ao lado das abas, ficou apertado): tempos médios em dias/horas/minutos, tempo médio em cada
// etapa do fluxo e nomeações por unidade. Cálculos em lib/nominationIndicadores.ts; conta por
// FUNÇÃO (cada linha de nominations, que é o que anda sozinho no kanban).

const AZUL = "#2563EB";
const VERMELHO = "#DC2626";
const VERDE = "#16A34A";

// Tons suaves, um por etapa (fundo do segmento + texto escuro da mesma família).
const CORES_ETAPA = [
  { bg: "#E2E8F0", text: "#334155" },
  { bg: "#BFDBFE", text: "#1E3A8A" },
  { bg: "#DDD6FE", text: "#4C1D95" },
  { bg: "#FBCFE8", text: "#831843" },
  { bg: "#FED7AA", text: "#7C2D12" },
  { bg: "#FDE68A", text: "#713F12" },
  { bg: "#A5F3FC", text: "#164E63" },
  { bg: "#C7D2FE", text: "#312E81" },
  { bg: "#BBF7D0", text: "#14532D" },
];

// Histórico de etapas de todas as nomeações — também usado pelo kanban (cards retrocedidos
// piscando, ver nomeacoesRetrocedidas).
export function useHistoricoNomeacoes(nominations: Nomination[]) {
  const query = useQuery<HistoricoIndicador[]>({
    queryKey: ["nomination-history-indicadores"],
    queryFn: () =>
      selectAllPages<HistoricoIndicador>((from, to) =>
        supabase
          .from("nomination_status_history")
          .select("nomination_id, status, changed_at")
          .range(from, to),
      ),
  });
  // Card mudou de etapa (a lista de nomeações foi recarregada) → relê o histórico também.
  const assinatura = useMemo(
    () => nominations.map((n) => `${n.id}:${n.current_status}`).join("|"),
    [nominations],
  );
  const { refetch } = query;
  useEffect(() => {
    void refetch();
  }, [assinatura, refetch]);
  return query;
}

function Ajuda({ texto }: { texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="h-3.5 w-3.5 shrink-0 cursor-help text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{texto}</TooltipContent>
    </Tooltip>
  );
}

function plural(n: number) {
  return `${n} ${n === 1 ? "função" : "funções"}`;
}

function CardTempo({
  titulo,
  ms,
  amostras,
  ajuda,
  destaque = false,
}: {
  titulo: string;
  ms: number | null;
  amostras: number;
  ajuda: string;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque ? "border-[#1e3a5f]/30 bg-[#1e3a5f]/[0.03] p-4" : "p-4"}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {titulo}
        <Ajuda texto={ajuda} />
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
        {formatarDuracao(ms)}
      </p>
      <p className="text-xs text-muted-foreground">
        {amostras > 0 ? `média de ${plural(amostras)}` : "sem dados ainda"}
      </p>
    </Card>
  );
}

function TempoPorEtapa({
  nominations,
  historico,
}: {
  nominations: Nomination[];
  historico: HistoricoIndicador[];
}) {
  const etapas = useMemo(
    () => calcularTempoPorEtapa(nominations, historico),
    [nominations, historico],
  );
  const total = etapas.reduce((acc, e) => acc + (e.media ?? 0), 0);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Tempo médio em cada etapa</h3>
          <Ajuda texto="Quanto tempo, em média, uma função fica em cada etapa do kanban, da entrada até passar pra próxima. A etapa em que a função está agora só entra na média depois que ela sair. Canceladas não entram." />
        </div>
        <p className="text-sm text-muted-foreground">
          Soma das etapas:{" "}
          <span className="font-semibold text-foreground">
            {total > 0 ? formatarDuracao(total) : "—"}
          </span>
        </p>
      </div>

      {/* Funil horizontal: cada segmento proporcional ao tempo da etapa, com o tempo escrito. */}
      <TooltipProvider delayDuration={100}>
        <div className="flex h-9 w-full overflow-hidden rounded-lg bg-muted">
          {total > 0 &&
            etapas.map((e, i) => {
              if (!e.media) return null;
              const largura = (e.media / total) * 100;
              const cor = CORES_ETAPA[i % CORES_ETAPA.length];
              return (
                <Tooltip key={e.status}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex cursor-default items-center justify-center overflow-hidden whitespace-nowrap border-r border-white/70 px-1 text-xs font-semibold last:border-r-0"
                      style={{ width: `${largura}%`, backgroundColor: cor.bg, color: cor.text }}
                    >
                      {largura >= 7 ? formatarDuracao(e.media) : ""}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    <span className="font-semibold">{e.nome}</span>: {formatarDuracao(e.media)}{" "}
                    <span className="text-muted-foreground">({plural(e.amostras)})</span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </div>
      </TooltipProvider>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {etapas.map((e, i) => {
          const cor = CORES_ETAPA[i % CORES_ETAPA.length];
          return (
            <div key={e.status} className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cor.bg }}
                />
                <span className="truncate">{e.nome}</span>
              </div>
              <p
                className="text-sm font-semibold"
                style={{ color: e.media ? cor.text : undefined }}
              >
                {formatarDuracao(e.media)}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TooltipUnidade({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: UnidadeIndicador }[];
}) {
  if (!active || !payload?.length) return null;
  const u = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{u.unidade}</p>
      {(
        [
          ["Solicitadas", u.solicitadas, AZUL],
          ["Pendentes", u.pendentes, VERMELHO],
          ["Atendidas", u.atendidas, VERDE],
        ] as const
      ).map(([nome, qtd, cor]) => (
        <p key={nome} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} />
          {nome}: <span className="font-semibold">{qtd}</span>
        </p>
      ))}
    </div>
  );
}

function NomeacoesPorUnidade({ nominations }: { nominations: Nomination[] }) {
  const dados = useMemo(() => contarPorUnidade(nominations), [nominations]);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Nomeações por unidade</h3>
          <Ajuda texto="Por função. Solicitadas = todas (número azul no topo da coluna). Pendentes = em qualquer etapa antes de Equipe Formada. Atendidas = Equipe Formada concluída. Canceladas contam só em Solicitadas." />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {(
            [
              ["Solicitadas", AZUL],
              ["Pendentes", VERMELHO],
              ["Atendidas", VERDE],
            ] as const
          ).map(([nome, cor]) => (
            <span key={nome} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cor }} />
              {nome}
            </span>
          ))}
        </div>
      </div>
      {dados.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma nomeação ainda.</p>
      ) : (
        // Todas as unidades no gráfico: com muitas, cada coluna mantém uma largura mínima e o
        // gráfico ganha rolagem horizontal em vez de espremer os nomes.
        <div className="overflow-x-auto">
          <div className="h-72" style={{ minWidth: dados.length * 72 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dados}
                margin={{ top: 20, right: 8, bottom: 0, left: -16 }}
                barCategoryGap="18%"
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="unidade"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fontSize: 12, fill: "#475569" }}
                  tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#94A3B8" }}
                />
                <RTooltip
                  content={<TooltipUnidade />}
                  cursor={{ fill: "rgba(148,163,184,0.12)" }}
                />
                <Bar dataKey="pendentes" stackId="u" fill={VERMELHO} maxBarSize={110}>
                  <LabelList
                    dataKey="pendentes"
                    position="center"
                    style={{ fontSize: 11, fontWeight: 600, fill: "#fff" }}
                    formatter={(v: number) => (v > 0 ? v : "")}
                  />
                </Bar>
                <Bar
                  dataKey="atendidas"
                  stackId="u"
                  fill={VERDE}
                  maxBarSize={110}
                  radius={[4, 4, 0, 0]}
                >
                  <LabelList
                    dataKey="atendidas"
                    position="center"
                    style={{ fontSize: 11, fontWeight: 600, fill: "#fff" }}
                    formatter={(v: number) => (v > 0 ? v : "")}
                  />
                  <LabelList
                    dataKey="solicitadas"
                    position="top"
                    style={{ fontSize: 13, fontWeight: 700, fill: AZUL }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  );
}

export function DashboardNomeacoes({ nominations }: { nominations: Nomination[] }) {
  const { data: historico = [], isLoading } = useHistoricoNomeacoes(nominations);
  const t = useMemo(() => calcularTemposMedios(nominations, historico), [nominations, historico]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <CardTempo
            titulo="Tempo médio de abertura"
            ms={isLoading ? null : t.abertura}
            amostras={t.amostras.abertura}
            ajuda="Tempo médio entre a criação da solicitação e o recebimento pela Logística."
          />
          <CardTempo
            titulo="Tempo médio de resposta"
            ms={isLoading ? null : t.resposta}
            amostras={t.amostras.resposta}
            ajuda="Tempo médio para a Logística indicar os colaboradores após receber a solicitação."
          />
          <CardTempo
            titulo="Tempo médio de atendimento"
            ms={isLoading ? null : t.atendimento}
            amostras={t.amostras.atendimento}
            ajuda="Tempo médio total, da solicitação até a equipe formada."
            destaque
          />
        </div>
        <TempoPorEtapa nominations={nominations} historico={historico} />
        <NomeacoesPorUnidade nominations={nominations} />
      </div>
    </TooltipProvider>
  );
}
