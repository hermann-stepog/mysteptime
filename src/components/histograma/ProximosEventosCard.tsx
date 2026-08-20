import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  todayStr, weekdayAbbr, E_A_CONFIRMAR_COLOR,
  type HistNovoColaborador, type HistNovoPeriodo,
} from "@/lib/histogramaNovo";
import { buildUpcomingEvents, type ProximoEvento } from "@/lib/histograma/upcoming-events";

const JANELA_DIAS = 7;

function useProximosEventos(periodos: HistNovoPeriodo[], colaboradorById: Map<string, HistNovoColaborador>): ProximoEvento[] {
  return useMemo(
    () => buildUpcomingEvents(periodos, colaboradorById, todayStr(), JANELA_DIAS),
    [periodos, colaboradorById],
  );
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
                  "flex min-w-[42px] shrink-0 flex-col items-center justify-center rounded px-2 py-1 text-[10px] font-bold leading-tight",
                  ev.tipo === "desembarque" ? "bg-orange-500 text-white" : ev.confirmado ? "bg-emerald-600 text-white" : "text-emerald-950",
                )}
                style={ev.tipo === "embarque" && !ev.confirmado ? { backgroundColor: E_A_CONFIRMAR_COLOR } : undefined}
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
                  ev.tipo === "desembarque" ? "text-orange-600" : ev.confirmado ? "text-emerald-600" : "text-emerald-700/70",
                )}
                title={ev.tipo === "embarque" && !ev.confirmado ? "Ainda não confirmado pelo Drake — só o dia de mobilização foi lançado" : undefined}
              >
                {ev.tipo === "embarque" ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
                {ev.tipo === "desembarque" ? "Desembarque" : ev.confirmado ? "Embarque" : "Embarque (programado)"}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
