import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { getOffshoreData } from "@/lib/api/smartsheet.functions";
import type { OffshorePerson } from "@/lib/smartsheet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, X, Users, FileCheck, AlertCircle, Loader2, Download, ChevronsUpDown, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/admin/timesheets")({ component: TimesheetsPage });

// ─── Delivery storage ─────────────────────────────────────────────────────────

const STORAGE_KEY    = "step-timesheets";
const OVERRIDE_KEY   = "step-timesheets-overrides";

type DeliveryRecord  = { delivered: boolean; deliveredAt?: string };
type TimesheetStorage = Record<string, Record<string, DeliveryRecord>>;
type PersonOverride  = { unit: string; bsp: string };
type OverrideStorage = Record<string, PersonOverride>;

function loadStorage(): TimesheetStorage {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}
function saveStorage(data: TimesheetStorage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadOverrides(): OverrideStorage {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? "{}"); } catch { return {}; }
}
function saveOverrides(data: OverrideStorage) {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(data));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultStart() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultEnd() {
  const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso: string) { return iso.split("-").reverse().join("/"); }
function pKey(p: { id: string; name: string }) { return p.id || p.name; }

// ─── Unit exclusion ───────────────────────────────────────────────────────────

const EXCLUDED_UNITS = new Set([
  "BASE", "BASE - OFFSHORE", "BASE - PORTUGAL", "CASA", "DISPONIVEL", "FOLGA",
]);
function isExcludedUnit(unit: string): boolean {
  if (!unit) return false;
  const u = unit.toUpperCase().trim();
  if (EXCLUDED_UNITS.has(u)) return true;
  if (u.startsWith("FÉRIAS") || u.startsWith("FERIAS")) return true;
  if (u.startsWith("INDISPONÍVEL") || u.startsWith("INDISPONIVEL")) return true;
  return false;
}

function getEffUnit(p: OffshorePerson, ov: OverrideStorage) {
  return (isExcludedUnit(p.unit) ? ov[pKey(p)]?.unit : p.unit) || "Sem Unidade";
}
function getEffBsp(p: OffshorePerson, ov: OverrideStorage) {
  return (isExcludedUnit(p.unit) ? ov[pKey(p)]?.bsp : p.bsp) || "Sem BSP";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function TimesheetsPage() {
  const [dateStart, setDateStart] = useState(
    () => localStorage.getItem("step-timesheets-start") ?? defaultStart(),
  );
  const [dateEnd, setDateEnd] = useState(
    () => localStorage.getItem("step-timesheets-end") ?? defaultEnd(),
  );
  const handleDateStart = (v: string) => { setDateStart(v); localStorage.setItem("step-timesheets-start", v); };
  const handleDateEnd   = (v: string) => { setDateEnd(v);   localStorage.setItem("step-timesheets-end",   v); };

  const [filterUnit, setFilterUnit]               = useState<string[]>([]);
  const [filterCollaborator, setFilterCollaborator] = useState("");
  const [collabOpen, setCollabOpen]               = useState(false);
  const [storage, setStorage]                     = useState<TimesheetStorage>(loadStorage);
  const [overrides, setOverrides]                 = useState<OverrideStorage>(loadOverrides);

  // Pending override form (for excluded-unit collaborators)
  const [pendingPerson, setPendingPerson] = useState<OffshorePerson | null>(null);
  const [pendingUnit, setPendingUnit]     = useState("");
  const [pendingBsp, setPendingBsp]       = useState("");
  // Edit override form
  const [editingKey, setEditingKey]  = useState<string | null>(null);
  const [editUnit, setEditUnit]      = useState("");
  const [editBsp, setEditBsp]        = useState("");

  const periodKey   = `${dateStart}|${dateEnd}`;
  const periodLabel = `${fmtDate(dateStart)} – ${fmtDate(dateEnd)}`;
  const periodData  = storage[periodKey] ?? {};

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["offshore-data"],
    queryFn: () => getOffshoreData(),
    staleTime: 5 * 60 * 1000,
  });

  // Units for pill buttons (regular units only)
  const units = useMemo(
    () => [...new Set(people.map((p) => p.unit).filter(Boolean))].filter((u) => !isExcludedUnit(u)).sort(),
    [people],
  );

  // All collaborator names for search
  const collaboratorNames = useMemo(
    () => [...new Set(people.map((p) => p.name).filter(Boolean))].sort(),
    [people],
  );

  // Filtered people: regular eligible + excluded-unit with override
  const filteredPeople = useMemo(() => {
    return people.filter((p) => {
      const excluded = isExcludedUnit(p.unit);
      if (excluded && !overrides[pKey(p)]) return false; // excluded, no override → hide
      const effUnit = getEffUnit(p, overrides);
      return (
        (filterUnit.length === 0 || filterUnit.includes(effUnit)) &&
        (filterCollaborator === "" || p.name === filterCollaborator)
      );
    });
  }, [people, filterUnit, filterCollaborator, overrides]);

  const grouped = useMemo(() => {
    const unitMap: Record<string, Record<string, OffshorePerson[]>> = {};
    filteredPeople.forEach((p) => {
      const u = getEffUnit(p, overrides);
      const b = getEffBsp(p, overrides);
      if (!unitMap[u]) unitMap[u] = {};
      if (!unitMap[u][b]) unitMap[u][b] = [];
      unitMap[u][b].push(p);
    });
    return Object.entries(unitMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([unit, bspMap]) => ({
        unit,
        bsps: Object.entries(bspMap).sort(([a], [b]) => a.localeCompare(b)),
      }));
  }, [filteredPeople, overrides]);

  const toggle = (p: OffshorePerson) => {
    const key = pKey(p);
    const next = structuredClone(storage);
    if (!next[periodKey]) next[periodKey] = {};
    next[periodKey][key] = next[periodKey][key]?.delivered
      ? { delivered: false }
      : { delivered: true, deliveredAt: new Date().toISOString() };
    setStorage(next); saveStorage(next);
  };

  const confirmOverride = (person: OffshorePerson, unit: string, bsp: string) => {
    const next = { ...overrides, [pKey(person)]: { unit: unit.trim(), bsp: bsp.trim() } };
    setOverrides(next); saveOverrides(next);
  };

  const removeOverride = (key: string) => {
    const next = { ...overrides };
    delete next[key];
    setOverrides(next); saveOverrides(next);
  };

  const toggleUnit = (u: string) =>
    setFilterUnit((prev) => (prev.includes(u) ? prev.filter((v) => v !== u) : [...prev, u]));

  const totalPeople    = filteredPeople.length;
  const deliveredCount = filteredPeople.filter((p) => periodData[pKey(p)]?.delivered === true).length;
  const pendingCount   = totalPeople - deliveredCount;

  const exportExcel = () => {
    const rows = grouped.flatMap(({ unit, bsps }) =>
      bsps.flatMap(([bsp, bspPeople]) =>
        [...bspPeople]
          .sort((a, b) => {
            const aD = periodData[pKey(a)]?.delivered === true;
            const bD = periodData[pKey(b)]?.delivered === true;
            if (aD !== bD) return aD ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((p) => ({
            Período: periodLabel, Unidade: unit, BSP: bsp,
            Colaborador: p.name, Função: p.function,
            Status: periodData[pKey(p)]?.delivered === true ? "Entregue" : "Pendente",
          }))
      )
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 32 }, { wch: 22 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timesheets");
    XLSX.writeFile(wb, `timesheets_${dateStart}_${dateEnd}.xlsx`);
  };

  if (isLoading)
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Timesheets</h1>
          <p className="text-sm text-muted-foreground">Controle de entrega de timesheets por período e unidade.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1.5">
          <Download className="h-4 w-4" /> Exportar Excel
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-0.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">De</label>
            <input type="date" value={dateStart} onChange={(e) => handleDateStart(e.target.value)}
              className="h-8 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Até</label>
            <input type="date" value={dateEnd} onChange={(e) => handleDateEnd(e.target.value)}
              className="h-8 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="ml-2 flex items-end pb-0.5">
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          </div>

          {/* Collaborator search — ALL people */}
          <div className="space-y-0.5 ml-auto">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Colaborador</label>
            <div className="flex gap-1">
              <Popover open={collabOpen} onOpenChange={setCollabOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-56 h-8 justify-between font-normal text-xs">
                    <span className="truncate">{filterCollaborator || "Todos os colaboradores"}</span>
                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Digite o nome..." className="text-xs" />
                    <CommandList>
                      <CommandEmpty>Nenhum colaborador encontrado.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__all__" onSelect={() => { setFilterCollaborator(""); setCollabOpen(false); }} className="text-xs">
                          <Check className={cn("mr-2 h-3 w-3", filterCollaborator === "" ? "opacity-100" : "opacity-0")} /> Todos
                        </CommandItem>
                        {collaboratorNames.map((name) => {
                          const person = people.find((p) => p.name === name);
                          const isExcl = person ? isExcludedUnit(person.unit) : false;
                          const hasOverride = person ? !!overrides[pKey(person)] : false;
                          return (
                            <CommandItem
                              key={name} value={name}
                              onSelect={() => {
                                if (isExcl && !hasOverride && person) {
                                  setPendingPerson(person);
                                  setPendingUnit(""); setPendingBsp("");
                                  setCollabOpen(false);
                                } else {
                                  setFilterCollaborator(name === filterCollaborator ? "" : name);
                                  setCollabOpen(false);
                                }
                              }}
                              className="text-xs"
                            >
                              <Check className={cn("mr-2 h-3 w-3", filterCollaborator === name ? "opacity-100" : "opacity-0")} />
                              <span className="flex-1">{name}</span>
                              {isExcl && !hasOverride && (
                                <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 rounded px-1">+ Unidade</span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {filterCollaborator && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setFilterCollaborator("")}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pending override form */}
      {pendingPerson && (
        <Card className="p-4 border-amber-300 bg-amber-50/60">
          <p className="text-sm font-medium mb-3">
            Definir unidade e BSP para <strong>{pendingPerson.name}</strong>
            <span className="ml-2 text-xs text-amber-700 font-normal">(atualmente: {pendingPerson.unit || "sem unidade"})</span>
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-0.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Unidade</label>
              <input
                list="units-datalist" value={pendingUnit} onChange={(e) => setPendingUnit(e.target.value)}
                placeholder="Ex: ANNA NERY"
                className="h-8 rounded border border-input bg-background px-2 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <datalist id="units-datalist">{units.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            <div className="space-y-0.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">BSP</label>
              <input
                value={pendingBsp} onChange={(e) => setPendingBsp(e.target.value)}
                placeholder="Ex: P-51"
                className="h-8 rounded border border-input bg-background px-2 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button size="sm" className="h-8" disabled={!pendingUnit.trim() || !pendingBsp.trim()}
              onClick={() => {
                confirmOverride(pendingPerson, pendingUnit, pendingBsp);
                setFilterCollaborator(pendingPerson.name);
                setPendingPerson(null);
              }}
            >
              Confirmar
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setPendingPerson(null)}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {/* Edit override form */}
      {editingKey && (() => {
        const person = people.find((p) => pKey(p) === editingKey);
        if (!person) return null;
        return (
          <Card className="p-4 border-blue-300 bg-blue-50/40">
            <p className="text-sm font-medium mb-3">Editar unidade e BSP de <strong>{person.name}</strong></p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Unidade</label>
                <input list="units-datalist2" value={editUnit} onChange={(e) => setEditUnit(e.target.value)}
                  className="h-8 rounded border border-input bg-background px-2 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-ring" />
                <datalist id="units-datalist2">{units.map((u) => <option key={u} value={u} />)}</datalist>
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">BSP</label>
                <input value={editBsp} onChange={(e) => setEditBsp(e.target.value)}
                  className="h-8 rounded border border-input bg-background px-2 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <Button size="sm" className="h-8" disabled={!editUnit.trim() || !editBsp.trim()}
                onClick={() => { confirmOverride(person, editUnit, editBsp); setEditingKey(null); }}>
                Salvar
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => setEditingKey(null)}>Cancelar</Button>
              <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => { removeOverride(editingKey); setEditingKey(null); }}>
                Remover
              </Button>
            </div>
          </Card>
        );
      })()}

      {/* Unit pill buttons */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        <button onClick={() => setFilterUnit([])}
          className={cn("rounded-full px-2.5 h-6 text-[11px] font-medium border transition-colors whitespace-nowrap flex items-center shrink-0",
            filterUnit.length === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground")}>
          Todas
        </button>
        {units.map((u) => (
          <button key={u} onClick={() => toggleUnit(u)}
            className={cn("rounded-full px-2.5 h-6 text-[11px] font-medium border transition-colors whitespace-nowrap flex items-center shrink-0",
              filterUnit.includes(u) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground")}>
            {u}
          </button>
        ))}
      </div>

      <Tabs defaultValue="controle">
        <TabsList>
          <TabsTrigger value="controle">Controle</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório</TabsTrigger>
        </TabsList>

        {/* ── ABA CONTROLE ── */}
        <TabsContent value="controle" className="space-y-4 mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Total</span>
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 text-3xl font-semibold">{totalPeople}</div>
            </Card>
            <Card className="p-4 border-green-300">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-green-700">Entregues</span>
                <FileCheck className="h-4 w-4 text-green-600" />
              </div>
              <div className="mt-2 text-3xl font-semibold text-green-700">{deliveredCount}</div>
              <div className="mt-0.5 text-xs text-green-600">{totalPeople > 0 ? Math.round((deliveredCount / totalPeople) * 100) : 0}% do total</div>
            </Card>
            <Card className="p-4 border-red-300">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-red-700">Pendentes</span>
                <AlertCircle className="h-4 w-4 text-red-600" />
              </div>
              <div className="mt-2 text-3xl font-semibold text-red-700">{pendingCount}</div>
              <div className="mt-0.5 text-xs text-red-600">{totalPeople > 0 ? Math.round((pendingCount / totalPeople) * 100) : 0}% do total</div>
            </Card>
          </div>

          {grouped.map(({ unit, bsps }) => {
            const unitPeople = bsps.flatMap(([, pp]) => pp);
            const unitDel = unitPeople.filter((p) => periodData[pKey(p)]?.delivered === true).length;
            const unitPend = unitPeople.length - unitDel;
            return (
              <Card key={unit} className="overflow-hidden">
                <div className={cn("flex items-center justify-between px-4 py-2.5 border-b", unitPend === 0 ? "bg-green-50" : "bg-muted/60")}>
                  <span className="font-bold text-sm">{unit}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-green-700 font-medium">{unitDel} entregues</span>
                    {unitPend > 0 && <span className="font-bold text-red-700 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{unitPend} pendentes</span>}
                    <span className="text-muted-foreground">{unitPeople.length} total</span>
                  </div>
                </div>

                {bsps.map(([bsp, bspPeople]) => {
                  const bspDel = bspPeople.filter((p) => periodData[pKey(p)]?.delivered === true).length;
                  const bspPend = bspPeople.length - bspDel;
                  return (
                    <div key={bsp}>
                      <div className="flex items-center justify-between px-4 py-1.5 bg-muted/30 border-y text-xs font-semibold text-muted-foreground">
                        <span>BSP: <span className="text-foreground">{bsp}</span></span>
                        <div className="flex gap-3">
                          <span className="text-green-700">{bspDel} entregues</span>
                          {bspPend > 0 && <span className="text-red-700">{bspPend} pendentes</span>}
                          <span>{bspPeople.length} total</span>
                        </div>
                      </div>
                      <div className="flex items-center px-4 py-1 bg-muted/10 border-b text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 gap-3">
                        <span className="flex-1">Colaborador / Função</span>
                        <span className="w-24 text-center">Status</span>
                        <span className="w-28 text-right">Ação</span>
                      </div>
                      <div className="divide-y">
                        {[...bspPeople]
                          .sort((a, b) => {
                            const aD = periodData[pKey(a)]?.delivered === true;
                            const bD = periodData[pKey(b)]?.delivered === true;
                            if (aD !== bD) return aD ? 1 : -1;
                            return a.name.localeCompare(b.name);
                          })
                          .map((p) => (
                            <PersonRow
                              key={pKey(p)}
                              person={p}
                              delivered={periodData[pKey(p)]?.delivered === true}
                              periodLabel={periodLabel}
                              isManual={isExcludedUnit(p.unit) && !!overrides[pKey(p)]}
                              onToggle={() => toggle(p)}
                              onEdit={() => {
                                setEditingKey(pKey(p));
                                setEditUnit(overrides[pKey(p)]?.unit ?? "");
                                setEditBsp(overrides[pKey(p)]?.bsp ?? "");
                              }}
                            />
                          ))}
                      </div>
                    </div>
                  );
                })}
              </Card>
            );
          })}

          {filteredPeople.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">Nenhum colaborador encontrado.</div>
          )}
        </TabsContent>

        {/* ── ABA RELATÓRIO ── */}
        <TabsContent value="relatorio" className="mt-4">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between">
              <span className="text-sm font-semibold">Resumo por Unidade e BSP</span>
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">Unidade</th>
                    <th className="text-left px-4 py-2 font-medium">BSP</th>
                    <th className="text-right px-4 py-2 font-medium">Total</th>
                    <th className="text-right px-4 py-2 font-medium text-green-700">Entregues</th>
                    <th className="text-right px-4 py-2 font-medium text-red-700">Pendentes</th>
                    <th className="text-right px-4 py-2 font-medium">% Entregue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {grouped.map(({ unit, bsps }) => {
                    const unitPeople = bsps.flatMap(([, pp]) => pp);
                    const unitDel = unitPeople.filter((p) => periodData[pKey(p)]?.delivered === true).length;
                    const unitPend = unitPeople.length - unitDel;
                    const unitPct = unitPeople.length > 0 ? Math.round((unitDel / unitPeople.length) * 100) : 0;
                    return (
                      <>
                        {bsps.map(([bsp, bspPeople], bi) => {
                          const del = bspPeople.filter((p) => periodData[pKey(p)]?.delivered === true).length;
                          const pend = bspPeople.length - del;
                          const pct = bspPeople.length > 0 ? Math.round((del / bspPeople.length) * 100) : 0;
                          return (
                            <tr key={`${unit}-${bsp}`} className="hover:bg-muted/30">
                              <td className="px-4 py-2 font-medium">{bi === 0 ? unit : ""}</td>
                              <td className="px-4 py-2 text-muted-foreground">{bsp}</td>
                              <td className="px-4 py-2 text-right">{bspPeople.length}</td>
                              <td className="px-4 py-2 text-right font-medium text-green-700">{del}</td>
                              <td className="px-4 py-2 text-right font-medium text-red-700">{pend > 0 ? pend : "—"}</td>
                              <td className="px-4 py-2 text-right">
                                <span className={cn("font-semibold", pct === 100 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-red-700")}>{pct}%</span>
                              </td>
                            </tr>
                          );
                        })}
                        <tr key={`${unit}-sub`} className="bg-muted/40 text-xs font-semibold">
                          <td className="px-4 py-1.5 text-muted-foreground" colSpan={2}>↳ Subtotal {unit}</td>
                          <td className="px-4 py-1.5 text-right">{unitPeople.length}</td>
                          <td className="px-4 py-1.5 text-right text-green-700">{unitDel}</td>
                          <td className="px-4 py-1.5 text-right text-red-700">{unitPend > 0 ? unitPend : "—"}</td>
                          <td className="px-4 py-1.5 text-right">
                            <span className={cn(unitPct === 100 ? "text-green-700" : unitPct >= 50 ? "text-yellow-700" : "text-red-700")}>{unitPct}%</span>
                          </td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/60 font-bold text-sm">
                    <td className="px-4 py-2" colSpan={2}>Total Geral</td>
                    <td className="px-4 py-2 text-right">{totalPeople}</td>
                    <td className="px-4 py-2 text-right text-green-700">{deliveredCount}</td>
                    <td className="px-4 py-2 text-right text-red-700">{pendingCount > 0 ? pendingCount : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn("font-bold", totalPeople > 0 && Math.round((deliveredCount / totalPeople) * 100) === 100 ? "text-green-700" : "text-red-700")}>
                        {totalPeople > 0 ? Math.round((deliveredCount / totalPeople) * 100) : 0}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Person row ───────────────────────────────────────────────────────────────

function PersonRow({ person, delivered, periodLabel, isManual, onToggle, onEdit }: {
  person: OffshorePerson;
  delivered: boolean;
  periodLabel: string;
  isManual: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5 transition-colors", !delivered && "bg-red-50/60")}>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className={cn("text-sm font-medium", !delivered && "text-red-900")}>{person.name}</span>
        <span className="text-xs text-muted-foreground">{person.function}</span>
        {isManual && (
          <button onClick={onEdit} title="Editar unidade/BSP"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">
            <Pencil className="h-2.5 w-2.5" /> Manual
          </button>
        )}
      </div>

      <div className="w-24 flex justify-center">
        {delivered ? (
          <div className="text-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
              <Check className="h-3 w-3" /> Entregue
            </span>
            <div className="text-[10px] text-muted-foreground mt-0.5">{periodLabel}</div>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            <X className="h-3 w-3" /> Pendente
          </span>
        )}
      </div>

      <div className="w-28 flex justify-end">
        <Button size="sm" variant={delivered ? "outline" : "default"}
          className={cn("h-7 text-xs w-full", !delivered && "bg-green-600 hover:bg-green-700 text-white border-0")}
          onClick={onToggle}>
          {delivered ? "Desfazer" : "Entregue"}
        </Button>
      </div>
    </div>
  );
}
