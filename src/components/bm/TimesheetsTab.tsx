import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bm_timesheet_dias ainda não existe no schema gerado (types.ts) — mesmo padrão já usado nas
// outras tabelas de BM enquanto o codegen não é refeito.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { CalendarRange, ChevronRight, RotateCcw, Users } from "lucide-react";
import { EVENTOS_DIA } from "@/lib/timesheetOffshore";
import { cn } from "@/lib/utils";

// Cópia dos dias do Timesheet Offshore dentro do BM. Tudo o que é editado aqui vive só em
// bm_timesheet_dias — nunca volta pro timesheet_dias original.
export interface BmTimesheetDia {
  id: string;
  source_dia_id: string | null;
  colaborador_id: string | null;
  colaborador_nome: string;
  funcao: string | null;
  unidade_operacional: string | null;
  bsp: string | null;
  data: string;
  dia_semana: string | null;
  evento: string | null;
  descricao_tarefa: string | null;
  numero_tarefa: string | null;
  hora_entrada: string | null;
  hora_saida: string | null;
  hora_entrada_extra: string | null;
  hora_saida_extra: string | null;
  horas_normais: number | null;
  horas_extras: number | null;
  total_horas: number | null;
  adicional_noturno: boolean;
  feriado: boolean;
  original: Record<string, unknown> | null;
}

const CAMPOS_COPIA = [
  "dia_semana", "evento", "descricao_tarefa", "numero_tarefa", "hora_entrada", "hora_saida",
  "hora_entrada_extra", "hora_saida_extra", "horas_normais", "horas_extras", "total_horas",
  "adicional_noturno", "feriado", "bsp", "funcao",
] as const;

type CampoCopia = (typeof CAMPOS_COPIA)[number];

function fmtData(d: string): string {
  return d.split("-").reverse().join("/");
}

function primeiroDiaDoMes(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaDoMes(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function bspLabel(bsp: string | null): string {
  return bsp?.trim() ? bsp.trim() : "Sem BSP";
}

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function numeroSeguro(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function TimesheetsTab() {
  const qc = useQueryClient();
  const [de, setDe] = useState(primeiroDiaDoMes);
  const [ate, setAte] = useState(ultimoDiaDoMes);
  const [bspSelecionada, setBspSelecionada] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [colaboradorAberto, setColaboradorAberto] = useState<string | null>(null);

  const periodoValido = !!de && !!ate && de <= ate;

  // ── Origem: dias reais do Timesheet Offshore no período ─────────────────────────────
  const { data: origem = [], isFetching: carregandoOrigem } = useQuery({
    queryKey: ["bm-ts-origem", de, ate],
    enabled: periodoValido,
    queryFn: async () => {
      const { data: dias, error } = await supabase
        .from("timesheet_dias")
        .select("id, semana_id, data, dia_semana, evento, bsp, descricao_tarefa, numero_tarefa, hora_entrada, hora_saida, hora_entrada_extra, hora_saida_extra, horas_normais, horas_extras, total_horas, adicional_noturno, feriado")
        .gte("data", de).lte("data", ate);
      if (error) throw error;
      if (!dias?.length) return [];

      const semanaIds = Array.from(new Set(dias.map((d: any) => d.semana_id)));
      const { data: semanas, error: semErr } = await supabase
        .from("timesheet_semanas").select("id, embarque_id, funcao_override").in("id", semanaIds);
      if (semErr) throw semErr;

      const embarqueIds = Array.from(new Set((semanas ?? []).map((s: any) => s.embarque_id)));
      const { data: embarques, error: embErr } = embarqueIds.length
        ? await supabase.from("timesheet_embarques").select("id, colaborador_id, funcao_embarque, unidade_operacional, bsp").in("id", embarqueIds)
        : { data: [], error: null };
      if (embErr) throw embErr;

      const colabIds = Array.from(new Set((embarques ?? []).map((e: any) => e.colaborador_id).filter(Boolean)));
      const { data: colaboradores, error: colErr } = colabIds.length
        ? await supabase.from("hist_novo_colaboradores").select("id, nome").in("id", colabIds)
        : { data: [], error: null };
      if (colErr) throw colErr;

      const semanaById = new Map<string, any>((semanas ?? []).map((s: any) => [s.id, s]));
      const embarqueById = new Map<string, any>((embarques ?? []).map((e: any) => [e.id, e]));
      const nomeById = new Map<string, string>((colaboradores ?? []).map((c: any) => [c.id, c.nome]));

      return dias.map((d: any) => {
        const semana = semanaById.get(d.semana_id);
        const embarque = semana ? embarqueById.get(semana.embarque_id) : null;
        return {
          source_dia_id: d.id,
          colaborador_id: embarque?.colaborador_id ?? null,
          colaborador_nome: nomeById.get(embarque?.colaborador_id) ?? "—",
          funcao: semana?.funcao_override ?? embarque?.funcao_embarque ?? null,
          unidade_operacional: embarque?.unidade_operacional ?? null,
          bsp: d.bsp ?? embarque?.bsp ?? null,
          data: d.data,
          dia_semana: d.dia_semana,
          evento: d.evento,
          descricao_tarefa: d.descricao_tarefa,
          numero_tarefa: d.numero_tarefa,
          hora_entrada: d.hora_entrada,
          hora_saida: d.hora_saida,
          hora_entrada_extra: d.hora_entrada_extra,
          hora_saida_extra: d.hora_saida_extra,
          horas_normais: d.horas_normais,
          horas_extras: d.horas_extras,
          total_horas: d.total_horas,
          adicional_noturno: !!d.adicional_noturno,
          feriado: !!d.feriado,
        };
      });
    },
  });

  // ── Cópia local do BM ───────────────────────────────────────────────────────────────
  const { data: copias = [], isFetching: carregandoCopias } = useQuery({
    queryKey: ["bm-ts-copias", de, ate],
    enabled: periodoValido,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_timesheet_dias").select("*").gte("data", de).lte("data", ate)
        .order("colaborador_nome").order("data");
      if (error) throw error;
      return (data ?? []) as BmTimesheetDia[];
    },
  });

  // Copia automaticamente os dias do período que ainda não existem no BM. Nunca sobrescreve
  // linhas já copiadas — o que a Medição ajustou fica intacto.
  const importar = useMutation({
    mutationFn: async (faltantes: any[]) => {
      const rows = faltantes.map((d) => ({ ...d, original: d }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("bm_timesheet_dias").insert(rows.slice(i, i + 500));
        if (error) throw error;
      }
      return rows.length;
    },
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: ["bm-ts-copias", de, ate] });
    },
    onError: (e: any) => notify.error(e.message),
  });

  const faltantes = useMemo(() => {
    if (!origem.length) return [];
    const existentes = new Set(copias.map((c) => c.source_dia_id).filter(Boolean) as string[]);
    return origem.filter((d: any) => !existentes.has(d.source_dia_id));
  }, [origem, copias]);

  useEffect(() => {
    if (!periodoValido || carregandoOrigem || carregandoCopias) return;
    if (faltantes.length === 0 || importar.isPending) return;
    importar.mutate(faltantes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faltantes, periodoValido, carregandoOrigem, carregandoCopias]);

  const salvar = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Record<CampoCopia, unknown>> }) => {
      const { error } = await supabase.from("bm_timesheet_dias").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bm-ts-copias", de, ate] }),
    onError: (e: any) => notify.error(e.message),
  });

  const salvarFuncao = useMutation({
    mutationFn: async ({ ids, funcao }: { ids: string[]; funcao: string }) => {
      const { error } = await supabase.from("bm_timesheet_dias").update({ funcao: funcao || null }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bm-ts-copias", de, ate] }),
    onError: (e: any) => notify.error(e.message),
  });

  const restaurar = useMutation({
    mutationFn: async (row: BmTimesheetDia) => {
      if (!row.original) throw new Error("Sem valores originais guardados para esta linha.");
      const patch: Record<string, unknown> = {};
      for (const campo of CAMPOS_COPIA) patch[campo] = (row.original as any)[campo] ?? null;
      patch.adicional_noturno = !!(row.original as any).adicional_noturno;
      patch.feriado = !!(row.original as any).feriado;
      const { error } = await supabase.from("bm_timesheet_dias").update(patch).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-ts-copias", de, ate] });
      notify.success("Linha restaurada para o valor do Timesheet Offshore.");
    },
    onError: (e: any) => notify.error(e.message),
  });

  // ── Agrupamentos ────────────────────────────────────────────────────────────────────
  const bsps = useMemo(() => {
    const map = new Map<string, { bsp: string | null; colaboradores: Set<string>; dias: number }>();
    for (const c of copias) {
      const key = bspLabel(c.bsp);
      const entry = map.get(key) ?? { bsp: c.bsp, colaboradores: new Set<string>(), dias: 0 };
      entry.colaboradores.add(c.colaborador_id ?? c.colaborador_nome);
      entry.dias += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, colaboradores: v.colaboradores.size, dias: v.dias }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [copias]);

  useEffect(() => {
    if (bspSelecionada && !bsps.some((b) => b.key === bspSelecionada)) setBspSelecionada(null);
  }, [bsps, bspSelecionada]);

  const grupos = useMemo(() => {
    if (!bspSelecionada) return [];
    const termo = busca.trim().toLowerCase();
    const linhas = copias
      .filter((c) => bspLabel(c.bsp) === bspSelecionada)
      .filter((c) => !termo || c.colaborador_nome.toLowerCase().includes(termo));
    const map = new Map<string, BmTimesheetDia[]>();
    for (const l of linhas) {
      const key = `${l.colaborador_nome}||${l.funcao ?? ""}`;
      map.set(key, [...(map.get(key) ?? []), l]);
    }
    return Array.from(map.entries())
      .map(([key, dias]) => ({
        nome: key.split("||")[0],
        funcao: key.split("||")[1],
        dias: dias.sort((a, b) => a.data.localeCompare(b.data)),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [copias, bspSelecionada, busca]);

  const carregando = carregandoOrigem || carregandoCopias || importar.isPending;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Colaborador</Label>
            <Input placeholder="Buscar por nome" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-56" />
          </div>
          <p className="ml-auto text-xs text-muted-foreground">
            {carregando ? "Sincronizando cópia do Timesheet Offshore…" : `${copias.length} dia(s) copiados no período`}
          </p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Os dados são uma cópia do Timesheet Offshore. Alterações feitas aqui valem só para a Medição e não voltam para o módulo de origem.
        </p>
      </Card>

      {!periodoValido ? (
        <Card className="p-4"><EmptyState icon={CalendarRange} title="Selecione um período válido" /></Card>
      ) : bsps.length === 0 ? (
        <Card className="p-4"><EmptyState icon={CalendarRange} title="Nenhum timesheet no período selecionado" description={carregando ? "Carregando…" : undefined} /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {bsps.map((b) => (
              <Card
                key={b.key}
                onClick={() => { setColaboradorAberto(null); setBspSelecionada(b.key === bspSelecionada ? null : b.key); }}
                className={cn(
                  "cursor-pointer p-4 transition-shadow hover:shadow-md",
                  b.key === bspSelecionada && "border-primary ring-1 ring-primary",
                )}
              >
                <p className="text-sm font-semibold">{b.key}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />{b.colaboradores} colaborador(es) · {b.dias} dia(s)
                </p>
              </Card>
            ))}
          </div>

          {bspSelecionada && (
            <div className="space-y-5">
              {grupos.length === 0 && (
                <Card className="p-4"><EmptyState icon={Users} title="Nenhum colaborador encontrado" /></Card>
              )}
              {grupos.map((g) => {
                const chave = `${g.nome}||${g.funcao}`;
                const aberto = colaboradorAberto === chave;
                const totais = g.dias.reduce(
                  (acc, d) => ({
                    normais: acc.normais + numeroSeguro(d.horas_normais),
                    extras: acc.extras + numeroSeguro(d.horas_extras),
                    total: acc.total + numeroSeguro(d.total_horas),
                  }),
                  { normais: 0, extras: 0, total: 0 },
                );
                const primeiro = g.dias[0];
                const ultimo = g.dias[g.dias.length - 1];
                return (
                <Card key={chave} className="overflow-hidden">
                  <div className="flex w-full items-start gap-2 border-b px-4 py-3 text-left">
                    <button
                      type="button"
                      onClick={() => setColaboradorAberto(aberto ? null : chave)}
                      className="mt-0.5 shrink-0 rounded hover:bg-muted"
                      aria-label={aberto ? "Recolher" : "Expandir"}
                    >
                      <ChevronRight className={cn("h-4 w-4 transition-transform", aberto && "rotate-90")} />
                    </button>
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setColaboradorAberto(aberto ? null : chave)}
                        className="text-sm font-semibold uppercase tracking-wide hover:underline"
                      >
                        {g.nome}
                      </button>
                      <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
                        <span><strong>Unidade:</strong> {primeiro?.unidade_operacional ?? "—"}</span>
                        <span>{" · "}<strong>BSP:</strong> {bspSelecionada}</span>
                        <span>{" · "}<strong>Função:</strong></span>
                        <Input
                          defaultValue={g.funcao}
                          key={`funcao-${chave}`}
                          placeholder="Função"
                          className="h-7 w-48 text-xs"
                          onBlur={(e) => {
                            const valor = e.target.value.trim();
                            if (valor === (g.funcao ?? "")) return;
                            salvarFuncao.mutate({ ids: g.dias.map((d) => d.id), funcao: valor });
                          }}
                        />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <strong>Período:</strong> {primeiro ? fmtData(primeiro.data) : "—"} a {ultimo ? fmtData(ultimo.data) : "—"} · {g.dias.length} dia(s)
                        {" · "}Normais {totais.normais.toFixed(1)}h · Extras {totais.extras.toFixed(1)}h · Total {totais.total.toFixed(1)}h
                      </p>
                    </div>
                  </div>
                  {aberto && (
                  <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">Dia</TableHead>
                          <TableHead className="w-40">Evento</TableHead>
                          <TableHead className="w-28">BSP</TableHead>
                          <TableHead className="w-24">Entrada</TableHead>
                          <TableHead className="w-24">Saída</TableHead>
                          <TableHead className="w-28">Horas Normais</TableHead>
                          <TableHead className="w-28">Horas Extras</TableHead>
                          <TableHead className="w-24">HE Entrada</TableHead>
                          <TableHead className="w-24">HE Saída</TableHead>
                          <TableHead className="w-24">Total</TableHead>
                          <TableHead className="w-16" title="Adicional noturno">Adic. Not.</TableHead>
                          <TableHead className="w-16" title="Feriado">Feriado</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.dias.map((d) => (
                          <LinhaDia
                            key={d.id}
                            row={d}
                            onSave={(patch) => salvar.mutate({ id: d.id, patch })}
                            onRestore={() => restaurar.mutate(d)}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap justify-end gap-4 border-t px-4 py-3 text-sm font-semibold">
                    <span>Total Hours — Normais: {totais.normais.toFixed(1)}h</span>
                    <span>Extras: {totais.extras.toFixed(1)}h</span>
                    <span>Total: {totais.total.toFixed(1)}h</span>
                  </div>
                  </>
                  )}
                </Card>
                );
              })}


            </div>
          )}
        </>
      )}
    </div>
  );
}

function alterada(row: BmTimesheetDia): boolean {
  if (!row.original) return false;
  return CAMPOS_COPIA.some((c) => {
    const orig = (row.original as any)[c] ?? null;
    const atual = (row as any)[c] ?? null;
    if (typeof atual === "boolean" || typeof orig === "boolean") return !!atual !== !!orig;
    if (typeof atual === "number" || typeof orig === "number") return Number(atual ?? 0) !== Number(orig ?? 0);
    return (atual ?? "") !== (orig ?? "");
  });
}

function LinhaDia({ row, onSave, onRestore }: {
  row: BmTimesheetDia;
  onSave: (patch: Partial<Record<CampoCopia, unknown>>) => void;
  onRestore: () => void;
}) {
  const [local, setLocal] = useState(row);
  useEffect(() => setLocal(row), [row]);

  // Mesma regra do módulo Timesheet Offshore: horas normais/extras/total e adicional noturno
  // são derivados automaticamente dos horários — não há mais marcação manual.
  const hora = (campo: CampoCopia) => (
    <Input
      type="time"
      className="h-8 text-xs"
      value={((local as any)[campo] as string | null)?.slice(0, 5) ?? ""}
      onChange={(e) => {
        const valor = e.target.value || null;
        const next = { ...local, [campo]: valor } as BmTimesheetDia;
        const { normais, extras, total } = computeHorasDia(
          next.hora_entrada, next.hora_saida, next.hora_entrada_extra, next.hora_saida_extra,
        );
        next.horas_normais = normais;
        next.horas_extras = extras;
        next.total_horas = total;
        next.adicional_noturno = suggestAdicionalNoturno(
          next.hora_entrada, next.hora_saida, next.hora_entrada_extra, next.hora_saida_extra,
        );
        setLocal(next);
        onSave({
          [campo]: valor,
          horas_normais: normais,
          horas_extras: extras,
          total_horas: total,
          adicional_noturno: next.adicional_noturno,
        });
      }}
    />
  );

  const num = (campo: CampoCopia) => (
    <Input
      type="number"
      step="0.5"
      className="h-8 min-w-[4.5rem] text-sm font-medium"
      value={((local as any)[campo] as number | null) ?? ""}
      onChange={(e) => setLocal({ ...local, [campo]: e.target.value as any })}
      onBlur={() => {
        const valor = numOrNull(String((local as any)[campo] ?? ""));
        if (valor !== ((row as any)[campo] ?? null)) onSave({ [campo]: valor });
      }}
    />
  );


  const diaLabel = `${(local.dia_semana ?? "").split(" / ")[0].slice(0, 3)} - ${fmtData(row.data).slice(0, 6)}${row.data.slice(2, 4)}`;

  return (
    <TableRow className={cn(alterada(local) && "bg-amber-50/70")}>
      <TableCell className="whitespace-nowrap text-xs font-medium">{diaLabel}</TableCell>
      <TableCell>
        <select
          className="h-8 w-full rounded-md border border-input bg-background px-1.5 text-xs"
          value={local.evento ?? ""}
          onChange={(e) => {
            const valor = e.target.value || null;
            setLocal({ ...local, evento: valor });
            onSave({ evento: valor });
          }}
        >
          <option value="">Nenhum</option>
          {EVENTOS_DIA.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      </TableCell>
      <TableCell>
        <Input
          className="h-8 text-xs"
          value={local.bsp ?? ""}
          onChange={(e) => setLocal({ ...local, bsp: e.target.value })}
          onBlur={() => {
            const valor = (local.bsp ?? "").trim() || null;
            if (valor !== (row.bsp ?? null)) onSave({ bsp: valor });
          }}
        />
      </TableCell>
      <TableCell>{hora("hora_entrada")}</TableCell>
      <TableCell>{hora("hora_saida")}</TableCell>
      <TableCell>{num("horas_normais")}</TableCell>
      <TableCell>{num("horas_extras")}</TableCell>
      <TableCell>{hora("hora_entrada_extra")}</TableCell>
      <TableCell>{hora("hora_saida_extra")}</TableCell>
      <TableCell>{num("total_horas")}</TableCell>
      <TableCell className="text-center">{bool("adicional_noturno")}</TableCell>
      <TableCell className="text-center">{bool("feriado")}</TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Restaurar valores do Timesheet Offshore" onClick={onRestore}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </TableCell>

    </TableRow>
  );
}
