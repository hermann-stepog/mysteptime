import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, type ElementType } from "react";
import { getOffshoreData } from "@/lib/api/smartsheet.functions";
import {
  getDayStatus, generateDateRange, DAY_STATUS_COLOR, WEEKDAY_ABBR,
  type OffshorePerson, type DayStatus,
} from "@/lib/smartsheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Ship, CalendarDays, CheckCircle2, AlertCircle, TrendingUp, Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/admin/embarkations")({ component: HistogramaOffshore });


function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function defaultStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function defaultEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 2);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

// ─── Main page ─────────────────────────────────────────────────────────────

function HistogramaOffshore() {
  const [filterUnit, setFilterUnit] = useState<string[]>([]);
  const [filterFunction, setFilterFunction] = useState("all");
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterCollaborator, setFilterCollaborator] = useState("");
  const [filterDayStatus, setFilterDayStatus] = useState("");
  const [dateStart, setDateStart] = useState(defaultStart);
  const [dateEnd, setDateEnd] = useState(defaultEnd);

  const { data: people = [], isLoading, error } = useQuery({
    queryKey: ["offshore-data"],
    queryFn: () => getOffshoreData(),
    staleTime: 5 * 60 * 1000,
  });

  const units = useMemo(() => Array.from(new Set(people.map((p) => p.unit).filter(Boolean))).sort(), [people]);
  const functions = useMemo(() => ["all", ...Array.from(new Set(people.map((p) => p.function).filter(Boolean))).sort()], [people]);
  const statuses = useMemo(() => Array.from(new Set(people.map((p) => p.status).filter(Boolean))).sort(), [people]);

  const collaboratorNames = useMemo(
    () => Array.from(new Set(people.map((p) => p.name).filter(Boolean))).sort(),
    [people],
  );

  const filtered = useMemo(() => {
    const today = todayStr();
    return people.filter(
      (p) =>
        (filterUnit.length === 0 || filterUnit.includes(p.unit)) &&
        (filterFunction === "all" || p.function === filterFunction) &&
        (filterStatus.length === 0 || filterStatus.includes(p.status)) &&
        (filterCollaborator === "" || p.name === filterCollaborator) &&
        (filterDayStatus === "" || getTodayDisplayStatus(p, today) === filterDayStatus),
    );
  }, [people, filterUnit, filterFunction, filterStatus, filterCollaborator, filterDayStatus]);

  const statusSummary = useMemo(() => {
    const today = todayStr();
    const counts: Record<string, number> = { E: 0, P: 0, D: 0, FO: 0, F: 0, B: 0 };
    people.filter(
      (p) =>
        (filterUnit.length === 0 || filterUnit.includes(p.unit)) &&
        (filterFunction === "all" || p.function === filterFunction) &&
        (filterStatus.length === 0 || filterStatus.includes(p.status)) &&
        (filterCollaborator === "" || p.name === filterCollaborator),
    ).forEach((p) => {
      const s = getTodayDisplayStatus(p, today);
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [people, filterUnit, filterFunction, filterStatus, filterCollaborator]);

  if (isLoading)
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  if (error)
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Erro ao carregar dados do Smartsheet. Verifique as credenciais e tente novamente.
      </div>
    );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Histograma Offshore</h1>
        <p className="text-sm text-muted-foreground">Alocação, rotação e disponibilidade de pessoal offshore.</p>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap gap-2 items-end">
          <FilterMultiSelect label="Unidade" values={filterUnit} onChange={setFilterUnit} options={units} width="w-36" />
          <FilterSelect label="Função" value={filterFunction} onChange={setFilterFunction} options={functions} allLabel="Todas" width="w-48" />
          <FilterMultiSelect label="Status" values={filterStatus} onChange={setFilterStatus} options={statuses} width="w-36" />
          <CollaboratorSearch value={filterCollaborator} onChange={setFilterCollaborator} names={collaboratorNames} />
          <div className="space-y-0.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">De</label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="h-8 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Até</label>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="h-8 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Status summary chips — clicáveis */}
          <div className="ml-auto flex items-end pb-0.5 gap-1.5">
            {(["E", "P", "FO", "F", "B"] as const).map((s) => {
              const count = statusSummary[s] ?? 0;
              if (count === 0) return null;
              const labels: Record<string, string> = { E: "Emb", P: "Prog", FO: "Folga", F: "Férias", B: "Base" };
              const active = filterDayStatus === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterDayStatus(active ? "" : s)}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-all cursor-pointer"
                  style={{
                    backgroundColor: DAY_STATUS_COLOR[s] + (active ? "55" : "25"),
                    border: `${active ? "2px" : "1px"} solid ${DAY_STATUS_COLOR[s] + (active ? "dd" : "55")}`,
                    boxShadow: active ? `0 0 0 2px ${DAY_STATUS_COLOR[s]}44` : "none",
                  }}
                  title={active ? `Limpar filtro ${labels[s]}` : `Filtrar por ${labels[s]} (${count})`}
                >
                  <span className="font-bold" style={{ color: s === "B" ? "#64748b" : "#1e293b" }}>{count}</span>
                  <span className="text-muted-foreground">{labels[s]}</span>
                  {active && <X className="h-2.5 w-2.5 ml-0.5 text-muted-foreground" />}
                </button>
              );
            })}
            <div
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-muted border border-border/60 cursor-pointer"
              onClick={() => setFilterDayStatus("")}
              title="Ver todos"
            >
              <Users className="h-3 w-3 text-muted-foreground" />
              <span className="font-semibold text-foreground">{Object.values(statusSummary).reduce((a, b) => a + b, 0)}</span>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="histograma">Histograma</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4 space-y-6">
          <DashboardTab people={filtered} dateStart={dateStart} dateEnd={dateEnd} />
        </TabsContent>
        <TabsContent value="histograma" className="mt-4">
          <HistogramaTab people={filtered} dateStart={dateStart} dateEnd={dateEnd} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Retorna o status visual: se a data de embarque do período for >= hoje, exibe P (programado) em vez de E
function getDisplayStatus(p: OffshorePerson, d: string, today: string): DayStatus {
  const raw = getDayStatus(p, d);
  if (raw === "E") {
    const inPeriod1 = !!(p.embark && p.disembark && d >= p.embark && d < p.disembark);
    const relevantEmbark = inPeriod1 ? p.embark : p.embark2;
    if (relevantEmbark && relevantEmbark >= today && d === relevantEmbark) return "P";
  }
  return raw;
}

// Inclui pessoas na base com embarque futuro como P
function getTodayDisplayStatus(p: OffshorePerson, today: string): DayStatus {
  const display = getDisplayStatus(p, today, today);
  if (display === "B" && ((p.embark && p.embark > today) || (p.embark2 && p.embark2 > today))) return "P";
  return display;
}

// ─── Filter select helper ───────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options, allLabel, width }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; allLabel: string; width: string;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={`${width} h-8 text-xs`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">{o === "all" ? allLabel : o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Multi-select filter ────────────────────────────────────────────────────

function FilterMultiSelect({ label, values, onChange, options, width }: {
  label: string; values: string[]; onChange: (v: string[]) => void;
  options: string[]; width: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    onChange(values.includes(opt) ? values.filter((v) => v !== opt) : [...values, opt]);
  };

  const displayText =
    values.length === 0 ? "Todos" : values.length === 1 ? values[0] : `${values.length} selecionados`;

  return (
    <div className="space-y-0.5">
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</label>
      <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className={`${width} h-8 text-xs justify-between font-normal`}>
            <span className="truncate">{displayText}</span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-48" align="start">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem onSelect={() => onChange([])} className="text-xs">
                  <Check className={cn("mr-2 h-3 w-3", values.length === 0 ? "opacity-100" : "opacity-0")} />
                  Todos
                </CommandItem>
                {options.map((opt) => (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)} className="text-xs">
                    <Check className={cn("mr-2 h-3 w-3", values.includes(opt) ? "opacity-100" : "opacity-0")} />
                    {opt}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      </div>
    </div>
  );
}

// ─── Collaborator search combobox ───────────────────────────────────────────

function CollaboratorSearch({ value, onChange, names }: { value: string; onChange: (v: string) => void; names: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-0.5">
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Colaborador</label>
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-52 h-8 justify-between font-normal text-xs"
            >
              <span className="truncate">{value || "Todos os colaboradores"}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Digite o nome..." />
              <CommandList>
                <CommandEmpty>Nenhum colaborador encontrado.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__all__" onSelect={() => { onChange(""); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")} />
                    Todos
                  </CommandItem>
                  {names.map((name) => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={(v) => { onChange(v === value ? "" : v); setOpen(false); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === name ? "opacity-100" : "opacity-0")} />
                      {name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {value && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onChange("")} title="Limpar">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard tab ──────────────────────────────────────────────────────────

function DashboardTab({ people, dateStart, dateEnd }: { people: OffshorePerson[]; dateStart: string; dateEnd: string }) {
  const today = todayStr();
  const dates = useMemo(() => generateDateRange(new Date(dateStart), new Date(dateEnd)), [dateStart, dateEnd]);

  // KPIs do dia de hoje
  const kpis = useMemo(() => {
    const total        = people.length;
    const embarcados   = people.filter((p) => getTodayDisplayStatus(p, today) === "E").length;
    const programados  = people.filter((p) => getTodayDisplayStatus(p, today) === "P").length;
    const disponiveis  = people.filter((p) => getTodayDisplayStatus(p, today) === "B").length;
    const naoDisp      = people.filter((p) => { const s = getTodayDisplayStatus(p, today); return s === "FO" || s === "F"; }).length;
    const utilizacao   = total > 0 ? Math.round((embarcados / total) * 100) : 0;
    return { total, embarcados, programados, disponiveis, naoDisp, utilizacao };
  }, [people, today]);

  const avgMetrics = useMemo(() => {
    let totalOff = 0, cntOff = 0, totalFolga = 0, cntFolga = 0;
    people.forEach((p) => {
      if (p.embark && p.disembark) {
        const d = (new Date(p.disembark).getTime() - new Date(p.embark).getTime()) / 86400000 + 1;
        if (d > 0) { totalOff += d; cntOff++; }
      }
      if (p.embark2 && p.disembark2) {
        const d = (new Date(p.disembark2).getTime() - new Date(p.embark2).getTime()) / 86400000 + 1;
        if (d > 0) { totalOff += d; cntOff++; }
      }
      if (p.timeOffStart && p.timeOffEnd) {
        const d = (new Date(p.timeOffEnd).getTime() - new Date(p.timeOffStart).getTime()) / 86400000 + 1;
        if (d > 0) { totalFolga += d; cntFolga++; }
      }
      if (p.timeOffStart2 && p.timeOffEnd2) {
        const d = (new Date(p.timeOffEnd2).getTime() - new Date(p.timeOffStart2).getTime()) / 86400000 + 1;
        if (d > 0) { totalFolga += d; cntFolga++; }
      }
    });
    return {
      avgOffshore: cntOff > 0 ? Math.round(totalOff / cntOff) : 0,
      avgTimeOff: cntFolga > 0 ? Math.round(totalFolga / cntFolga) : 0,
    };
  }, [people]);

  const ocupacaoData = useMemo(() => {
    const outros = kpis.total - kpis.embarcados - kpis.disponiveis;
    return [
      { name: "Embarcados",  value: kpis.embarcados,  color: "#1e3a5f" },
      { name: "Disponíveis", value: kpis.disponiveis, color: "#93c5fd" },
      ...(outros > 0 ? [{ name: "Outros", value: outros, color: "#e2e8f0" }] : []),
    ].filter((d) => d.value > 0);
  }, [kpis]);

  // POB por unidade: soma de pessoa-dias embarcados no período
  const pobByUnit = useMemo(() => {
    const m: Record<string, number> = {};
    dates.forEach((d) => {
      people.forEach((p) => {
        if (getDayStatus(p, d) === "E" && p.unit) {
          m[p.unit] = (m[p.unit] || 0) + 1;
        }
      });
    });
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [dates, people]);

  // Status por função — snapshot de hoje
  const byFunctionStatus = useMemo(() => {
    const m: Record<string, { total: number; E: number; P: number; B: number; FO: number; F: number; D: number }> = {};
    people.forEach((p) => {
      const fn = p.function;
      if (!fn) return;
      if (!m[fn]) m[fn] = { total: 0, E: 0, P: 0, B: 0, FO: 0, F: 0, D: 0 };
      m[fn].total++;
      const s = getTodayDisplayStatus(p, today);
      m[fn][s as keyof (typeof m)[string]]++;
    });
    return Object.entries(m)
      .map(([name, c]) => ({ name, Total: c.total, Embarcado: c.E + c.D, Disponível: c.B, Programado: c.P, "Não Disponível": c.F, Folga: c.FO }))
      .sort((a, b) => b.Total - a.Total);
  }, [people, today]);

  // Mão de obra semanal — média diária por semana no período
  const weeklyData = useMemo(() => {
    const weekMap: Record<string, { label: string; dates: string[] }> = {};
    const weekOrder: string[] = [];
    dates.forEach((d) => {
      const dt = new Date(d + "T12:00:00");
      const dow = dt.getDay() || 7;
      const mon = new Date(dt);
      mon.setDate(dt.getDate() - dow + 1);
      const key = mon.toISOString().slice(0, 10);
      if (!weekMap[key]) {
        const jan1 = new Date(mon.getFullYear(), 0, 1);
        const weekNum = Math.ceil(((mon.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
        weekMap[key] = { label: `Sem ${weekNum}`, dates: [] };
        weekOrder.push(key);
      }
      weekMap[key].dates.push(d);
    });
    return weekOrder.map((key) => {
      const { label, dates: wd } = weekMap[key];
      const n = wd.length || 1;
      let emb = 0, folga = 0, disp = 0;
      wd.forEach((d) => {
        people.forEach((p) => {
          const s = getDisplayStatus(p, d, today);
          if (s === "E" || s === "D") emb++;
          else if (s === "FO" || s === "F") folga++;
          else if (s === "B") disp++;
        });
      });
      return { label, Embarcado: Math.round(emb / n), "Folga/Férias": Math.round(folga / n), Disponível: Math.round(disp / n) };
    });
  }, [dates, people, today]);

  const pobMatrix = useMemo(() => {
    const allUnits = [...new Set(people.map((p) => p.unit).filter(Boolean))].sort();
    const matrix: Record<string, Record<string, number>> = {};
    dates.forEach((d) => {
      matrix[d] = {};
      people.forEach((p) => {
        if (getDayStatus(p, d) === "E" && p.unit) {
          matrix[d][p.unit] = (matrix[d][p.unit] || 0) + 1;
        }
      });
    });
    const monthMap: Record<string, { label: string; days: string[] }> = {};
    const monthOrder: string[] = [];
    dates.forEach((d) => {
      const key = d.slice(0, 7);
      if (!monthMap[key]) {
        const label = new Date(d + "T12:00:00").toLocaleString("pt-BR", { month: "long", year: "numeric" });
        monthMap[key] = { label, days: [] };
        monthOrder.push(key);
      }
      monthMap[key].days.push(d);
    });
    const monthGroups = monthOrder.map((k) => monthMap[k]);
    return { allUnits, matrix, monthGroups };
  }, [dates, people]);

  return (
    <div className="space-y-6">

      {/* ── KPIs ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {([
          { label: "Headcount Total",  value: kpis.total,                icon: Users       },
          { label: "Embarcados",       value: kpis.embarcados,           icon: Ship        },
          { label: "Programados",      value: kpis.programados,          icon: CalendarDays },
          { label: "Disponíveis",      value: kpis.disponiveis,          icon: CheckCircle2 },
          { label: "Não Disponíveis",  value: kpis.naoDisp,              icon: AlertCircle  },
          { label: "Utilização",       value: `${kpis.utilizacao}%`,     icon: TrendingUp   },
        ] as { label: string; value: string | number; icon: ElementType }[]).map((k) => (
          <Card key={k.label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</span>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-3xl font-semibold">{k.value}</div>
          </Card>
        ))}
      </div>

      {/* ── Taxa de Ocupação + Métricas ── */}
      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Taxa de Ocupação</h3>
        <p className="mb-4 text-xs text-muted-foreground">Distribuição hoje</p>
        <div className="flex items-start gap-8 flex-wrap">
          {/* Donut */}
          <div className="relative shrink-0">
            <PieChart width={180} height={180}>
              <Pie data={ocupacaoData} cx={90} cy={90} innerRadius={58} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} stroke="none">
                {ocupacaoData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
              </Pie>
              <Tooltip formatter={(v: number, n: string) => [`${v} pessoas`, n]} />
            </PieChart>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-[#1e3a5f]">{kpis.utilizacao}%</span>
              <span className="text-[10px] text-muted-foreground">ocupação</span>
            </div>
          </div>
          {/* Legenda + métricas */}
          <div className="flex-1 min-w-[180px] space-y-5 pt-2">
            <div className="space-y-2">
              {ocupacaoData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tempo Médio Offshore</p>
                <p className="mt-1 text-2xl font-bold text-[#1e3a5f]">
                  {avgMetrics.avgOffshore}<span className="ml-1 text-sm font-normal text-muted-foreground">dias</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tempo Médio de Folga</p>
                <p className="mt-1 text-2xl font-bold text-sky-500">
                  {avgMetrics.avgTimeOff}<span className="ml-1 text-sm font-normal text-muted-foreground">dias</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── POB por Unidade — barra horizontal ── */}
      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">POB por Unidade</h3>
        <p className="mb-4 text-xs text-muted-foreground">Soma de pessoa-dias embarcados no período</p>
        <ResponsiveContainer width="100%" height={Math.max(200, pobByUnit.length * 28)}>
          <BarChart data={pobByUnit} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => [`${v} pessoa-dias`, "POB"]} />
            <Bar dataKey="count" fill="#0288d1" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="count" position="right" style={{ fontSize: 13, fontWeight: 700, fill: "#0f172a" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>


      {/* ── Status por Função ── */}
      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Status por Função</h3>
        <p className="mb-3 text-xs text-muted-foreground">Distribuição hoje — todas as funções</p>
        <ResponsiveContainer width="100%" height={Math.max(300, byFunctionStatus.length * 22)}>
          <BarChart data={byFunctionStatus} margin={{ top: 16, right: 8, bottom: 120, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={0} />
            <YAxis hide />
            <Tooltip />
            <Legend iconSize={9} verticalAlign="bottom" wrapperStyle={{ fontSize: 10, paddingTop: 80 }} />
            <Bar dataKey="Total"          fill="#1e3a5f" name="Total">         <LabelList position="top" style={{ fontSize: 8, fontWeight: 700, fill: "#1e3a5f" }} /></Bar>
            <Bar dataKey="Embarcado"      fill="#f97316" name="Embarcado">     <LabelList position="top" style={{ fontSize: 8, fontWeight: 700, fill: "#f97316" }} /></Bar>
            <Bar dataKey="Disponível"     fill="#22c55e" name="Disponível">    <LabelList position="top" style={{ fontSize: 8, fontWeight: 700, fill: "#22c55e" }} /></Bar>
            <Bar dataKey="Programado"     fill="#eab308" name="Programado">    <LabelList position="top" style={{ fontSize: 8, fontWeight: 700, fill: "#854d0e" }} /></Bar>
            <Bar dataKey="Não Disponível" fill="#8b5cf6" name="Não Disponível"><LabelList position="top" style={{ fontSize: 8, fontWeight: 700, fill: "#8b5cf6" }} /></Bar>
            <Bar dataKey="Folga"          fill="#ef4444" name="Folga">         <LabelList position="top" style={{ fontSize: 8, fontWeight: 700, fill: "#ef4444" }} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* ── Mão de Obra por Semana ── */}
      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Mão de Obra por Semana</h3>
        <p className="mb-3 text-xs text-muted-foreground">Média diária de pessoas por semana</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={weeklyData} margin={{ top: 16, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis hide />
            <Tooltip />
            <Legend iconSize={9} wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="Embarcado"    stackId="a" fill="#1e3a5f"><LabelList position="insideTop" style={{ fill: "white",   fontSize: 10, fontWeight: 700 }} /></Bar>
            <Bar dataKey="Folga/Férias" stackId="a" fill="#94a3b8"><LabelList position="insideTop" style={{ fill: "white",   fontSize: 10, fontWeight: 700 }} /></Bar>
            <Bar dataKey="Disponível"   stackId="a" fill="#93c5fd" radius={[3, 3, 0, 0]}><LabelList position="insideTop" style={{ fill: "#1e293b", fontSize: 10, fontWeight: 700 }} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* POB por Unidade × Dia */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">POB por Unidade × Dia</h3>
        <div className="overflow-auto rounded border border-border max-h-[420px]">
          <table className="min-w-max border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-muted border border-border px-3 py-1.5 text-left min-w-[150px]" rowSpan={2}>Unidade</th>
                <th
                  colSpan={dates.length}
                  className="border border-border px-2 py-1.5 text-center bg-sidebar text-sidebar-foreground font-semibold"
                >
                  {dateStart.split("-").reverse().join("/")} – {dateEnd.split("-").reverse().join("/")}
                </th>
              </tr>
              <tr>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="border border-border px-0 py-1 text-center font-normal min-w-[26px] bg-muted"
                    style={d === today ? { backgroundColor: "#0288d1", color: "white" } : undefined}
                  >
                    <div className="text-[10px]">{d.slice(8)}</div>
                    <div className="text-[9px] opacity-60">{WEEKDAY_ABBR[new Date(d + "T12:00:00").getDay()]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pobMatrix.allUnits.map((unit) => (
                <tr key={unit} className="hover:bg-muted/40">
                  <td className="sticky left-0 z-10 bg-background border border-border px-3 py-1 font-medium">{unit}</td>
                  {dates.map((d) => {
                    const count = pobMatrix.matrix[d]?.[unit] || 0;
                    const isWeekend = [0, 6].includes(new Date(d + "T12:00:00").getDay());
                    return (
                      <td
                        key={d}
                        className="border border-border p-0 text-center"
                        style={{ backgroundColor: count > 0 ? "#22c55e33" : isWeekend ? "#f1f5f9" : undefined }}
                      >
                        <div className="h-6 w-[26px] flex items-center justify-center text-[11px] font-semibold" style={{ color: count > 0 ? "#166534" : undefined }}>
                          {count > 0 ? count : ""}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-muted font-semibold sticky bottom-0 z-10">
                <td className="sticky left-0 z-20 bg-muted border border-border px-3 py-1.5">TOTAL</td>
                {dates.map((d) => {
                  const total = Object.values(pobMatrix.matrix[d] || {}).reduce((sum, c) => sum + c, 0);
                  return (
                    <td key={d} className="border border-border p-0 text-center">
                      <div className="h-6 w-[26px] flex items-center justify-center text-[11px]">
                        {total > 0 ? total : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Histograma tab ─────────────────────────────────────────────────────────

function HistogramaTab({ people, dateStart, dateEnd }: { people: OffshorePerson[]; dateStart: string; dateEnd: string }) {
  const today = todayStr();
  const dates = useMemo(() => generateDateRange(new Date(dateStart), new Date(dateEnd)), [dateStart, dateEnd]);
  const [activeStatuses, setActiveStatuses] = useState<Set<DayStatus>>(new Set());

  const toggleStatus = (s: DayStatus) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const visiblePeople = useMemo(() => {
    if (activeStatuses.size === 0) return people;
    return people.filter((p) => dates.some((d) => activeStatuses.has(getDisplayStatus(p, d, today))));
  }, [people, dates, activeStatuses, today]);

  const STATUS_LABELS: Record<DayStatus, string> = {
    E: "Embarcado (confirmado)", P: "Programado (futuro)", D: "Desembarque",
    B: "Base", FO: "Folga", F: "Férias",
  };
  const FILTERABLE: DayStatus[] = ["E", "P", "D", "FO", "F"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {FILTERABLE.map((s) => {
          const active = activeStatuses.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className="flex items-center gap-1.5 rounded px-2 py-1 transition-all cursor-pointer"
              style={{
                backgroundColor: DAY_STATUS_COLOR[s] + (active ? "55" : "20"),
                border: `${active ? "2px" : "1px"} solid ${DAY_STATUS_COLOR[s] + (active ? "dd" : "55")}`,
                boxShadow: active ? `0 0 0 2px ${DAY_STATUS_COLOR[s]}44` : "none",
              }}
              title={active ? `Remover filtro ${s}` : `Filtrar por ${s}`}
            >
              <span
                className="inline-flex h-4 w-7 items-center justify-center rounded text-[10px] font-bold"
                style={{ backgroundColor: DAY_STATUS_COLOR[s], color: "#1e293b" }}
              >
                {s}
              </span>
              <span className="text-foreground/80">{STATUS_LABELS[s]}</span>
            </button>
          );
        })}
        <span key="B" className="flex items-center gap-1 px-2 py-1">
          <span
            className="inline-flex h-4 w-7 items-center justify-center rounded text-[10px] font-bold"
            style={{ backgroundColor: DAY_STATUS_COLOR.B, color: "#94a3b8" }}
          >
            B
          </span>
          <span className="text-muted-foreground">Base</span>
        </span>
        {activeStatuses.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveStatuses(new Set())}
            className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:text-foreground border border-border"
            title="Limpar filtros"
          >
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-auto max-h-[70vh]">
        <table className="min-w-max border-collapse text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-muted border border-border px-2 py-2 text-left font-medium min-w-[150px]">Nome</th>
              <th className="sticky left-[150px] z-30 bg-muted border border-border px-2 py-2 text-left font-medium min-w-[110px]">Função</th>
              <th className="sticky left-[260px] z-30 bg-muted border border-border px-1.5 py-2 text-left font-medium min-w-[80px]">Unidade</th>
              <th className="sticky left-[340px] z-30 bg-muted border border-border px-1.5 py-2 text-left font-medium min-w-[70px]">BSP</th>
              {dates.map((d) => (
                <th
                  key={d}
                  className="border border-border px-0 py-1 text-center font-normal min-w-[30px]"
                  style={d === today ? { backgroundColor: "#0288d1", color: "white" } : undefined}
                >
                  <div className="text-[10px]">{d.slice(8)}/{d.slice(5, 7)}</div>
                  <div className="text-[9px] opacity-60">{WEEKDAY_ABBR[new Date(d + "T12:00:00").getDay()]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePeople.map((p, i) => (
              <tr key={p.id || p.name + i} className="hover:bg-muted/40">
                <td className="sticky left-0 z-10 bg-background border border-border px-2 py-1 font-medium truncate max-w-[150px]">{p.name}</td>
                <td className="sticky left-[150px] z-10 bg-background border border-border px-2 py-1 truncate max-w-[110px] text-muted-foreground">{p.function}</td>
                <td className="sticky left-[260px] z-10 bg-background border border-border px-1.5 py-1 text-muted-foreground">{p.unit}</td>
                <td className="sticky left-[340px] z-10 bg-background border border-border px-1.5 py-1 text-muted-foreground">{p.bsp}</td>
                {dates.map((d) => {
                  const status = getDisplayStatus(p, d, today);
                  const isWeekend = [0, 6].includes(new Date(d + "T12:00:00").getDay());
                  return (
                    <td key={d} className="border border-border p-0" title={`${p.name} · ${d} · ${status === "E" ? "Embarcado" : status === "P" ? "Programado" : status === "D" ? "Desembarque" : status === "FO" ? "Folga" : status === "F" ? "Férias" : "Base"}`}>
                      <div
                        className="h-6 w-[30px] flex items-center justify-center text-[10px] font-bold"
                        style={{
                          backgroundColor: status === "B" && isWeekend ? "#f1f5f9" : DAY_STATUS_COLOR[status],
                          color: status === "B" ? "#cbd5e1" : "#1e293b",
                        }}
                      >
                        {status === "B" ? "" : status}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {visiblePeople.length === 0 && (
              <tr>
                <td colSpan={4 + dates.length} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum colaborador encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">{visiblePeople.length} colaboradores · {dates.length} dias{activeStatuses.size > 0 ? ` · filtrado por ${Array.from(activeStatuses).join(", ")}` : ""}</p>
    </div>
  );
}
