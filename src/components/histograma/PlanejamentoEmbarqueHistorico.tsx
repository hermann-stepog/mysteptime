import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { getContrastText } from "@/lib/histogramaNovo";
import { fmtDateHeadcount } from "@/components/histograma/HistogramaOffshoreNovo";
import {
  usePlanejamentoEmbarqueQuery, usePlanejamentoEmbarqueSnapshotsQuery,
  type PlanejamentoEmbarqueSnapshotRow,
} from "@/components/histograma/PlanejamentoEmbarqueTab";

// Paleta cíclica pra colorir cada Status distinto que aparecer nas fotos — o Status do
// Planejamento de Embarque é texto livre (não um enum fixo como no Histograma do Drake), então
// as cores são atribuídas dinamicamente aos valores que realmente existem nos dados, em vez de
// um mapeamento fixo por nome.
const HISTOGRAMA_PALETTE = [
  "#0A57B0", "#12A277", "#F59E0B", "#DC2626", "#7C3AED", "#0EA5E9",
  "#DB2777", "#65A30D", "#EA580C", "#4338CA", "#0D9488", "#B45309",
];

function abreviarStatus(status: string): string {
  const letras = status.toUpperCase().replace(/[^A-ZÀ-Ÿ]/g, "");
  return (letras || status.toUpperCase()).slice(0, 3);
}

// Página cheia (não painel lateral) com um histograma simples: uma linha por colaborador, uma
// coluna por dia com foto registrada, célula colorida pelo Status daquele dia — mesma ideia
// visual da grade do Histograma (módulo Histograma Offshore), só que a partir das fotos diárias
// do Planejamento de Embarque (ver planejamento_embarque_snapshots) em vez do Drake, já que essa
// listagem não guarda histórico sozinha (as datas são reescritas a cada edição).
export function PlanejamentoEmbarqueHistoricoPage() {
  const { data: registros = [] } = usePlanejamentoEmbarqueQuery();
  const { data: snapshots = [], isLoading } = usePlanejamentoEmbarqueSnapshotsQuery();

  const datas = useMemo(
    () => Array.from(new Set(snapshots.map((s) => s.snapshot_date))).sort(),
    [snapshots],
  );

  // Todo mundo que já apareceu em alguma foto + todo mundo que está na lista hoje (mesmo que
  // ainda sem nenhuma foto tirada) — "histograma de tudo que tem nessa lista".
  const nomes = useMemo(() => {
    const set = new Set<string>();
    registros.forEach((r) => set.add(r.nome));
    snapshots.forEach((s) => set.add(s.colaborador_nome));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [registros, snapshots]);

  const porNomeEData = useMemo(() => {
    const m = new Map<string, Map<string, PlanejamentoEmbarqueSnapshotRow>>();
    snapshots.forEach((s) => {
      if (!m.has(s.colaborador_nome)) m.set(s.colaborador_nome, new Map());
      m.get(s.colaborador_nome)!.set(s.snapshot_date, s);
    });
    return m;
  }, [snapshots]);

  const statusesUnicos = useMemo(
    () => Array.from(new Set(snapshots.map((s) => (s.status ?? "").trim() || "Sem status"))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [snapshots],
  );
  const corPorStatus = useMemo(() => {
    const m = new Map<string, string>();
    statusesUnicos.forEach((s, i) => m.set(s, HISTOGRAMA_PALETTE[i % HISTOGRAMA_PALETTE.length]));
    return m;
  }, [statusesUnicos]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <History className="h-5 w-5 text-muted-foreground" />Histórico do Planejamento de Embarque
          </h1>
          <p className="text-sm text-muted-foreground">
            Uma foto por colaborador, tirada uma vez por dia — a listagem de Planejamento de Embarque só mostra o
            estado atual (as datas são reescritas a cada edição), então é aqui que fica o histórico de verdade.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/histograma-novo" search={{ tab: "planejamento" }}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Voltar
          </Link>
        </Button>
      </div>

      {!isLoading && datas.length === 0 ? (
        <EmptyState
          icon={History}
          title="Ainda sem histórico registrado"
          description="A primeira foto é tirada automaticamente na próxima vez que a aba Planejamento de Embarque for aberta."
        />
      ) : (
        <>
          {statusesUnicos.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {statusesUnicos.map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <i className="inline-block h-2.5 w-3.5 rounded-sm" style={{ backgroundColor: corPorStatus.get(s) }} />
                  {s}
                </span>
              ))}
            </div>
          )}
          <Card className="overflow-auto p-0" style={{ maxHeight: "70vh" }}>
            <table className="border-collapse text-[10px]" style={{ minWidth: "100%" }}>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[180px] border border-border bg-muted px-2 py-1.5 text-left font-medium">Colaborador</th>
                  {datas.map((d) => (
                    <th key={d} className="min-w-[46px] border border-border bg-muted px-1 py-1 text-center font-normal">{fmtDateHeadcount(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nomes.map((nome) => (
                  <tr key={nome} className="hover:bg-muted/30">
                    <td className="sticky left-0 z-10 border border-border bg-background px-2 py-1 font-medium truncate max-w-[180px]">{nome}</td>
                    {datas.map((d) => {
                      const snap = porNomeEData.get(nome)?.get(d);
                      if (!snap) return <td key={d} className="border border-border bg-[#f8fafc] p-0" />;
                      const status = (snap.status ?? "").trim() || "Sem status";
                      const cor = corPorStatus.get(status) ?? "#94a3b8";
                      return (
                        <td key={d} className="border border-border p-0 text-center" title={`${nome} · ${fmtDateHeadcount(d)} · ${status}${snap.unidade ? ` · ${snap.unidade}` : ""}`}>
                          <div className="flex h-6 w-full items-center justify-center font-bold" style={{ backgroundColor: cor, color: getContrastText(cor) }}>
                            {abreviarStatus(status)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
