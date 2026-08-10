import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bms/bm_lines_*/rates ainda não existem no schema gerado (types.ts) — cast local pra não
// bloquear o build enquanto as migrations não rodam contra o banco remoto e o codegen não
// é refeito (mesmo padrão já usado em admin/nominations.tsx e admin/rates.tsx).
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyStateRow } from "@/components/EmptyState";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { AlertTriangle, ArrowLeft, ArrowRight, FileSpreadsheet, Plus, Trash2, Coins, CircleAlert, CheckCircle2 } from "lucide-react";
import { EVENTOS_DIA } from "@/lib/timesheetOffshore";
import {
  type Bm, type BmStatus, type BmLineMo, type BmLineLogistica, type BmLineMateriais, type BmDiaOverride, type MaterialCategoria,
  STATUS_LABELS, STATUS_TONE, computeBmTotals, isBwEnergy,
} from "@/lib/bm";
import { aggregateMaoDeObra, type Rate, type TimesheetDiaComColaborador } from "@/lib/bmRateEngine";
import { BmConsolidatedView } from "@/components/bm/BmConsolidatedView";
import { MobDesmobTab } from "@/components/bm/MobDesmobTab";
import { MedicaoTab } from "@/components/bm/MedicaoTab";

import { TimesheetsTab } from "@/components/bm/TimesheetsTab";
import { generateBmExport, generateBmExportBwEnergy, type BmExportData } from "@/lib/bmExcel";
import { getBmHistoryForPo, recordIssuedBm, getNextBmNumber, listSmartsheetBms } from "@/lib/api/smartsheetBm.functions";
import { listBmFlowRows } from "@/lib/api/bmFlow.functions";
import { getJobOrderPoTotal } from "@/lib/api/jobOrderPoTotal.functions";

interface BmFlowRowOption {
  client: string;
  vessel: string;
  bsp: string;
  poNumber: string;
}

const EMPTY_BM_FLOW_ROWS: BmFlowRowOption[] = [];

function bmFlowKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function distinctBmFlowValues(values: string[]): string[] {
  const distinct = new Map<string, string>();

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;

    const key = bmFlowKey(value);

    if (!distinct.has(key)) {
      distinct.set(key, value);
    }
  }

  return Array.from(distinct.values()).sort((a, b) =>
    a.localeCompare(b, "pt-BR", { numeric: true }),
  );
}

interface SmartsheetBmOption {
  rowId: string;
  bmNumber: string;
  poNumber: string | null;
  client: string | null;
  vessel: string | null;
  value: number | null;
  date: string | null;
}
const EMPTY_BM_LIST: SmartsheetBmOption[] = [];
const NOVO_BM = "__novo__";


import { pageTitle } from "@/lib/pageTitle";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/bm")({ head: () => pageTitle("Boletim de Medição"), component: BmPage });

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}
function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const EVENTO_OPCOES_BM = ["Nenhum", ...EVENTOS_DIA];

// Referência estável pro fallback do useQuery de diasBase abaixo — um array literal `[]`
// inline no destructuring é recriado a cada render enquanto a query ainda carrega, o que
// propaga uma referência nova pra cada useMemo encadeado (diasComOverrides -> maoDeObraCalculada)
// e faz o useEffect que sincroniza linesMo rodar sem parar ("Maximum update depth exceeded").
const EMPTY_DIAS_BM: TimesheetDiaComColaborador[] = [];
// Mesmo motivo — rates entra no useMemo de maoDeObraCalculada, então também precisa de uma
// referência estável enquanto a query carrega.
const EMPTY_RATES_BM: Rate[] = [];
const EMPTY_COLABORADORES_MEDIDOS = new Set<string>();

// Chave de override por dia — colaborador + data já é único dentro de um BM (um vessel/período
// por vez), não precisa do id da linha real do timesheet.
function chaveDiaOverride(colaboradorId: string, data: string): string {
  return `${colaboradorId}::${data}`;
}

interface DiaOverrideEdit {
  evento: string | null;
  horas_extras: number | null;
  adicional_noturno: boolean;
  total_horas: number | null;
  observacao: string;
}

function BmPage() {
  const [reopenBm, setReopenBm] = useState<Bm | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Boletim de Medição</h1>
        <p className="text-sm text-muted-foreground">Geração automática de BM a partir do Timesheet Offshore e Logística.</p>
      </div>
      <Tabs defaultValue="gerar">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="gerar">Gerar Novo BM</TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
          <TabsTrigger value="mob-desmob">Logística Mob/Desmob</TabsTrigger>
          <TabsTrigger value="habitat">Medição de Habitat</TabsTrigger>
          <TabsTrigger value="locacao">Medição de Locação</TabsTrigger>
          <TabsTrigger value="consumiveis">Medição de Consumíveis</TabsTrigger>
          <TabsTrigger value="mob-materiais">Medição de Mob/Desmob de Materiais</TabsTrigger>
          <TabsTrigger value="historico">Histórico de BMs</TabsTrigger>
        </TabsList>
        <TabsContent value="gerar" className="mt-4">
          <GerarBmWizard reopenBm={reopenBm} onConsumedReopen={() => setReopenBm(null)} />
        </TabsContent>
        <TabsContent value="timesheets" className="mt-4">
          <TimesheetsTab />
        </TabsContent>
        <TabsContent value="mob-desmob" className="mt-4">
          <MobDesmobTab />
        </TabsContent>
        <TabsContent value="habitat" className="mt-4">
          <MedicaoTab tipo="habitat" titulo="Lançar medição de Habitat" smartsheetColumn="Medição Habitat"
            bmColumn="total_habitat"
            descricaoLabel="Habitat / Módulo" descricaoPlaceholder="Ex: Habitat 4 pax - Convés principal" />
        </TabsContent>
        <TabsContent value="locacao" className="mt-4">
          <MedicaoTab tipo="locacao" titulo="Lançar medição de Locação" smartsheetColumn="Medição Locação"
            bmColumn="total_locacao"
            descricaoLabel="Equipamento locado" descricaoPlaceholder="Ex: Compressor 185 PCM" />
        </TabsContent>
        <TabsContent value="consumiveis" className="mt-4">
          <MedicaoTab tipo="consumiveis" titulo="Lançar medição de Consumíveis" smartsheetColumn="Medição Consumíveis"
            bmColumn="total_consumiveis"
            descricaoLabel="Consumível" descricaoPlaceholder="Ex: Eletrodo E7018 3,25mm" />
        </TabsContent>
        <TabsContent value="mob-materiais" className="mt-4">
          <MedicaoTab tipo="mob_desmob_materiais" titulo="Lançar medição de Mob/Desmob de Materiais"
            smartsheetColumn="Medição Mob/Desmob Materiais"
            bmColumn="total_mob_desmob_materiais"
            descricaoLabel="Material" descricaoPlaceholder="Ex: Container 20' - Macaé → Base" />
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <HistoricoBmsTab onReopen={setReopenBm} />
        </TabsContent>
      </Tabs>

    </div>
  );
}

// ─── Wizard: Gerar Novo BM ───────────────────────────────────────────────────

interface Cabecalho {
  client: string;
  bsp: string;
  vessel: string;
  periodStart: string;
  periodEnd: string;
  poNumber: string;
  poValue: number | null;
  poBalanceBefore: number | null;
  numeroBm: string;
}

const CABECALHO_VAZIO: Cabecalho = {
  client: "", bsp: "", vessel: "", periodStart: "", periodEnd: "",
  poNumber: "", poValue: null, poBalanceBefore: null, numeroBm: "",
};

type MedicaoKey = "habitat" | "locacao" | "consumiveis" | "mob_desmob_materiais";

const MEDICOES_ZERO: Record<MedicaoKey, number> = {
  habitat: 0, locacao: 0, consumiveis: 0, mob_desmob_materiais: 0,
};

const MEDICOES_LABEL: Record<MedicaoKey, string> = {
  habitat: "Medição de Habitat",
  locacao: "Medição de Locação",
  consumiveis: "Medição de Consumíveis",
  mob_desmob_materiais: "Medição de Mob/Desmob de Materiais",
};

const MEDICOES_COLUNA: Record<MedicaoKey, string> = {
  habitat: "total_habitat",
  locacao: "total_locacao",
  consumiveis: "total_consumiveis",
  mob_desmob_materiais: "total_mob_desmob_materiais",
};


function GerarBmWizard({ reopenBm, onConsumedReopen }: { reopenBm: Bm | null; onConsumedReopen: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [cab, setCab] = useState<Cabecalho>(CABECALHO_VAZIO);
  const [linesMo, setLinesMo] = useState<Omit<BmLineMo, "id" | "bm_id">[]>([]);
  const [linesLogistica, setLinesLogistica] = useState<Omit<BmLineLogistica, "id" | "bm_id">[]>([]);
  const [linesMateriais, setLinesMateriais] = useState<Omit<BmLineMateriais, "id" | "bm_id">[]>([]);
  // Correção pontual de dia — chave colaborador::data (ver chaveDiaOverride) — só pra efeito
  // dessa medição, nunca grava em timesheet_dias. observacao é obrigatória pra justificar.
  const [diasOverrides, setDiasOverrides] = useState<Record<string, DiaOverrideEdit>>({});
  const [markupEnabled, setMarkupEnabled] = useState(false);
  const [markupPct, setMarkupPct] = useState(15);
  // Campos simples, lançados direto no formulário (sem integração com Smartsheet) — ver
  // migration 20260805200000_bm_pos_processamento_team_mob_notes.sql.
  const [posProcessamento, setPosProcessamento] = useState(0);
  const [teamMobDesmob, setTeamMobDesmob] = useState(0);
  const [internalNotes, setInternalNotes] = useState("");
  const [reopenBmId, setReopenBmId] = useState<string | null>(null);
  const [cienteRatesFaltando, setCienteRatesFaltando] = useState(false);
  // true = usuário optou por criar um número de BM novo em vez de escolher um da lista.
  const [bmNovoManual, setBmNovoManual] = useState(false);
  const [selectedBmNumbers, setSelectedBmNumbers] =
    useState<string[]>([]);
  const previousPoNumberRef = useRef("");
  // Resultado do último BM gerado/salvo — enquanto preenchido, a tela mostra o BmConsolidatedView
  // (Consolidado + Diárias + Horas) no lugar do wizard, pra "Gerar BM" ter um resultado visível
  // imediato em vez de só um toast e o formulário voltando em branco.
  const [savedBm, setSavedBm] = useState<Bm | null>(null);
  const [savedLinesMo, setSavedLinesMo] = useState<BmLineMo[]>([]);
  const [savedLinesLogistica, setSavedLinesLogistica] = useState<BmLineLogistica[]>([]);

  useEffect(() => {
    if (!reopenBm) return;
    setStep(0);
    setSavedBm(null); setSavedLinesMo([]); setSavedLinesLogistica([]);
    setCab({
      client: reopenBm.client_name, bsp: reopenBm.project_name ?? "",
      vessel: reopenBm.vessel, periodStart: reopenBm.period_start, periodEnd: reopenBm.period_end,
      poNumber: reopenBm.po_number ?? "", poValue: reopenBm.po_value, poBalanceBefore: reopenBm.po_balance_before,
      numeroBm: reopenBm.numero_bm ?? "",

    });
    setMarkupEnabled(reopenBm.markup_enabled);
    setMarkupPct(reopenBm.markup_pct);
    setPosProcessamento(reopenBm.pos_processamento ?? 0);
    setTeamMobDesmob(reopenBm.team_mob_desmob ?? 0);
    setInternalNotes(reopenBm.internal_notes ?? "");
    setReopenBmId(reopenBm.id);
    setBmNovoManual(true);
    setSelectedBmNumbers([]);
    (async () => {
      const { data, error } = await supabase.from("bm_dias_overrides").select("*").eq("bm_id", reopenBm.id);
      if (error) { notify.error(error.message); return; }
      const restaurado: Record<string, DiaOverrideEdit> = {};
      (data ?? []).forEach((o: BmDiaOverride) => {
        restaurado[chaveDiaOverride(o.colaborador_id, o.data)] = {
          evento: o.evento, horas_extras: o.horas_extras, adicional_noturno: o.adicional_noturno,
          total_horas: o.total_horas, observacao: o.observacao,
        };
      });
      setDiasOverrides(restaurado);
    })();
    onConsumedReopen();
  }, [reopenBm]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetWizard = () => {
    setStep(0); setCab(CABECALHO_VAZIO); setLinesMo([]); setLinesLogistica([]); setLinesMateriais([]);
    setDiasOverrides({});
    setMarkupEnabled(false); setMarkupPct(15); setReopenBmId(null); setCienteRatesFaltando(false);
    setPosProcessamento(0); setTeamMobDesmob(0); setInternalNotes("");
    setSavedBm(null); setSavedLinesMo([]); setSavedLinesLogistica([]);
    setSelectedBmNumbers([]);
    setBmNovoManual(false);
    previousPoNumberRef.current = "";
  };

  // Clientes cadastrados (tabela antiga) — usado só pra resolver o client_id ao salvar o BM
  // e filtrar a Logística (cost_logs), já que "Projeto" saiu do cabeçalho e virou BSP.
  const { data: clientRows = [] } = useQuery({
    queryKey: ["bm-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const clientIdAtual = useMemo(
    () => clientRows.find((c) => c.name.trim().toLowerCase() === cab.client.trim().toLowerCase())?.id ?? null,
    [clientRows, cab.client],
  );

  // As quatro opções do cabeçalho vêm das mesmas linhas do Smartsheet.
  // Isso preserva a relação CLIENTE -> UNIDADE -> BSP -> PO.
  const {
    data: bmFlowRows = EMPTY_BM_FLOW_ROWS,
    isLoading: bmFlowLoading,
    error: bmFlowError,
  } = useQuery<BmFlowRowOption[]>({
    queryKey: ["smartsheet-bm-flow-rows"],
    queryFn: async () =>
      (await listBmFlowRows()) as BmFlowRowOption[],
    staleTime: 10 * 60 * 1000,
  });

  const clientOptions = useMemo(
    () => distinctBmFlowValues(bmFlowRows.map((row) => row.client)),
    [bmFlowRows],
  );

  const vesselOptions = useMemo(
    () =>
      distinctBmFlowValues(
        bmFlowRows
          .filter(
            (row) =>
              bmFlowKey(row.client) === bmFlowKey(cab.client),
          )
          .map((row) => row.vessel),
      ),
    [bmFlowRows, cab.client],
  );

  const bspOptions = useMemo(
    () =>
      distinctBmFlowValues(
        bmFlowRows
          .filter(
            (row) =>
              bmFlowKey(row.client) === bmFlowKey(cab.client) &&
              bmFlowKey(row.vessel) === bmFlowKey(cab.vessel),
          )
          .map((row) => row.bsp),
      ),
    [bmFlowRows, cab.client, cab.vessel],
  );

  const poOptions = useMemo(
    () =>
      distinctBmFlowValues(
        bmFlowRows
          .filter(
            (row) =>
              bmFlowKey(row.client) === bmFlowKey(cab.client) &&
              bmFlowKey(row.vessel) === bmFlowKey(cab.vessel) &&
              bmFlowKey(row.bsp) === bmFlowKey(cab.bsp),
          )
          .map((row) => row.poNumber),
      ),
    [bmFlowRows, cab.client, cab.vessel, cab.bsp],
  );

  const headerCompleto = !!(cab.client && cab.vessel && cab.periodStart && cab.periodEnd);

  // ── Smartsheet: Job Order (lista de POs) e Controle de BM (sequência) ──────────────────
  // Só leitura: a planilha Job Order alimenta o autocomplete de PO (uma linha por PO, valor
  // somado de todas as ocorrências) e o Controle de BM dá o próximo número da sequência.
  const {
    data: jobOrderPoTotal,
    isFetching: jobOrderPoTotalLoading,
    error: jobOrderPoTotalError,
  } = useQuery({
    queryKey: [
      "smartsheet-job-order-po-total",
      cab.poNumber.trim(),
    ],
    enabled: !!cab.poNumber.trim(),
    queryFn: async () =>
      await getJobOrderPoTotal({
        data: {
          poNumber: cab.poNumber.trim(),
        },
      }),
    staleTime: 10 * 60 * 1000,
  });

  // Preenche automaticamente o Valor Total da PO assim que
  // a PO de Faturamento é selecionada.
  useEffect(() => {
    if (!cab.poNumber.trim()) {
      setCab((current) =>
        current.poValue == null
          ? current
          : {
              ...current,
              poValue: null,
              poBalanceBefore: null,
            },
      );

      return;
    }

    if (!jobOrderPoTotal) return;

    setCab((current) =>
      current.poValue === jobOrderPoTotal.totalValue
        ? current
        : {
            ...current,
            poValue: jobOrderPoTotal.totalValue,
          },
    );
  }, [cab.poNumber, jobOrderPoTotal]);

  // Total já emitido pra essa PO (Controle de Boletins de Medição) — junto com o Valor Total
  // da PO acima, dá o Saldo antes deste BM (BM Issued / Balance no card do Cabeçalho).
  const { data: bmHistoryForPo } = useQuery({
    queryKey: ["smartsheet-bm-history", cab.poNumber.trim()],
    enabled: !!cab.poNumber.trim(),
    queryFn: async () => await getBmHistoryForPo({ data: { poNumber: cab.poNumber.trim() } }),
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (!cab.poNumber.trim() || cab.poValue == null) return;
    const bmsIssued = bmHistoryForPo?.totalIssued ?? 0;
    const novoSaldo = round2(cab.poValue - bmsIssued);
    setCab((current) =>
      current.poBalanceBefore === novoSaldo ? current : { ...current, poBalanceBefore: novoSaldo },
    );
  }, [cab.poNumber, cab.poValue, bmHistoryForPo]);

  const { data: proximoBm } = useQuery({
    queryKey: ["smartsheet-next-bm"],
    queryFn: async () => await getNextBmNumber(),
    staleTime: 10 * 60 * 1000,
  });

  // Controle de Medição (Smartsheet): lista de BMs já existentes — alimenta a lista de
  // números de BM e a lista de POs; o valor do BM vem da própria linha da planilha.
  const { data: smartsheetBms = EMPTY_BM_LIST } = useQuery<SmartsheetBmOption[]>({
    queryKey: ["smartsheet-bm-list"],
    queryFn: async () => (await listSmartsheetBms()) as SmartsheetBmOption[],
    staleTime: 10 * 60 * 1000,
  });

  const bmsDaPo = useMemo(() => {
    const poKey = bmFlowKey(cab.poNumber);

    if (!poKey) return [];

    const grouped = new Map<string, SmartsheetBmOption>();

    for (const bm of smartsheetBms) {
      if (bmFlowKey(bm.poNumber ?? "") !== poKey) {
        continue;
      }

      const bmKey = bmFlowKey(bm.bmNumber);

      if (!bmKey) continue;

      const current = grouped.get(bmKey);

      if (current) {
        current.value = round2(
          (current.value ?? 0) + (bm.value ?? 0),
        );
      } else {
        grouped.set(bmKey, { ...bm });
      }
    }

    return Array.from(grouped.values()).sort((a, b) =>
      a.bmNumber.localeCompare(
        b.bmNumber,
        "pt-BR",
        { numeric: true },
      ),
    );
  }, [smartsheetBms, cab.poNumber]);

  const selectedBmKeys = useMemo(
    () =>
      new Set(
        selectedBmNumbers.map((number) =>
          bmFlowKey(number),
        ),
      ),
    [selectedBmNumbers],
  );

  const bmsSelecionados = useMemo(
    () =>
      bmsDaPo.filter((bm) =>
        selectedBmKeys.has(bmFlowKey(bm.bmNumber)),
      ),
    [bmsDaPo, selectedBmKeys],
  );

  const valorTotalBms = useMemo(
    () =>
      round2(
        bmsSelecionados.reduce(
          (total, bm) => total + (bm.value ?? 0),
          0,
        ),
      ),
    [bmsSelecionados],
  );

  useEffect(() => {
    const currentPo = cab.poNumber.trim();
    const previousPo = previousPoNumberRef.current;

    if (
      previousPo &&
      bmFlowKey(previousPo) !== bmFlowKey(currentPo)
    ) {
      setSelectedBmNumbers([]);
      setBmNovoManual(false);
    }

    previousPoNumberRef.current = currentPo;
  }, [cab.poNumber]);

  useEffect(() => {
    const available = new Set(
      bmsDaPo.map((bm) => bmFlowKey(bm.bmNumber)),
    );

    setSelectedBmNumbers((current) => {
      const next = current.filter((number) =>
        available.has(bmFlowKey(number)),
      );

      const unchanged =
        next.length === current.length &&
        next.every(
          (number, index) => number === current[index],
        );

      return unchanged ? current : next;
    });
  }, [bmsDaPo]);

  useEffect(() => {
    if (bmNovoManual) return;

    const joined = selectedBmNumbers.join(", ");

    setCab((current) =>
      current.numeroBm === joined
        ? current
        : {
            ...current,
            numeroBm: joined,
          },
    );
  }, [selectedBmNumbers, bmNovoManual]);

  function toggleBmSelection(
    bmNumber: string,
    checked: boolean,
  ) {
    setBmNovoManual(false);

    setSelectedBmNumbers((current) => {
      const selectedKey = bmFlowKey(bmNumber);
      const alreadySelected = current.some(
        (number) =>
          bmFlowKey(number) === selectedKey,
      );

      if (checked && !alreadySelected) {
        return [...current, bmNumber];
      }

      if (!checked && alreadySelected) {
        return current.filter(
          (number) =>
            bmFlowKey(number) !== selectedKey,
        );
      }

      return current;
    });
  }



  // ── Step 1: Horas do Timesheet (compilado editável, alimenta a Mão de Obra) ─────────────
  // Fonte única: a cópia em bm_timesheet_dias (aba "Timesheets" do próprio módulo de BM),
  // filtrada por BSP — nunca mais por unidade_operacional. O Cabeçalho hoje seleciona
  // Cliente/Embarcação/BSP a partir do Smartsheet (cascata da planilha "Controle de
  // Boletins de Medição"), cujo texto de UNIDADE é digitado livremente por quem lançou o BM
  // e quase nunca bate com o nome canônico salvo em timesheet_embarques.unidade_operacional
  // (ex.: "ANCHIETA - CDA" no Smartsheet vs. "CDAN - CIDADE ANCHIETA" no Timesheet Offshore)
  // — filtrar por vessel ali zerava embarqueIds e nunca trazia hora nenhuma. BSP também varia
  // de prefixo (BSP/BPP/B3D/BPS + espaço/traço opcional) entre as duas fontes, daí a
  // normalização abaixo stripar qualquer prefixo alfabético, não só "BSP".
  const { data: diasBase = EMPTY_DIAS_BM, isFetching: carregandoDias } = useQuery({
    queryKey: ["bm-dias", cab.bsp, cab.periodStart, cab.periodEnd],
    enabled: headerCompleto && !!cab.bsp,
    queryFn: async () => {
      const { data: copiasData, error: copiasErr } = await supabase
        .from("bm_timesheet_dias")
        .select("colaborador_id, colaborador_nome, funcao, bsp, data, evento, horas_extras, adicional_noturno, total_horas")
        .gte("data", cab.periodStart).lte("data", cab.periodEnd);
      if (copiasErr) throw copiasErr;

      const normalizarBsp = (s: string | null | undefined) => (s ?? "").replace(/^[a-z]+[\s-]*/i, "").trim().toLowerCase();
      const bspAlvo = normalizarBsp(cab.bsp);

      const diasComColaborador: TimesheetDiaComColaborador[] = (copiasData ?? [])
        .filter((d: any) => d.colaborador_id && normalizarBsp(d.bsp) === bspAlvo)
        .map((d: any): TimesheetDiaComColaborador => ({
          data: d.data,
          evento: d.evento,
          horas_extras: d.horas_extras,
          adicional_noturno: !!d.adicional_noturno,
          total_horas: d.total_horas,
          colaborador_id: d.colaborador_id,
          colaborador_nome: d.colaborador_nome ?? "—",
          funcao_embarque: d.funcao ?? "—",
          bsp: d.bsp,
        }));

      return diasComColaborador.sort((a, b) => a.colaborador_nome.localeCompare(b.colaborador_nome) || a.data.localeCompare(b.data));
    },
  });

  // Aplica as correções pontuais (diasOverrides) por cima dos dias reais — só pra efeito de
  // cálculo/exibição no BM, sem tocar no dado original em diasBase.
  const diasComOverrides = useMemo<TimesheetDiaComColaborador[]>(() => diasBase.map((d) => {
    const ov = diasOverrides[chaveDiaOverride(d.colaborador_id, d.data)];
    if (!ov) return d;
    return { ...d, evento: ov.evento, horas_extras: ov.horas_extras, adicional_noturno: ov.adicional_noturno, total_horas: ov.total_horas };
  }), [diasBase, diasOverrides]);

  // Quem já apareceu em Mão de Obra de outro BM (qualquer status) do mesmo vessel com período
  // sobrepondo o escolhido aqui — colaborador que está no compilado mas não está nesse conjunto
  // ainda não foi medido em nenhum BM pra esse intervalo (ver flag piscando na aba Horas do
  // Timesheet). Exclui o próprio BM sendo reaberto, senão ele "já mediu a si mesmo".
  const { data: colaboradoresJaMedidos = EMPTY_COLABORADORES_MEDIDOS } = useQuery({
    queryKey: ["bm-colaboradores-medidos", cab.vessel, cab.periodStart, cab.periodEnd, reopenBmId],
    enabled: headerCompleto,
    queryFn: async () => {
      const { data: bmsData, error: bmsErr } = await supabase
        .from("bms").select("id").eq("vessel", cab.vessel)
        .lte("period_start", cab.periodEnd).gte("period_end", cab.periodStart);
      if (bmsErr) throw bmsErr;
      const bmIds = (bmsData ?? []).map((b: any) => b.id).filter((id: string) => id !== reopenBmId);
      if (!bmIds.length) return new Set<string>();
      const { data: linesData, error: linesErr } = await supabase.from("bm_lines_mo").select("colaborador_id").in("bm_id", bmIds);
      if (linesErr) throw linesErr;
      return new Set<string>((linesData ?? []).map((l: any) => l.colaborador_id).filter(Boolean));
    },
  });

  // Rate é buscado por Cliente+Embarcação+Função (bate com a planilha mestre de rates da
  // usuária) — não varia por BSP, então filtra só por cliente/embarcação aqui e deixa o
  // cruzamento de função (com fallback de nível) por conta de findRate (bmRateEngine.ts).
  const { data: rates = EMPTY_RATES_BM } = useQuery({
    queryKey: ["bm-rates", cab.client, cab.vessel],
    enabled: headerCompleto,
    queryFn: async () => {
      const { data, error } = await supabase.from("rates").select("*").eq("client", cab.client).eq("vessel", cab.vessel).eq("active", true);
      if (error) throw error;
      return (data ?? []) as Rate[];
    },
  });

  const carregandoMo = carregandoDias;

  const maoDeObraCalculada = useMemo(
    () => (headerCompleto ? aggregateMaoDeObra(diasComOverrides, rates, cab.client, cab.vessel) : []),
    [diasComOverrides, rates, cab.client, cab.vessel, headerCompleto],
  );

  useEffect(() => {
    setLinesMo(maoDeObraCalculada.map(({ hasHoraExtraRate: _a, hasAdicionalNoturnoRate: _b, ...rest }) => rest));
  }, [maoDeObraCalculada]);

  const hasRateMissing = linesMo.some((l) => l.rate_missing);

  const salvarDiaOverride = (colaboradorId: string, data: string, edit: DiaOverrideEdit | null) => {
    const key = chaveDiaOverride(colaboradorId, data);
    setDiasOverrides((prev) => {
      if (!edit) { const { [key]: _removido, ...resto } = prev; return resto; }
      return { ...prev, [key]: edit };
    });
  };

  // ── Step 3: Logística ──────────────────────────────────────────────────────
  const { data: costLogsCalculados, isFetching: carregandoLogistica } = useQuery({
    queryKey: ["bm-logistica", clientIdAtual, cab.periodStart, cab.periodEnd],
    enabled: !!clientIdAtual && headerCompleto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_logs").select("id, cost_type, amount, period_start, period_end, notes, vendors(name), profiles(full_name)")
        .eq("client_id", clientIdAtual)
        .lte("period_start", cab.periodEnd).gte("period_end", cab.periodStart);
      if (error) throw error;
      return (data ?? []).map((c: any): Omit<BmLineLogistica, "id" | "bm_id"> => ({
        cost_log_id: c.id, cost_type: c.cost_type, vendor_name: c.vendors?.name ?? null,
        collaborator_name: c.profiles?.full_name ?? null, amount: Number(c.amount), period_start: c.period_start,
        period_end: c.period_end, notes: c.notes, is_manual: false,
      }));
    },
  });

  useEffect(() => {
    if (costLogsCalculados) setLinesLogistica(costLogsCalculados);
  }, [costLogsCalculados]);

  const totals = useMemo(
    () => computeBmTotals(linesMo, linesLogistica, linesMateriais, markupEnabled, markupPct, posProcessamento, teamMobDesmob),
    [linesMo, linesLogistica, linesMateriais, markupEnabled, markupPct, posProcessamento, teamMobDesmob],
  );

  // ── Medições aplicadas a este BM (Habitat, Locação, Consumíveis, Mob/Desmob) ───────────
  // Cada aba de medição consolida seus lançamentos e aplica o total ao BM; aqui o cabeçalho
  // apenas lê os totais já aplicados ao número de BM selecionado.
  const numeroBmAtual = cab.numeroBm.trim();
  const { data: medicoes = MEDICOES_ZERO } = useQuery<Record<MedicaoKey, number>>({
    queryKey: ["bm-medicoes-aplicadas", numeroBmAtual],
    enabled: !!numeroBmAtual,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_medicoes").select("tipo, valor_total")
        .eq("applied", true).eq("applied_bm_number", numeroBmAtual);
      if (error) throw error;
      const acc: Record<MedicaoKey, number> = { ...MEDICOES_ZERO };
      for (const r of (data ?? []) as { tipo: MedicaoKey; valor_total: number }[]) {
        if (r.tipo in acc) acc[r.tipo] = round2(acc[r.tipo] + (Number(r.valor_total) || 0));
      }
      return acc;
    },
  });
  const totalMedicoes = useMemo(
    () => round2(Object.values(medicoes).reduce((a, v) => a + v, 0)),
    [medicoes],
  );

  // ── Logística Mob/Desmob (transporte e hotel) aplicada ao BSP selecionado ───────────────
  // Os custos importados na aba "Logística Mob/Desmob" são aplicados por BSP; ao selecionar
  // o BSP aqui, os totais de transporte e hotel já aplicados entram no cálculo do BM.
  const { data: mobDesmob = { transporte: 0, hotel: 0, outros: 0 } } = useQuery({
    queryKey: ["bm-mob-desmob-aplicados", cab.bsp, numeroBmAtual],
    enabled: !!cab.bsp,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_mob_desmob_costs").select("categoria, total_cost, applied_bm_number")
        .eq("applied", true).eq("bsp", cab.bsp);
      if (error) throw error;
      const acc = { transporte: 0, hotel: 0, outros: 0 };
      for (const r of (data ?? []) as { categoria: "transporte" | "hotel" | "outros"; total_cost: number; applied_bm_number: string | null }[]) {
        if (numeroBmAtual && r.applied_bm_number && r.applied_bm_number !== numeroBmAtual) continue;
        const k = (r.categoria in acc ? r.categoria : "outros") as keyof typeof acc;
        acc[k] = round2(acc[k] + (Number(r.total_cost) || 0));
      }
      return acc;
    },
  });
  const totalMobDesmob = round2(mobDesmob.transporte + mobDesmob.hotel + mobDesmob.outros);

  const totalGeralComMedicoes = round2(totals.grandTotal + totalMedicoes + totalMobDesmob);

  const poBalanceDepois = cab.poBalanceBefore != null ? round2(cab.poBalanceBefore - totalGeralComMedicoes) : null;



  const bmExportData: BmExportData = useMemo(() => ({
    client: cab.client, vessel: cab.vessel, projectName: cab.bsp,
    periodStart: cab.periodStart, periodEnd: cab.periodEnd, poNumber: cab.poNumber,
    poValue: cab.poValue, poBalanceBefore: cab.poBalanceBefore,
    markupEnabled, markupPct, totals,
  }), [cab, markupEnabled, markupPct, totals]);

  const salvarBm = useMutation({
    mutationFn: async (targetStatus: "draft" | "pending_pm") => {
      const payload = {
        numero_bm: cab.numeroBm.trim() || null,
        client_id: clientIdAtual,
        client_name: cab.client,
        project_id: null,
        // "project_name" é reaproveitado pra guardar o BSP — "Projeto" saiu do cabeçalho
        // do BM, ver comentário na query bspOptions acima.
        project_name: cab.bsp || null,
        vessel: cab.vessel,
        period_start: cab.periodStart,
        period_end: cab.periodEnd,
        po_number: cab.poNumber || null,
        po_value: cab.poValue,
        po_balance_before: cab.poBalanceBefore,
        markup_enabled: markupEnabled,
        markup_pct: markupPct,
        total_mo: totals.totalMo,
        total_logistica: totals.totalLogisticaComMarkup,
        total_materiais: totals.totalMateriais,
        total_habitat: medicoes.habitat,
        total_locacao: medicoes.locacao,
        total_consumiveis: medicoes.consumiveis,
        total_mob_desmob_materiais: medicoes.mob_desmob_materiais,
        pos_processamento: posProcessamento,
        team_mob_desmob: teamMobDesmob,
        internal_notes: internalNotes.trim() || null,
        total_geral: totalGeralComMedicoes,

        current_status: targetStatus,
      };

      let bmId = reopenBmId;
      let bmRow: Bm;
      if (bmId) {
        const { data, error } = await supabase.from("bms").update(payload).eq("id", bmId).select("*").single();
        if (error) throw error;
        bmRow = data as Bm;
        await supabase.from("bm_lines_mo").delete().eq("bm_id", bmId);
        await supabase.from("bm_lines_logistica").delete().eq("bm_id", bmId);
        await supabase.from("bm_lines_materiais").delete().eq("bm_id", bmId);
        await supabase.from("bm_dias_overrides").delete().eq("bm_id", bmId);
      } else {
        const { data, error } = await supabase.from("bms").insert(payload).select("*").single();
        if (error) throw error;
        bmRow = data as Bm;
        bmId = bmRow.id;
      }

      let savedMo: BmLineMo[] = [];
      let savedLogistica: BmLineLogistica[] = [];
      if (linesMo.length) {
        const { data, error } = await supabase.from("bm_lines_mo").insert(linesMo.map((l) => ({ ...l, bm_id: bmId }))).select("*");
        if (error) throw error;
        savedMo = (data ?? []) as BmLineMo[];
      }
      if (linesLogistica.length) {
        const { data, error } = await supabase.from("bm_lines_logistica").insert(linesLogistica.map((l) => ({ ...l, bm_id: bmId }))).select("*");
        if (error) throw error;
        savedLogistica = (data ?? []) as BmLineLogistica[];
      }
      if (linesMateriais.length) { const { error } = await supabase.from("bm_lines_materiais").insert(linesMateriais.map((l) => ({ ...l, bm_id: bmId }))); if (error) throw error; }

      const overridesToSave = Object.entries(diasOverrides).map(([key, ov]) => {
        const [colaborador_id, data] = key.split("::");
        return { bm_id: bmId, colaborador_id, data, evento: ov.evento, horas_extras: ov.horas_extras, adicional_noturno: ov.adicional_noturno, total_horas: ov.total_horas, observacao: ov.observacao };
      });
      if (overridesToSave.length) { const { error } = await supabase.from("bm_dias_overrides").insert(overridesToSave); if (error) throw error; }

      if (targetStatus === "pending_pm") {
        const { error } = await supabase.from("bm_status_history").insert({ bm_id: bmId, status: "pending_pm", changed_by_name: "Operador", notes: null });
        if (error) throw error;
      }
      return { bm: bmRow, savedMo, savedLogistica, targetStatus };
    },
    onSuccess: ({ bm, savedMo, savedLogistica, targetStatus }) => {
      qc.invalidateQueries({ queryKey: ["bm-historico"] });
      notify.success(targetStatus === "pending_pm" ? "BM enviado para aprovação do PM." : "Rascunho salvo.");
      setSavedBm(bm);
      setSavedLinesMo(savedMo);
      setSavedLinesLogistica(savedLogistica);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao salvar o BM."),
  });

  const podeAvancarStep0 = headerCompleto;
  const podeEnviarAprovacao = headerCompleto && linesMo.length > 0 && (!hasRateMissing || cienteRatesFaltando);

  if (savedBm) {
    return (
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <p className="text-sm font-medium">
            BM {savedBm.current_status === "pending_pm" ? "enviado para aprovação" : "salvo como rascunho"}.
          </p>
          <Button size="sm" variant="outline" onClick={resetWizard}>Gerar novo BM</Button>
        </div>
        <BmConsolidatedView bm={savedBm} linesMo={savedLinesMo} linesLogistica={savedLinesLogistica} />
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {["Cabeçalho", "Horas do Timesheet", "Mão de Obra", "Logística", "Resumo"].map((label, i) => (
          <span key={label} className={i === step ? "font-semibold text-foreground" : undefined}>
            {i > 0 && <span className="mx-1.5">→</span>}{label}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select
                value={cab.client}
                disabled={bmFlowLoading}
                onValueChange={(client) =>
                  setCab((current) => ({
                    ...current,
                    client,
                    vessel: "",
                    bsp: "",
                    poNumber: "",
                    poValue: null,
                    poBalanceBefore: null,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      bmFlowLoading
                        ? "Carregando clientes..."
                        : "Selecione"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {clientOptions.map((client) => (
                    <SelectItem key={client} value={client}>
                      {client}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {bmFlowError && (
                <p className="mt-1 text-[11px] text-destructive">
                  {bmFlowError instanceof Error
                    ? bmFlowError.message
                    : "Falha ao carregar clientes do Smartsheet."}
                </p>
              )}

              {!bmFlowLoading &&
                !bmFlowError &&
                clientOptions.length === 0 && (
                  <p className="mt-1 text-[11px] text-destructive">
                    Nenhum cliente foi retornado pelo Smartsheet.
                  </p>
                )}
            </div>

            <div>
              <Label className="text-xs">Embarcação</Label>
              <Select
                value={cab.vessel}
                disabled={!cab.client || bmFlowLoading}
                onValueChange={(vessel) =>
                  setCab((current) => ({
                    ...current,
                    vessel,
                    bsp: "",
                    poNumber: "",
                    poValue: null,
                    poBalanceBefore: null,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      cab.client
                        ? "Selecione"
                        : "Selecione o cliente primeiro"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {vesselOptions.map((vessel) => (
                    <SelectItem key={vessel} value={vessel}>
                      {vessel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">BSP</Label>
              <Select
                value={cab.bsp}
                disabled={!cab.client || !cab.vessel || bmFlowLoading}
                onValueChange={(bsp) =>
                  setCab((current) => ({
                    ...current,
                    bsp,
                    poNumber: "",
                    poValue: null,
                    poBalanceBefore: null,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      cab.vessel
                        ? "Selecione"
                        : "Selecione a embarcação primeiro"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {bspOptions.map((bsp) => (
                    <SelectItem key={bsp} value={bsp}>
                      {bsp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">PO</Label>
              <div className="flex gap-2">
                <Select
                  value={cab.poNumber}
                  disabled={
                    !cab.client ||
                    !cab.vessel ||
                    !cab.bsp ||
                    bmFlowLoading
                  }
                  onValueChange={(poNumber) =>
                    setCab((current) => ({
                      ...current,
                      poNumber,
                      poValue: null,
                      poBalanceBefore: null,
                    }))
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue
                      placeholder={
                        cab.bsp
                          ? "Selecione a PO"
                          : "Selecione o BSP primeiro"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {poOptions.map((poNumber) => (
                      <SelectItem key={poNumber} value={poNumber}>
                        {poNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground">
                POs de Faturamento filtradas por Cliente, Embarcação e BSP.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Valor Total da PO</Label>
              <Input readOnly className="bg-muted/40" value={cab.poValue != null ? fmtMoney(cab.poValue) : "—"} />
              {jobOrderPoTotalLoading && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Somando os valores da Job Order...
                </p>
              )}

              {jobOrderPoTotalError && (
                <p className="mt-1 text-[11px] text-destructive">
                  {jobOrderPoTotalError instanceof Error
                    ? jobOrderPoTotalError.message
                    : "Falha ao calcular o valor da PO."}
                </p>
              )}

              {!jobOrderPoTotalLoading &&
                !jobOrderPoTotalError &&
                jobOrderPoTotal && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Soma de {jobOrderPoTotal.occurrences} linha(s)
                    da coluna Valor_PO.
                  </p>
                )}
            </div>
            <div>
              <Label className="text-xs">
                Número(s) do BM
              </Label>

              {bmNovoManual ? (
                <div className="flex gap-2">
                  <Input
                    value={cab.numeroBm}
                    onChange={(event) =>
                      setCab({
                        ...cab,
                        numeroBm: event.target.value,
                      })
                    }
                    placeholder="Novo número de BM"
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBmNovoManual(false);
                      setSelectedBmNumbers([]);
                    }}
                  >
                    Lista
                  </Button>
                </div>
              ) : (
                <details className="relative">
                  <summary
                    aria-disabled={!cab.poNumber}
                    className={cn(
                      "flex h-10 cursor-pointer list-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
                      "[&::-webkit-details-marker]:hidden",
                      !cab.poNumber &&
                        "pointer-events-none opacity-50",
                    )}
                  >
                    <span className="truncate">
                      {selectedBmNumbers.length === 0
                        ? "Selecione uma ou mais BMs"
                        : selectedBmNumbers.length <= 2
                          ? selectedBmNumbers.join(", ")
                          : `${selectedBmNumbers.length} BMs selecionadas`}
                    </span>

                    <span
                      aria-hidden="true"
                      className="ml-2 text-muted-foreground"
                    >
                      ▾
                    </span>
                  </summary>

                  <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                    <button
                      type="button"
                      className="flex w-full items-center rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={(event) => {
                        setSelectedBmNumbers([]);
                        setBmNovoManual(true);

                        setCab((current) => ({
                          ...current,
                          numeroBm: "",
                        }));

                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Criar nova BM
                    </button>

                    <div className="my-1 border-t" />

                    {!cab.poNumber ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        Selecione primeiro a PO de Faturamento.
                      </p>
                    ) : bmsDaPo.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        Nenhuma BM encontrada para esta PO.
                      </p>
                    ) : (
                      bmsDaPo.map((bm) => {
                        const checked =
                          selectedBmKeys.has(
                            bmFlowKey(bm.bmNumber),
                          );

                        return (
                          <label
                            key={bm.rowId}
                            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                toggleBmSelection(
                                  bm.bmNumber,
                                  value === true,
                                )
                              }
                            />

                            <span className="min-w-0 flex-1 truncate">
                              {bm.bmNumber}
                            </span>

                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {bm.value != null
                                ? fmtMoney(bm.value)
                                : "Sem valor"}
                            </span>
                          </label>
                        );
                      })
                    )}

                    {selectedBmNumbers.length > 0 && (
                      <>
                        <div className="my-1 border-t" />

                        <button
                          type="button"
                          className="w-full rounded-sm px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
                          onClick={() =>
                            setSelectedBmNumbers([])
                          }
                        >
                          Limpar seleção
                        </button>
                      </>
                    )}
                  </div>
                </details>
              )}

              <p className="mt-1 text-[11px] text-muted-foreground">
                {cab.poNumber
                  ? `${bmsDaPo.length} BM(s) encontrada(s) para a PO selecionada.`
                  : "Selecione a PO de Faturamento para carregar as BMs."}
              </p>

              {proximoBm?.lastBmNumber && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Último BM: {proximoBm.lastBmNumber}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs">
                Valor do BM
              </Label>

              <Input
                readOnly
                className="bg-muted/40"
                value={
                  bmsSelecionados.length > 0
                    ? fmtMoney(valorTotalBms)
                    : "—"
                }
              />

              <p className="mt-1 text-[11px] text-muted-foreground">
                {bmsSelecionados.length > 0
                  ? `Soma de ${bmsSelecionados.length} BM(s) selecionada(s) na coluna VALOR BM.`
                  : "Selecione uma ou mais BMs para calcular o total."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Período — De</Label><Input type="date" value={cab.periodStart} onChange={(e) => setCab({ ...cab, periodStart: e.target.value })} /></div>
            <div><Label className="text-xs">Período — Até</Label><Input type="date" value={cab.periodEnd} onChange={(e) => setCab({ ...cab, periodEnd: e.target.value })} /></div>
          </div>

          {cab.poValue != null && (
            <p className="text-xs text-muted-foreground">
              PO Value: <strong>{fmtMoney(cab.poValue)}</strong>
              {cab.poBalanceBefore != null && <> · Saldo antes deste BM: <strong>{fmtMoney(cab.poBalanceBefore)}</strong></>}
            </p>
          )}

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">Medições aplicadas ao cabeçalho</span>
              <span className="text-xs text-muted-foreground">Total: <strong>{fmtMoney(totalMedicoes)}</strong></span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(Object.keys(MEDICOES_LABEL) as MedicaoKey[]).map((k) => (
                <div key={k}>
                  <Label className="text-xs">{MEDICOES_LABEL[k]}</Label>
                  <Input readOnly className="bg-muted/40" value={fmtMoney(medicoes[k])} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {numeroBmAtual
                ? `Totais consolidados nas abas de medição e aplicados ao BM ${numeroBmAtual}.`
                : "Informe o Número do BM para carregar as medições já aplicadas a ele."}

            </p>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">Logística Mob/Desmob aplicada ao BSP</span>
              <span className="text-xs text-muted-foreground">Total: <strong>{fmtMoney(totalMobDesmob)}</strong></span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <Label className="text-xs">Transporte</Label>
                <Input readOnly className="bg-muted/40" value={fmtMoney(mobDesmob.transporte)} />
              </div>
              <div>
                <Label className="text-xs">Hotel</Label>
                <Input readOnly className="bg-muted/40" value={fmtMoney(mobDesmob.hotel)} />
              </div>
              <div>
                <Label className="text-xs">Outros</Label>
                <Input readOnly className="bg-muted/40" value={fmtMoney(mobDesmob.outros)} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {cab.bsp
                ? `Custos importados e aplicados na aba Logística Mob/Desmob para o BSP ${cab.bsp}.`
                : "Selecione o BSP para carregar os custos de transporte e hotel já aplicados."}
            </p>
          </div>


        </div>
      )}

      {step === 1 && (
        <HorasTimesheetStep
          diasBase={diasBase}
          overrides={diasOverrides}
          onSalvarOverride={salvarDiaOverride}
          colaboradoresJaMedidos={colaboradoresJaMedidos}
          carregando={carregandoDias}
        />
      )}

      {step === 2 && (
        <div className="space-y-2">
          {carregandoMo && <p className="text-xs text-muted-foreground">Calculando mão de obra…</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead><TableHead>Função</TableHead>
                <TableHead>Embarque</TableHead><TableHead>Dobra</TableHead><TableHead>Hotel</TableHead>
                <TableHead>HE (h)</TableHead><TableHead>AN (h)</TableHead><TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linesMo.map((l, i) => (
                <TableRow key={i} className={l.rate_missing ? "bg-warning/10" : undefined}>
                  <TableCell className="font-medium">
                    {l.rate_missing && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warning-foreground" />}
                    {l.colaborador_nome}
                  </TableCell>
                  <TableCell>{l.funcao}</TableCell>
                  <TableCell>
                    <Input type="number" className="h-7 w-16 text-xs" value={l.dias_embarque}
                      onChange={(e) => setLinesMo(linesMo.map((x, xi) => xi === i ? { ...x, dias_embarque: Number(e.target.value) || 0 } : x))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" className="h-7 w-16 text-xs" value={l.dias_dobra}
                      onChange={(e) => setLinesMo(linesMo.map((x, xi) => xi === i ? { ...x, dias_dobra: Number(e.target.value) || 0 } : x))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" className="h-7 w-16 text-xs" value={l.dias_hotel}
                      onChange={(e) => setLinesMo(linesMo.map((x, xi) => xi === i ? { ...x, dias_hotel: Number(e.target.value) || 0 } : x))} />
                  </TableCell>
                  {l.rate_hora_extra != null && (
                    <TableCell>
                      <Input type="number" className="h-7 w-16 text-xs" value={l.horas_extras}
                        onChange={(e) => setLinesMo(linesMo.map((x, xi) => xi === i ? { ...x, horas_extras: Number(e.target.value) || 0 } : x))} />
                    </TableCell>
                  )}
                  {l.rate_hora_extra == null && <TableCell className="text-muted-foreground">—</TableCell>}
                  {l.rate_adicional_noturno != null && (
                    <TableCell>
                      <Input type="number" className="h-7 w-16 text-xs" value={l.horas_adicional_noturno}
                        onChange={(e) => setLinesMo(linesMo.map((x, xi) => xi === i ? { ...x, horas_adicional_noturno: Number(e.target.value) || 0 } : x))} />
                    </TableCell>
                  )}
                  {l.rate_adicional_noturno == null && <TableCell className="text-muted-foreground">—</TableCell>}
                  <TableCell className="font-medium">{fmtMoney(l.valor_total)}</TableCell>
                </TableRow>
              ))}
              {linesMo.length === 0 && !carregandoMo && (
                <EmptyStateRow colSpan={8} icon={Coins} title="Nenhum colaborador com timesheet lançado nesse período/embarcação" />
              )}
            </TableBody>
          </Table>
          {hasRateMissing && (
            <label className="flex items-center gap-2 text-xs text-warning-foreground">
              <input type="checkbox" checked={cienteRatesFaltando} onChange={(e) => setCienteRatesFaltando(e.target.checked)} />
              Estou ciente de que há colaborador(es) sem rate cadastrado em /admin/rates — os valores desses ficam zerados até corrigir.
            </label>
          )}
        </div>
      )}

      {step === 3 && <LogisticaStep lines={linesLogistica} setLines={setLinesLogistica} />}

      {step === 4 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <div className="flex justify-between"><span>Mão de Obra</span><span className="font-medium">{fmtMoney(totals.totalMo)}</span></div>
              <div className="flex justify-between"><span>Logística{markupEnabled ? ` (+${markupPct}%)` : ""}</span><span className="font-medium">{fmtMoney(totals.totalLogisticaComMarkup)}</span></div>
              {(Object.keys(MEDICOES_LABEL) as MedicaoKey[]).filter((k) => medicoes[k] > 0).map((k) => (
                <div key={k} className="flex justify-between">
                  <span>{MEDICOES_LABEL[k]}</span><span className="font-medium">{fmtMoney(medicoes[k])}</span>
                </div>
              ))}
              {mobDesmob.transporte > 0 && (
                <div className="flex justify-between"><span>Transporte (Mob/Desmob)</span><span className="font-medium">{fmtMoney(mobDesmob.transporte)}</span></div>
              )}
              {mobDesmob.hotel > 0 && (
                <div className="flex justify-between"><span>Hotel (Mob/Desmob)</span><span className="font-medium">{fmtMoney(mobDesmob.hotel)}</span></div>
              )}
              {mobDesmob.outros > 0 && (
                <div className="flex justify-between"><span>Outros (Mob/Desmob)</span><span className="font-medium">{fmtMoney(mobDesmob.outros)}</span></div>
              )}
              {posProcessamento > 0 && (
                <div className="flex justify-between"><span>Pós Processamento</span><span className="font-medium">{fmtMoney(posProcessamento)}</span></div>
              )}
              {teamMobDesmob > 0 && (
                <div className="flex justify-between"><span>Team Mob/Desmob</span><span className="font-medium">{fmtMoney(teamMobDesmob)}</span></div>
              )}

              <div className="flex justify-between border-t pt-1 text-base font-semibold"><span>Total geral</span><span>{fmtMoney(totalGeralComMedicoes)}</span></div>

            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={markupEnabled} onChange={(e) => setMarkupEnabled(e.target.checked)} />
                Aplicar markup de logística
              </label>
              {markupEnabled && (
                <div className="w-24">
                  <Label className="text-xs">% markup</Label>
                  <Input type="number" step="0.01" value={markupPct} onChange={(e) => setMarkupPct(Number(e.target.value) || 0)} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Desative apenas se o contrato define reembolso direto dos custos logísticos.
              </p>
              {cab.poValue != null && (
                <div className="rounded border p-2 text-xs">
                  <div className="flex justify-between"><span>PO Value</span><span>{fmtMoney(cab.poValue)}</span></div>
                  <div className="flex justify-between"><span>Saldo antes deste BM</span><span>{fmtMoney(cab.poBalanceBefore ?? 0)}</span></div>
                  <div className={`flex justify-between font-medium ${poBalanceDepois != null && poBalanceDepois < 0 ? "text-destructive" : ""}`}>
                    <span>Saldo após este BM</span><span>{poBalanceDepois != null ? fmtMoney(poBalanceDepois) : "—"}</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Pós Processamento</Label>
                  <Input type="number" step="0.01" value={posProcessamento}
                    onChange={(e) => setPosProcessamento(Number(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">Team Mob/Desmob</Label>
                  <Input type="number" step="0.01" value={teamMobDesmob}
                    onChange={(e) => setTeamMobDesmob(Number(e.target.value) || 0)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Observações (não sai no PDF)</Label>
                <Textarea rows={2} className="text-xs" value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => generateBmExport(bmExportData, linesMo, linesLogistica, linesMateriais)}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />Gerar Excel (padrão Step)
            </Button>
            {isBwEnergy(cab.client) && (
              <Button variant="outline" onClick={() => generateBmExportBwEnergy(bmExportData, linesMo, linesLogistica, linesMateriais)}>
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />Gerar Excel (BW Energy)
              </Button>
            )}
            <Button variant="outline" onClick={() => salvarBm.mutate("draft")} loading={salvarBm.isPending && salvarBm.variables === "draft"}>
              Salvar Rascunho
            </Button>
            <Button onClick={() => salvarBm.mutate("pending_pm")} loading={salvarBm.isPending && salvarBm.variables === "pending_pm"} disabled={!podeEnviarAprovacao}>
              Enviar para Aprovação do PM
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between border-t pt-3">
        <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Voltar
        </Button>
        <div className="flex gap-2">
          {step === 0 && (
            <Button
              size="sm" variant="outline"
              disabled={!podeAvancarStep0 || carregandoMo || carregandoLogistica}
              loading={salvarBm.isPending && salvarBm.variables === "draft"}
              onClick={() => salvarBm.mutate("draft")}
            >
              Gerar BM
            </Button>
          )}
          {step < 4 && (
            <Button size="sm" disabled={step === 0 && !podeAvancarStep0} onClick={() => setStep(step + 1)}>
              Próximo<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Step 1: Horas do Timesheet ─────────────────────────────────────────────
// Compilado, em forma de planilha, dos dias reais puxados do timesheet pro vessel/período/BSP
// escolhidos no Cabeçalho. Cada campo é editável direto na célula — a correção fica só nesse
// BM (grava em bm_dias_overrides ao salvar), nunca em timesheet_dias. Editar qualquer campo
// sem preencher Observação ainda salva a correção, mas o campo fica com borda de aviso —
// a ideia é sempre justificar por que a medição divergiu do físico.
function HorasTimesheetStep({ diasBase, overrides, onSalvarOverride, colaboradoresJaMedidos, carregando }: {
  diasBase: TimesheetDiaComColaborador[];
  overrides: Record<string, DiaOverrideEdit>;
  onSalvarOverride: (colaboradorId: string, data: string, edit: DiaOverrideEdit | null) => void;
  colaboradoresJaMedidos: Set<string>;
  carregando: boolean;
}) {
  const efetivo = (d: TimesheetDiaComColaborador): DiaOverrideEdit => {
    const ov = overrides[chaveDiaOverride(d.colaborador_id, d.data)];
    return ov ?? { evento: d.evento, horas_extras: d.horas_extras, adicional_noturno: d.adicional_noturno, total_horas: d.total_horas, observacao: "" };
  };

  const atualizarCampo = (d: TimesheetDiaComColaborador, patch: Partial<DiaOverrideEdit>) => {
    const atual = efetivo(d);
    const novo = { ...atual, ...patch };
    const igualOriginal = novo.evento === d.evento && novo.horas_extras === d.horas_extras
      && novo.adicional_noturno === d.adicional_noturno && novo.total_horas === d.total_horas && !novo.observacao.trim();
    onSalvarOverride(d.colaborador_id, d.data, igualOriginal ? null : novo);
  };

  return (
    <div className="space-y-2">
      {carregando && <p className="text-xs text-muted-foreground">Carregando horas do timesheet…</p>}
      <p className="text-xs text-muted-foreground">
        Compilado direto do Timesheet Offshore pro período/embarcação escolhidos. Dá pra corrigir um dia específico
        aqui sem alterar o timesheet real do colaborador — só descreva o motivo em Observação.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Evento</TableHead>
              <TableHead>Horas Extras</TableHead>
              <TableHead>Adic. Noturno</TableHead>
              <TableHead>Total</TableHead>
              <TableHead className="min-w-[220px]">Observação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diasBase.map((d) => {
              const ed = efetivo(d);
              const alterado = !!overrides[chaveDiaOverride(d.colaborador_id, d.data)];
              const jaMedido = colaboradoresJaMedidos.has(d.colaborador_id);
              return (
                <TableRow key={`${d.colaborador_id}-${d.data}`} className={alterado ? "bg-warning/10" : undefined}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {!jaMedido && (
                        <span title="Ainda não medido em nenhum BM desse período/embarcação">
                          <CircleAlert className="h-3.5 w-3.5 shrink-0 animate-pulse text-destructive" />
                        </span>
                      )}
                      {d.colaborador_nome}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmt(d.data)}</TableCell>
                  <TableCell>
                    <Select value={ed.evento ?? "Nenhum"} onValueChange={(v) => atualizarCampo(d, { evento: v === "Nenhum" ? null : v })}>
                      <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{EVENTO_OPCOES_BM.map((ev) => <SelectItem key={ev} value={ev} className="text-xs">{ev}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" className="h-7 w-20 text-xs" value={ed.horas_extras ?? ""}
                      onChange={(e) => atualizarCampo(d, { horas_extras: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox checked={ed.adicional_noturno} onCheckedChange={(v) => atualizarCampo(d, { adicional_noturno: !!v })} />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" className="h-7 w-20 text-xs" value={ed.total_horas ?? ""}
                      onChange={(e) => atualizarCampo(d, { total_horas: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className={cn("h-7 text-xs", alterado && !ed.observacao.trim() && "border-destructive")}
                      placeholder={alterado ? "Justifique a alteração..." : "—"}
                      value={ed.observacao}
                      onChange={(e) => atualizarCampo(d, { observacao: e.target.value })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {diasBase.length === 0 && !carregando && (
              <EmptyStateRow colSpan={7} icon={Coins} title="Nenhum dia de timesheet lançado nesse período/embarcação" />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Step 3: Logística ───────────────────────────────────────────────────────

function LogisticaStep({ lines, setLines }: { lines: Omit<BmLineLogistica, "id" | "bm_id">[]; setLines: (l: Omit<BmLineLogistica, "id" | "bm_id">[]) => void }) {
  const addManual = () => setLines([...lines, { cost_log_id: null, cost_type: "demandas_diversas", vendor_name: null, collaborator_name: null, amount: 0, period_start: null, period_end: null, notes: null, is_manual: true }]);
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={addManual}><Plus className="mr-1.5 h-3.5 w-3.5" />Linha manual</Button></div>
      <Table>
        <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Fornecedor</TableHead><TableHead>Valor</TableHead><TableHead>Obs.</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
        <TableBody>
          {lines.map((l, i) => (
            <TableRow key={i}>
              <TableCell>{l.cost_type}{l.is_manual && <span className="ml-1 text-[10px] text-muted-foreground">(manual)</span>}</TableCell>
              <TableCell>{l.vendor_name ?? "—"}</TableCell>
              <TableCell>
                <Input type="number" step="0.01" className="h-7 w-28 text-xs" value={l.amount}
                  onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, amount: Number(e.target.value) || 0 } : x))} />
              </TableCell>
              <TableCell><Input className="h-7 text-xs" value={l.notes ?? ""} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, notes: e.target.value } : x))} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, xi) => xi !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {lines.length === 0 && <EmptyStateRow colSpan={5} icon={Coins} title="Nenhum custo de logística encontrado nesse período/projeto" />}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Step 4: Habitat/Rentals/Consumíveis ────────────────────────────────────

function MateriaisStep({ lines, setLines, clientAtual, poNumber }: {
  lines: Omit<BmLineMateriais, "id" | "bm_id">[]; setLines: (l: Omit<BmLineMateriais, "id" | "bm_id">[]) => void;
  clientAtual: string; poNumber: string;
}) {
  const add = (categoria: MaterialCategoria) => setLines([...lines, { categoria, descricao: "", tag: null, bsp: null, period_start: null, period_end: null, valor_diario: null, qtd: 1, valor_total: 0 }]);
  const isPrioSemPo = clientAtual.trim().toUpperCase() === "PRIO" && !poNumber.trim();

  const secoes: { categoria: MaterialCategoria; titulo: string }[] = [
    { categoria: "habitat", titulo: "Habitat" },
    { categoria: "rental", titulo: "Rentals" },
    { categoria: "consumable", titulo: "Consumíveis" },
  ];

  return (
    <div className="space-y-4">
      {secoes.map(({ categoria, titulo }) => (
        <div key={categoria} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{titulo}</h3>
            <Button size="sm" variant="outline" onClick={() => add(categoria)}><Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead><TableHead>Tag</TableHead>
                {categoria === "rental" && isPrioSemPo && <TableHead>BSP</TableHead>}
                <TableHead>Valor diário</TableHead><TableHead>Qtd</TableHead><TableHead>Total</TableHead><TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => l.categoria === categoria && (
                <TableRow key={i}>
                  <TableCell><Input className="h-7 text-xs" value={l.descricao} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, descricao: e.target.value } : x))} /></TableCell>
                  <TableCell><Input className="h-7 w-24 text-xs" value={l.tag ?? ""} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, tag: e.target.value } : x))} /></TableCell>
                  {categoria === "rental" && isPrioSemPo && (
                    <TableCell><Input className="h-7 w-24 text-xs" value={l.bsp ?? ""} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, bsp: e.target.value } : x))} /></TableCell>
                  )}
                  <TableCell>
                    <Input type="number" step="0.01" className="h-7 w-24 text-xs" value={l.valor_diario ?? ""}
                      onChange={(e) => {
                        const valorDiario = e.target.value === "" ? null : Number(e.target.value);
                        setLines(lines.map((x, xi) => xi === i ? { ...x, valor_diario: valorDiario, valor_total: round2((valorDiario ?? 0) * x.qtd) } : x));
                      }} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" className="h-7 w-20 text-xs" value={l.qtd}
                      onChange={(e) => {
                        const qtd = Number(e.target.value) || 0;
                        setLines(lines.map((x, xi) => xi === i ? { ...x, qtd, valor_total: round2((x.valor_diario ?? 0) * qtd) } : x));
                      }} />
                  </TableCell>
                  <TableCell className="font-medium">{fmtMoney(l.valor_total)}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, xi) => xi !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {lines.filter((l) => l.categoria === categoria).length === 0 && (
                <EmptyStateRow colSpan={isPrioSemPo && categoria === "rental" ? 7 : 6} icon={Coins} title="Nenhum item lançado" />
              )}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

// ─── Histórico de BMs ────────────────────────────────────────────────────────

type BmListSortColumn = "numero" | "cliente" | "embarcacao" | "periodo" | "total" | "status";

// draft -> pending_pm -> approved/rejected -> sent_client (ver STATUS_LABELS em src/lib/bm.ts)
// — ordena pela ordem lógica do fluxo, não alfabeticamente.
const BM_STATUS_ORDER: Record<BmStatus, number> = { draft: 0, pending_pm: 1, approved: 2, rejected: 3, sent_client: 4 };

function HistoricoBmsTab({ onReopen }: { onReopen: (bm: Bm) => void }) {
  const qc = useQueryClient();
  const [filterClient, setFilterClient] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewingBm, setViewingBm] = useState<Bm | null>(null);
  const { sortColumn, sortDirection, toggleSort } = useTableSort<BmListSortColumn>();

  const { data: viewingLinhas } = useQuery({
    queryKey: ["bm-linhas", viewingBm?.id],
    enabled: !!viewingBm,
    queryFn: async () => {
      const [mo, logistica] = await Promise.all([
        supabase.from("bm_lines_mo").select("*").eq("bm_id", viewingBm!.id),
        supabase.from("bm_lines_logistica").select("*").eq("bm_id", viewingBm!.id),
      ]);
      if (mo.error) throw mo.error;
      if (logistica.error) throw logistica.error;
      return { mo: (mo.data ?? []) as BmLineMo[], logistica: (logistica.data ?? []) as BmLineLogistica[] };
    },
  });

  const { data: bms = [], isLoading } = useQuery({
    queryKey: ["bm-historico"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bms").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Bm[];
    },
  });

  // Depois de aprovado, registra o BM emitido no Smartsheet e avança pra "Enviado ao
  // cliente" — só acontece uma vez (bms.smartsheet_synced_at fica marcado).
  const atualizarSmartsheet = useMutation({
    mutationFn: async (bm: Bm) => {
      await recordIssuedBm({
        data: { poNumber: bm.po_number ?? "", bmNumber: bm.numero_bm ?? "", client: bm.client_name, vessel: bm.vessel, value: bm.total_geral },
      });
      const { error } = await supabase.from("bms").update({ current_status: "sent_client", smartsheet_synced_at: new Date().toISOString() }).eq("id", bm.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-historico"] });
      notify.success("Smartsheet atualizado e BM marcado como enviado ao cliente.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao atualizar o Smartsheet."),
  });

  // bm_lines_mo/logistica/materiais e bm_status_history têm ON DELETE CASCADE (ver migration
  // 20260718000002_bm_core.sql) — apagar o bm já apaga as linhas junto.
  const deleteBm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-historico"] });
      notify.success("BM excluído.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao excluir o BM."),
  });

  // "Já foi medido": flag persistida em bms.ja_medido; marcar/desmarcar alterna entre
  // "Já medido" e "Pendente de medição" e fica salvo no BM.
  const toggleJaMedido = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.from("bms").update({ ja_medido: value }).eq("id", id);
      if (error) throw error;
      return value;
    },
    onSuccess: (value) => {
      qc.invalidateQueries({ queryKey: ["bm-historico"] });
      notify.success(value ? "BM marcado como já medido." : "BM voltou para pendente de medição.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao atualizar a medição do BM."),
  });


  const clientesNaLista = useMemo(() => Array.from(new Set(bms.map((b) => b.client_name))).sort(), [bms]);
  const filtered = bms
    .filter((b) => (filterClient === "all" || b.client_name === filterClient) && (filterStatus === "all" || b.current_status === filterStatus))
    .sort((a, b) => {
      if (!sortColumn) return 0;
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortColumn) {
        case "numero":
          return dir * (a.numero_bm ?? "").localeCompare(b.numero_bm ?? "");
        case "cliente":
          return dir * (a.client_name ?? "").localeCompare(b.client_name ?? "");
        case "embarcacao":
          return dir * (a.vessel ?? "").localeCompare(b.vessel ?? "");
        case "periodo":
          return dir * (a.period_start ?? "").localeCompare(b.period_start ?? "");
        case "total":
          return dir * (a.total_geral - b.total_geral);
        case "status":
          return dir * (BM_STATUS_ORDER[a.current_status] - BM_STATUS_ORDER[b.current_status]);
        default:
          return 0;
      }
    });

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <div className="w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Cliente</Label>
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all" className="text-xs">Todos</SelectItem>{clientesNaLista.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, label]) => <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Nº BM" column="numero" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Cliente" column="cliente" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Embarcação" column="embarcacao" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Período" column="periodo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-32">Medição</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.numero_bm ?? "—"}</TableCell>
                <TableCell className="font-medium">{b.client_name}</TableCell>
                <TableCell>{b.vessel}</TableCell>
                <TableCell>{fmt(b.period_start)} – {fmt(b.period_end)}</TableCell>
                <TableCell>{fmtMoney(b.total_geral)}</TableCell>
                <TableCell><StatusBadge tone={STATUS_TONE[b.current_status]}>{STATUS_LABELS[b.current_status]}</StatusBadge></TableCell>
                <TableCell>
                  {b.ja_medido ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
                      <CheckCircle2 className="h-3 w-3" /> Medido
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>


                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => setViewingBm(b)}>Ver</Button>
                  {(b.current_status === "draft" || b.current_status === "rejected") && (
                    <Button size="sm" variant="ghost" onClick={() => onReopen(b)}>Reabrir</Button>
                  )}
                  {b.current_status === "approved" && (
                    <Button size="sm" variant="ghost" onClick={() => atualizarSmartsheet.mutate(b)} loading={atualizarSmartsheet.isPending && atualizarSmartsheet.variables?.id === b.id}>
                      Atualizar Smartsheet
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Excluir">
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir este BM?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {b.client_name} — {b.vessel} ({fmt(b.period_start)} – {fmt(b.period_end)}). Essa ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteBm.mutate(b.id)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filtered.length === 0 && <EmptyStateRow colSpan={7} icon={FileSpreadsheet} title="Nenhum BM gerado ainda" />}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!viewingBm} onOpenChange={(o) => { if (!o) setViewingBm(null); }}>
        {/* print:hidden aqui — o Dialog do Radix (fixed + Portal) briga com o CSS de impressão
            (posicionamento imprevisível, conteúdo cortado). A cópia de baixo, fora do Dialog e
            sempre no fluxo normal da página, é a que efetivamente aparece no PDF (mesmo padrão
            já testado e funcionando na visualização inline do wizard). */}
        <DialogContent className="print:hidden max-w-[95vw] max-h-[90vh] overflow-y-auto">
          {viewingBm && (
            <>
              {/* Marcação de medição vive dentro do BM; a lista só exibe a flag "Medido". */}
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm print:hidden">
                <Checkbox
                  checked={!!(bms.find((x) => x.id === viewingBm.id)?.ja_medido ?? viewingBm.ja_medido)}
                  disabled={toggleJaMedido.isPending}
                  onCheckedChange={(v) => toggleJaMedido.mutate({ id: viewingBm.id, value: v === true })}
                />
                <span>Já foi medido</span>
              </label>
              <BmConsolidatedView
                bm={viewingBm}
                linesMo={viewingLinhas?.mo ?? []}
                linesLogistica={viewingLinhas?.logistica ?? []}
              />
            </>
          )}

        </DialogContent>
      </Dialog>
      {viewingBm && (
        <div className="hidden print:block">
          <BmConsolidatedView
            bm={viewingBm}
            linesMo={viewingLinhas?.mo ?? []}
            linesLogistica={viewingLinhas?.logistica ?? []}
          />
        </div>
      )}
    </div>
  );
}
