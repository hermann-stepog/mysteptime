import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  addDays, todayStr, weekdayAbbr, ORIGEM_PROGRAMADO,
  type HistNovoColaborador, type HistNovoPeriodo,
} from "@/lib/histogramaNovo";

interface ProximoEvento {
  data: string;
  colaboradorId: string;
  colaboradorNome: string;
  tipo: "embarque" | "desembarque";
  unidade: string | null;
}

const JANELA_DIAS = 7;

// Embarque/desembarque programados pros próximos 7 dias, a partir dos mesmos períodos já
// carregados na aba Lançamentos — sem consulta própria. "Embarque" vem de "P" (dia da
// mobilização) ou "E" recém confirmado (não a continuação origem=programado do 2º dia em
// diante, que é o MESMO embarque, não um evento novo); "Desembarque" é o dia seguinte ao fim
// de um período "E" (mesma regra usada no Histograma pra computar status de desembarque).
function useProximosEventos(periodos: HistNovoPeriodo[], colaboradorById: Map<string, HistNovoColaborador>): ProximoEvento[] {
  return useMemo(() => {
    const hoje = todayStr();
    const limite = addDays(hoje, JANELA_DIAS);
    const eventos: ProximoEvento[] = [];
    periodos.forEach((p) => {
      const c = colaboradorById.get(p.colaborador_id);
      if (!c) return;
      if ((p.tipo === "P" || p.tipo === "E") && p.origem !== ORIGEM_PROGRAMADO && p.data_inicio >= hoje && p.data_inicio <= limite) {
        eventos.push({ data: p.data_inicio, colaboradorId: p.colaborador_id, colaboradorNome: c.nome, tipo: "embarque", unidade: p.unidade_operacional });
      }
      if (p.tipo === "E") {
        const dataDesembarque = addDays(p.data_fim, 1);
        if (dataDesembarque >= hoje && dataDesembarque <= limite) {
          eventos.push({ data: dataDesembarque, colaboradorId: p.colaborador_id, colaboradorNome: c.nome, tipo: "desembarque", unidade: p.unidade_operacional });
        }
      }
    });
    return eventos.sort((a, b) => a.data.localeCompare(b.data) || a.colaboradorNome.localeCompare(b.colaboradorNome));
  }, [periodos, colaboradorById]);
}

function fmtDiaMes(dateStr: string): string {
  return `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

export function ProximosEventosCard({ periodos, colaboradorById, onSelecionarColaborador }: {
  periodos: HistNovoPeriodo[]; colaboradorById: Map<string, HistNovoColaborador>;
  onSelecionarColaborador: (colaboradorId: string) => void;
}) {
  const todosEventos = useProximosEventos(periodos, colaboradorById);
  // Filtro rápido opcional (Embarque/Desembarque) — clicar de novo no mesmo botão volta a
  // mostrar os dois; não precisa de "Buscar", aplica na hora igual ao "Atualizado hoje" que
  // veio antes disso.
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "embarque" | "desembarque">("todos");
  const eventos = useMemo(
    () => (filtroTipo === "todos" ? todosEventos : todosEventos.filter((ev) => ev.tipo === filtroTipo)),
    [todosEventos, filtroTipo],
  );

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Próximos eventos</h3>
          <p className="text-xs text-muted-foreground">Embarques e desembarques nos próximos {JANELA_DIAS} dias.</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            title="Mostrar só Embarque"
            onClick={() => setFiltroTipo((v) => (v === "embarque" ? "todos" : "embarque"))}
            className={cn(
              "h-5 w-5 rounded-sm bg-emerald-600 transition-opacity",
              filtroTipo === "desembarque" ? "opacity-30" : "opacity-100",
              filtroTipo === "embarque" && "ring-2 ring-emerald-600 ring-offset-1",
            )}
          />
          <button
            type="button"
            title="Mostrar só Desembarque"
            onClick={() => setFiltroTipo((v) => (v === "desembarque" ? "todos" : "desembarque"))}
            className={cn(
              "h-5 w-5 rounded-sm bg-orange-500 transition-opacity",
              filtroTipo === "embarque" ? "opacity-30" : "opacity-100",
              filtroTipo === "desembarque" && "ring-2 ring-orange-500 ring-offset-1",
            )}
          />
        </div>
      </div>

      {eventos.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {filtroTipo === "todos" ? `Nenhum evento programado para os próximos ${JANELA_DIAS} dias.` : "Nenhum evento desse tipo nos próximos dias."}
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-auto pr-1">
          {eventos.map((ev, i) => (
            <button
              key={`${ev.colaboradorId}-${ev.tipo}-${ev.data}-${i}`}
              type="button"
              onClick={() => onSelecionarColaborador(ev.colaboradorId)}
              className="flex w-full items-center gap-3 rounded-md border border-border/60 p-2 text-left transition-colors hover:bg-muted/50"
            >
              <div
                className={cn(
                  "flex min-w-[42px] shrink-0 flex-col items-center justify-center rounded px-2 py-1 text-[10px] font-bold leading-tight text-white",
                  ev.tipo === "embarque" ? "bg-emerald-600" : "bg-orange-500",
                )}
              >
                <span>{fmtDiaMes(ev.data)}</span>
                <span className="text-[9px] opacity-80">{weekdayAbbr(ev.data)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{ev.colaboradorNome}</p>
                <p className="truncate text-[11px] text-muted-foreground">{ev.unidade ?? "—"}</p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-[11px] font-medium",
                  ev.tipo === "embarque" ? "text-emerald-600" : "text-orange-600",
                )}
              >
                {ev.tipo === "embarque" ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
                {ev.tipo === "embarque" ? "Embarque" : "Desembarque"}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
