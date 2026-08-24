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
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyStateRow } from "@/components/EmptyState";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { AlertTriangle, ArrowLeft, FileSpreadsheet, Plus, Trash2, Coins, CircleAlert, CheckCircle2, ChevronDown, ChevronRight, Printer } from "lucide-react";
import { EVENTOS_DIA } from "@/lib/timesheetOffshore";
import {
  type Bm, type BmStatus, type BmLineMo, type BmLineLogistica, type BmLineMateriais, type BmDiaOverride, type MaterialCategoria,
  STATUS_LABELS, STATUS_TONE, computeBmTotals, isBwEnergy,
} from "@/lib/bm";
import { aggregateMaoDeObra, type Rate, type TimesheetDiaComColaborador } from "@/lib/bmRateEngine";
import { BmTimesheetCoverView } from "@/components/bm/BmConsolidatedView";
import { BrandLogo } from "@/components/BrandLogo";
import { MobDesmobTab } from "@/components/bm/MobDesmobTab";
import { MedicaoTab, type MedicaoRow } from "@/components/bm/MedicaoTab";

import { TimesheetsTab } from "@/components/bm/TimesheetsTab";
import { generateBmExport, generateBmExportBwEnergy, type BmExportData } from "@/lib/bmExcel";
import { getBmHistoryForPo, recordIssuedBm, listSmartsheetBms } from "@/lib/api/smartsheetBm.functions";
import { listBmFlowRows } from "@/lib/api/bmFlow.functions";
import { getJobOrderPoTotal } from "@/lib/api/jobOrderPoTotal.functions";
import {
  normalizeBmBspKey,
  resolveBmRateClientNames,
  selectBmRateGroup,
} from "@/lib/bmUnitResolver";
import { selectAllPagesSequential, selectInChunks } from "@/lib/supabasePaginate";
import { mergeBmTimesheetSource } from "@/lib/bmTimesheetSync";

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
  // Controlados (em vez de defaultValue) só pra "Reabrir" no Histórico conseguir pular direto
  // pra sub-aba "Gerar BM" dentro de Mão de Obra Offshore — ver handleReopen abaixo.
  const [activeTab, setActiveTab] = useState("timesheets");
  const [moSubTab, setMoSubTab] = useState("timesheets-lancamentos");
  // BSP/Nº do BM que o assistente "Gerar BM" está montando agora — enquanto existir, a aba
  // Logística Mob/Desmob aplica direto nesse BM (sem pedir pra escolher um BM numa lista).
  const [gerandoCtx, setGerandoCtx] = useState<{ bsp: string; bmNumber: string } | null>(null);

  const handleReopen = (bm: Bm) => {
    setReopenBm(bm);
    setActiveTab("timesheets");
    setMoSubTab("timesheets-gerar");
  };
  // Mesma queryKey usada pelo Histórico de BMs e pela cascata por unidade — carrega junto
  // com a página (compartilha o cache, não dispara uma segunda consulta quando o usuário
  // abre a aba Histórico) e serve de sinal de "o módulo carregou" pro skeleton abaixo.
  const { isLoading: carregandoModulo } = useQuery({
    queryKey: ["bm-historico"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bms").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Bm[];
    },
  });

  if (carregandoModulo) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-32" />)}
        </div>
        <Card className="p-4 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Boletim de Medição</h1>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="timesheets">Mão de Obra Offshore</TabsTrigger>
          <TabsTrigger value="habitat">Habitat</TabsTrigger>
          <TabsTrigger value="locacao">Locação</TabsTrigger>
          <TabsTrigger value="consumiveis">Consumíveis</TabsTrigger>
          <TabsTrigger value="mob-materiais">Mob/Desmob de Materiais</TabsTrigger>
          <TabsTrigger value="historico">Histórico de BMs</TabsTrigger>
        </TabsList>
        <TabsContent value="timesheets" className="mt-4">
          <Tabs value={moSubTab} onValueChange={setMoSubTab}>
            <TabsList>
              <TabsTrigger value="timesheets-lancamentos">Timesheets</TabsTrigger>
              <TabsTrigger value="timesheets-mob-desmob">Logística Mob/Desmob</TabsTrigger>
              <TabsTrigger value="timesheets-gerar">Gerar BM</TabsTrigger>
            </TabsList>
            <TabsContent value="timesheets-lancamentos" className="mt-4">
              <TimesheetsTab />
            </TabsContent>
            <TabsContent value="timesheets-mob-desmob" className="mt-4">
              <MobDesmobTab bmEmGeracao={gerandoCtx} onAplicadoNoBmEmGeracao={() => setMoSubTab("timesheets-gerar")} />
            </TabsContent>
            {/* forceMount: o assistente guarda cabeçalho/horas só em memória — ao pular pra aba
                Logística Mob/Desmob e voltar, o progresso continua intacto. */}
            <TabsContent value="timesheets-gerar" className="mt-4" forceMount hidden={moSubTab !== "timesheets-gerar"}>
              <GerarBmWizard
                reopenBm={reopenBm}
                onConsumedReopen={() => setReopenBm(null)}
                onContextChange={setGerandoCtx}
                onIrParaLogistica={() => setMoSubTab("timesheets-mob-desmob")}
              />
            </TabsContent>

          </Tabs>
        </TabsContent>
        <TabsContent value="habitat" className="mt-4">
          <Tabs defaultValue="habitat-lancamentos">
            <TabsList>
              <TabsTrigger value="habitat-lancamentos">Lançamentos</TabsTrigger>
              <TabsTrigger value="habitat-gerar">Gerar BM</TabsTrigger>
            </TabsList>
            <TabsContent value="habitat-lancamentos" className="mt-4">
              <MedicaoTab tipo="habitat" titulo="Lançar medição de Habitat" smartsheetColumn="Medição Habitat"
                bmColumn="total_habitat"
                descricaoLabel="Habitat / Módulo" descricaoPlaceholder="Ex: Habitat 4 pax - Convés principal" />
            </TabsContent>
            <TabsContent value="habitat-gerar" className="mt-4">
              <MaterialBmWizard tipo="habitat" />
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="locacao" className="mt-4">
          <Tabs defaultValue="locacao-lancamentos">
            <TabsList>
              <TabsTrigger value="locacao-lancamentos">Lançamentos</TabsTrigger>
              <TabsTrigger value="locacao-gerar">Gerar BM</TabsTrigger>
            </TabsList>
            <TabsContent value="locacao-lancamentos" className="mt-4">
              <MedicaoTab tipo="locacao" titulo="Lançar medição de Locação" smartsheetColumn="Medição Locação"
                bmColumn="total_locacao"
                descricaoLabel="Equipamento locado" descricaoPlaceholder="Ex: Compressor 185 PCM" />
            </TabsContent>
            <TabsContent value="locacao-gerar" className="mt-4">
              <MaterialBmWizard tipo="locacao" />
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="consumiveis" className="mt-4">
          <Tabs defaultValue="consumiveis-lancamentos">
            <TabsList>
              <TabsTrigger value="consumiveis-lancamentos">Lançamentos</TabsTrigger>
              <TabsTrigger value="consumiveis-gerar">Gerar BM</TabsTrigger>
            </TabsList>
            <TabsContent value="consumiveis-lancamentos" className="mt-4">
              <MedicaoTab tipo="consumiveis" titulo="Lançar medição de Consumíveis" smartsheetColumn="Medição Consumíveis"
                bmColumn="total_consumiveis"
                descricaoLabel="Consumível" descricaoPlaceholder="Ex: Eletrodo E7018 3,25mm" />
            </TabsContent>
            <TabsContent value="consumiveis-gerar" className="mt-4">
              <MaterialBmWizard tipo="consumiveis" />
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="mob-materiais" className="mt-4">
          <Tabs defaultValue="mob-materiais-lancamentos">
            <TabsList>
              <TabsTrigger value="mob-materiais-lancamentos">Lançamentos</TabsTrigger>
              <TabsTrigger value="mob-materiais-gerar">Gerar BM</TabsTrigger>
            </TabsList>
            <TabsContent value="mob-materiais-lancamentos" className="mt-4">
              <MedicaoTab tipo="mob_desmob_materiais" titulo="Lançar medição de Mob/Desmob de Materiais"
                smartsheetColumn="Medição Mob/Desmob Materiais"
                bmColumn="total_mob_desmob_materiais"
                descricaoLabel="Material" descricaoPlaceholder="Ex: Container 20' - Macaé → Base" />
            </TabsContent>
            <TabsContent value="mob-materiais-gerar" className="mt-4">
              <MaterialBmWizard tipo="mob_desmob_materiais" />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <HistoricoBmsTab onReopen={handleReopen} />
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

// "mao_de_obra" segue o assistente de 5 passos de sempre; os outros 4 tipos são medidos
// separadamente — cada um vira o próprio BM, puxando os lançamentos já pendentes na aba
// correspondente (ver MaterialBmWizard) em vez de reaproveitar o cálculo de Mão de Obra.
type TipoBm = "mao_de_obra" | MedicaoKey;

const TIPO_BM_LABEL: Record<TipoBm, string> = {
  mao_de_obra: "Mão de Obra Offshore",
  habitat: "Habitat",
  locacao: "Locação",
  consumiveis: "Consumíveis",
  mob_desmob_materiais: "Mob/Desmob de Materiais",
};

// bm.client_name de um BM gerado pelo MaterialBmWizard é sempre um desses 4 rótulos (nunca um
// cliente real) — dá pra usar como discriminador seguro pra saber, num BM já salvo, se a folha
// de rosto é de Mão de Obra (BmTimesheetCoverView) ou de material (MaterialBmCoverView).
const MATERIAL_BM_CLIENT_NAMES = new Set(
  (Object.keys(TIPO_BM_LABEL) as TipoBm[]).filter((t) => t !== "mao_de_obra").map((t) => TIPO_BM_LABEL[t]),
);
function isMaterialBm(bm: Bm): boolean {
  return MATERIAL_BM_CLIENT_NAMES.has(bm.client_name);
}

// Categoria gravada em bm_lines_materiais pra cada tipo — "locacao"/"consumiveis" mantêm os
// nomes legados da coluna (rental/consumable) já usados pelo restante do módulo.
const CATEGORIA_POR_TIPO: Record<MedicaoKey, MaterialCategoria> = {
  habitat: "habitat",
  locacao: "rental",
  consumiveis: "consumable",
  mob_desmob_materiais: "mob_desmob_materiais",
};

function GerarBmWizard({ reopenBm, onConsumedReopen, onContextChange, onIrParaLogistica }: {
  reopenBm: Bm | null;
  onConsumedReopen: () => void;
  onContextChange?: (ctx: { bsp: string; bmNumber: string } | null) => void;
  onIrParaLogistica?: () => void;
}) {
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
  // Valor manual de Logística Mob/Desmob — some junto com Transporte/Hotel/Outros já
  // aplicados ao BSP (totalMobDesmob) pra cobrir custo que ainda não foi lançado/aplicado
  // na aba Logística Mob/Desmob.
  const [logisticaManual, setLogisticaManual] = useState(0);
  const [reopenBmId, setReopenBmId] = useState<string | null>(null);
  const [cienteRatesFaltando, setCienteRatesFaltando] = useState(false);
  // true = usuário optou por criar um número de BM novo em vez de escolher um da lista.
  const [bmNovoManual, setBmNovoManual] = useState(false);
  // Valor do BM quando ele é novo (ainda não existe no Smartsheet, então não há "VALOR BM"
  // pra somar) — editável, pré-preenchido com o total atual calculado no momento em que
  // "Criar nova BM" é clicado. Se ficar null, a folha de rosto usa o total calculado normal.
  const [valorBmManual, setValorBmManual] = useState<number | null>(null);
  const [selectedBmNumbers, setSelectedBmNumbers] =
    useState<string[]>([]);
  const previousPoNumberRef = useRef("");
  // Resultado do último BM gerado/salvo — enquanto preenchido, a tela mostra a folha de timesheet
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
    setLogisticaManual(reopenBm.logistica_manual ?? 0);
    setValorBmManual(reopenBm.valor_bm_manual ?? null);
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
    setPosProcessamento(0); setTeamMobDesmob(0); setInternalNotes(""); setLogisticaManual(0);
    setSavedBm(null); setSavedLinesMo([]); setSavedLinesLogistica([]);
    setSelectedBmNumbers([]);
    setBmNovoManual(false);
    setValorBmManual(null);
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
      setValorBmManual(null);
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
    setValorBmManual(null);

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
  const { data: diasBase = EMPTY_DIAS_BM, isFetching: carregandoDias, error: erroDias } = useQuery({
    queryKey: ["bm-dias", cab.bsp, cab.periodStart, cab.periodEnd],
    enabled: headerCompleto && !!cab.bsp,
    queryFn: async () => {
      const bspAlvo = normalizeBmBspKey(cab.bsp);

      const copiasData = await selectAllPagesSequential<any>((from, to) =>
        supabase
          .from("bm_timesheet_dias")
          .select("*")
          .gte("data", cab.periodStart)
          .lte("data", cab.periodEnd)
          .order("data")
          .order("id")
          .range(from, to),
      );

      // A cópia (bm_timesheet_dias) só existe pros períodos que alguém já abriu na aba
      // "Timesheets" — sem isso, gerar um BM pra um período nunca visitado lá vinha vazio.
      // Replica aqui o mesmo import automático que a aba faz (TimesheetsTab.tsx), mas já
      // filtrado por este BSP, pra sempre garantir a cópia antes de agregar Mão de Obra.
      const copiaBySourceId = new Map(copiasData.map((c: any) => [c.source_dia_id, c]));

      const diasOrigem = await selectAllPagesSequential<any>((from, to) =>
        supabase
          .from("timesheet_dias")
          .select("id, semana_id, data, dia_semana, evento, bsp, descricao_tarefa, numero_tarefa, hora_entrada, hora_saida, hora_entrada_extra, hora_saida_extra, horas_normais, horas_extras, total_horas, adicional_noturno, feriado")
          .gte("data", cab.periodStart)
          .lte("data", cab.periodEnd)
          .order("data")
          .order("id")
          .range(from, to),
      );

      let copiasSincronizadas: any[] = [];
      if (diasOrigem.length) {
        const semanaIds = Array.from(new Set(diasOrigem.map((d: any) => d.semana_id)));
        const semanas = await selectInChunks<any, any>(semanaIds, (ids) =>
          supabase.from("timesheet_semanas").select("id, embarque_id, funcao_override").in("id", ids),
        );

        const embarqueIds = Array.from(new Set(semanas.map((s: any) => s.embarque_id)));
        const embarques = await selectInChunks<any, any>(embarqueIds, (ids) =>
          supabase.from("timesheet_embarques").select("id, colaborador_id, funcao_embarque, unidade_operacional, bsp").in("id", ids),
        );

        const colabIds = Array.from(new Set(embarques.map((e: any) => e.colaborador_id).filter(Boolean)));
        const colaboradores = await selectInChunks<any, any>(colabIds, (ids) =>
          supabase.from("hist_novo_colaboradores").select("id, nome").eq("ativo", true).in("id", ids),
        );

        const semanaById = new Map<string, any>(semanas.map((s: any) => [s.id, s]));
        const embarqueById = new Map<string, any>(embarques.map((e: any) => [e.id, e]));
        const nomeById = new Map<string, string>(colaboradores.map((c: any) => [c.id, c.nome]));

        const origensDoBsp = diasOrigem
          .flatMap((d: any) => {
            const semana = semanaById.get(d.semana_id);
            const embarque = semana ? embarqueById.get(semana.embarque_id) : null;
            if (!embarque || !nomeById.has(embarque.colaborador_id)) return [];
            return {
              source_dia_id: d.id,
              colaborador_id: embarque?.colaborador_id ?? null,
              colaborador_nome: nomeById.get(embarque?.colaborador_id) ?? "—",
              funcao: semana?.funcao_override ?? embarque?.funcao_embarque ?? null,
              unidade_operacional: embarque?.unidade_operacional ?? null,
              bsp: d.bsp ?? embarque?.bsp ?? null,
              data: d.data, dia_semana: d.dia_semana, evento: d.evento,
              descricao_tarefa: d.descricao_tarefa, numero_tarefa: d.numero_tarefa,
              hora_entrada: d.hora_entrada, hora_saida: d.hora_saida,
              hora_entrada_extra: d.hora_entrada_extra, hora_saida_extra: d.hora_saida_extra,
              horas_normais: d.horas_normais, horas_extras: d.horas_extras, total_horas: d.total_horas,
              adicional_noturno: !!d.adicional_noturno, feriado: !!d.feriado,
            };
          })
          // Só importa dias do BSP que realmente interessa aqui — o resto continua faltando
          // até alguém abrir a aba Timesheets (ou gerar um BM) pro BSP correspondente.
          .filter((d: any) => normalizeBmBspKey(d.bsp) === bspAlvo);

        const sincronizacoes = origensDoBsp.map((source: any) =>
          mergeBmTimesheetSource(source, copiaBySourceId.get(source.source_dia_id)),
        );
        const rows = sincronizacoes.filter((item) => item.changed).map((item) => item.row);
        if (rows.length) {
          for (let i = 0; i < rows.length; i += 500) {
            const { error: upsertErr } = await supabase
              .from("bm_timesheet_dias").upsert(rows.slice(i, i + 500), { onConflict: "source_dia_id" });
            if (upsertErr) throw upsertErr;
          }
        }
        copiasSincronizadas = sincronizacoes.map((item, index) => ({
          ...(copiaBySourceId.get(origensDoBsp[index].source_dia_id) ?? {}),
          ...item.row,
        }));
      }

      const idsSincronizados = new Set(copiasSincronizadas.map((c: any) => c.source_dia_id));
      const copiasCandidatas = [
        ...copiasData.filter((c: any) => !idsSincronizados.has(c.source_dia_id)),
        ...copiasSincronizadas,
      ];
      const colaboradorIds = Array.from(new Set(copiasCandidatas.map((d: any) => d.colaborador_id).filter(Boolean)));
      const colaboradoresAtivos = await selectInChunks<any, any>(colaboradorIds, (ids) =>
        supabase.from("hist_novo_colaboradores").select("id").eq("ativo", true).in("id", ids),
      );
      const activeIds = new Set(colaboradoresAtivos.map((c: any) => c.id));
      const todasAsCopias = copiasCandidatas.filter((d: any) => activeIds.has(d.colaborador_id));

      const diasComColaborador: TimesheetDiaComColaborador[] = todasAsCopias
        .filter((d: any) => d.colaborador_id && normalizeBmBspKey(d.bsp) === bspAlvo)
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
  const { data: rates = EMPTY_RATES_BM, isFetching: carregandoRates, error: erroRates } = useQuery({
    queryKey: ["bm-rates", cab.client, cab.vessel],
    enabled: headerCompleto,
    queryFn: async () => {
      const rateClientNames =
        resolveBmRateClientNames(cab.client);

      if (!rateClientNames.length) return [];

      const { data, error } = await supabase
        .from("rates")
        .select("*")
        .in("client", rateClientNames)
        .eq("active", true);

      if (error) throw error;

      const ratesDaEmbarcacao =
        selectBmRateGroup(
          (data ?? []) as Rate[],
          cab.vessel,
        );

      return ratesDaEmbarcacao.map(
        (rate) => ({
          ...rate,
          client: cab.client,
          vessel: cab.vessel,
        }),
      );
    },
  });

  const carregandoMo = carregandoDias || carregandoRates;
  const erroMaoDeObra = erroDias ?? erroRates;

  const maoDeObraCalculada = useMemo(
    () => (headerCompleto ? aggregateMaoDeObra(diasComOverrides, rates, cab.client, cab.vessel) : []),
    [diasComOverrides, rates, cab.client, cab.vessel, headerCompleto],
  );

  

  useEffect(() => {
    setLinesMo(
      maoDeObraCalculada.map(
        ({ hasHoraExtraRate: _a, hasAdicionalNoturnoRate: _b, ...rest }) =>
          rest,
      ),
    );
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

  // Habitat/Locação/Consumíveis/Mob-Desmob de Materiais viraram BMs próprios (ver
  // MaterialBmWizard) — não entram mais no cabeçalho/total do BM de Mão de Obra.
  const numeroBmAtual = cab.numeroBm.trim();

  // Publica o BSP/BM em geração pra aba Logística Mob/Desmob aplicar direto neste BM.
  useEffect(() => {
    onContextChange?.(cab.bsp ? { bsp: cab.bsp, bmNumber: numeroBmAtual } : null);
    return () => onContextChange?.(null);
  }, [cab.bsp, numeroBmAtual]);



  // ── Logística Mob/Desmob (transporte e hotel) aplicada ao BSP selecionado ───────────────
  // Os custos importados na aba "Logística Mob/Desmob" são aplicados por BSP; ao selecionar
  // o BSP aqui, os totais de transporte e hotel já aplicados entram no cálculo do BM.
  const { data: mobDesmob = { transporte: 0, hotel: 0, outros: 0, markup: 0 } } = useQuery({
    queryKey: ["bm-mob-desmob-aplicados", cab.bsp, numeroBmAtual],
    enabled: !!cab.bsp,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_mob_desmob_costs").select("categoria, total_cost, applied_bm_number")
        .eq("applied", true).eq("bsp", cab.bsp);
      if (error) throw error;
      const acc = { transporte: 0, hotel: 0, outros: 0, markup: 0 };
      for (const r of (data ?? []) as { categoria: "transporte" | "hotel" | "outros"; total_cost: number; applied_bm_number: string | null }[]) {
        if (numeroBmAtual && r.applied_bm_number && r.applied_bm_number !== numeroBmAtual) continue;
        const k = (r.categoria in acc ? r.categoria : "outros") as "transporte" | "hotel" | "outros";
        acc[k] = round2(acc[k] + (Number(r.total_cost) || 0));
      }
      // Markup incluído na aplicação por cartão ("Aplicar ao BM" de um BSP) — nunca gerado
      // pelo "Aplicar tudo ao BM". Se a tabela ainda não existir (migration não aplicada),
      // isso aqui cai em silêncio e markup fica 0, sem quebrar o resto do BM.
      const { data: markups } = await supabase
        .from("bm_mob_desmob_markups").select("applied_bm_number, incluiu_markup, valor_markup_calculado")
        .eq("bsp", cab.bsp).eq("incluiu_markup", true);
      for (const m of (markups ?? []) as { applied_bm_number: string; valor_markup_calculado: number }[]) {
        if (numeroBmAtual && m.applied_bm_number && m.applied_bm_number !== numeroBmAtual) continue;
        acc.markup = round2(acc.markup + (Number(m.valor_markup_calculado) || 0));
      }
      return acc;
    },
  });
  const totalMobDesmob = round2(mobDesmob.transporte + mobDesmob.hotel + mobDesmob.outros + mobDesmob.markup + logisticaManual);

  const totalGeral = round2(totals.grandTotal + totalMobDesmob);

  const poBalanceDepois = cab.poBalanceBefore != null ? round2(cab.poBalanceBefore - totalGeral) : null;



  const bmExportData: BmExportData = useMemo(() => ({
    client: cab.client, vessel: cab.vessel, projectName: cab.bsp,
    periodStart: cab.periodStart, periodEnd: cab.periodEnd, poNumber: cab.poNumber,
    poValue: cab.poValue, poBalanceBefore: cab.poBalanceBefore,
    markupEnabled, markupPct, totals,
  }), [cab, markupEnabled, markupPct, totals]);

  const salvarBm = useMutation({
    mutationFn: async (targetStatus: "draft" | "pending_pm") => {
      if (erroMaoDeObra) {
        throw new Error("Não foi possível carregar todas as horas do Timesheet. Recarregue os dados antes de gerar o BM.");
      }
      if (carregandoMo) {
        throw new Error("As horas do Timesheet ainda estão sendo carregadas. Aguarde antes de gerar o BM.");
      }
      if (!linesMo.length) {
        throw new Error("Nenhuma hora foi encontrada para este BSP e período. O BM vazio não foi salvo.");
      }
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
        // Habitat/Locação/Consumíveis/Mob-Desmob de Materiais agora são BMs próprios (ver
        // MaterialBmWizard) — zerados aqui pra não deixar valor de uma medição antiga
        // "grudado" num BM de Mão de Obra reaberto.
        total_habitat: 0,
        total_locacao: 0,
        total_consumiveis: 0,
        total_mob_desmob_materiais: 0,
        pos_processamento: posProcessamento,
        team_mob_desmob: teamMobDesmob,
        logistica_manual: logisticaManual,
        valor_bm_manual: valorBmManual,
        internal_notes: internalNotes.trim() || null,
        total_geral: totalGeral,

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
      qc.invalidateQueries({ queryKey: ["bm-day-grid"] });
      notify.success(targetStatus === "pending_pm" ? "BM enviado para aprovação do PM." : "Rascunho salvo.");
      setSavedBm(bm);
      setSavedLinesMo(savedMo);
      setSavedLinesLogistica(savedLogistica);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao salvar o BM."),
  });

  const podeAvancarStep0 = headerCompleto && !erroMaoDeObra && linesMo.length > 0;
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
        <BmTimesheetCoverView bm={savedBm} linesMo={savedLinesMo} />
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

      {erroMaoDeObra && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">As horas do Timesheet não foram carregadas.</p>
          <p className="mt-1 text-xs">
            O BM não poderá ser gerado vazio. Tente novamente; se o erro continuar, informe o suporte.
          </p>
        </div>
      )}

      {headerCompleto && !carregandoMo && !erroMaoDeObra && linesMo.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Nenhuma hora foi encontrada para o BSP e período selecionados. O BM vazio não poderá ser gerado.
        </div>
      )}

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
                      setValorBmManual(null);
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
                        setValorBmManual(totalGeral);

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

             

            </div>

          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Período — De</Label><Input type="date" value={cab.periodStart} onChange={(e) => setCab({ ...cab, periodStart: e.target.value })} /></div>
            <div><Label className="text-xs">Período — Até</Label><Input type="date" value={cab.periodEnd} onChange={(e) => setCab({ ...cab, periodEnd: e.target.value })} /></div>
          </div>

          {/* Prévia de horas: assim que Cliente/Unidade/BSP/período estão preenchidos, as horas
              já carregadas do Timesheet aparecem aqui, antes de avançar no assistente. */}
          {headerCompleto && (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Horas identificadas para cobrança</span>
                <span className="text-xs text-muted-foreground">
                  {carregandoMo
                    ? "Carregando..."
                    : `${resumoHoras.length} colaborador(es) · ${fmtHoras(resumoHorasTotais.totalHoras)} h`}
                </span>
              </div>
              {carregandoMo ? (
                <p className="text-xs text-muted-foreground">Buscando horas do Timesheet para o BSP e período...</p>
              ) : resumoHoras.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma hora encontrada para o BSP e período selecionados.
                </p>
              ) : (
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-1 pr-2 font-medium">Colaborador</th>
                        <th className="py-1 pr-2 font-medium">Função</th>
                        <th className="py-1 pr-2 text-right font-medium">Dias</th>
                        <th className="py-1 pr-2 text-right font-medium">Horas totais</th>
                        <th className="py-1 pr-2 text-right font-medium">HE</th>
                        <th className="py-1 text-right font-medium">AN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumoHoras.map((r) => (
                        <tr key={r.colaboradorId} className="border-b last:border-0">
                          <td className="py-1 pr-2">{r.nome}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{r.funcao}</td>
                          <td className="py-1 pr-2 text-right">{r.dias}</td>
                          <td className="py-1 pr-2 text-right font-medium">{fmtHoras(r.totalHoras)}</td>
                          <td className="py-1 pr-2 text-right">{fmtHoras(r.horasExtras)}</td>
                          <td className="py-1 text-right">{r.diasAdicionalNoturno}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-semibold">
                        <td className="py-1 pr-2" colSpan={2}>Total</td>
                        <td className="py-1 pr-2 text-right">{resumoHorasTotais.dias}</td>
                        <td className="py-1 pr-2 text-right">{fmtHoras(resumoHorasTotais.totalHoras)}</td>
                        <td className="py-1 pr-2 text-right">{fmtHoras(resumoHorasTotais.horasExtras)}</td>
                        <td className="py-1 text-right">{resumoHorasTotais.diasAdicionalNoturno}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {cab.poValue != null && (
            <p className="text-xs text-muted-foreground">
              PO Value: <strong>{fmtMoney(cab.poValue)}</strong>
              {cab.poBalanceBefore != null && <> · Saldo antes deste BM: <strong>{fmtMoney(cab.poBalanceBefore)}</strong></>}
            </p>
          )}

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Logística Mob/Desmob aplicada ao BSP</span>
              <div className="flex items-center gap-2">
                <Button
                  type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                  disabled={!cab.bsp}
                  onClick={() => onIrParaLogistica?.()}
                >

                  <Plus className="mr-1 h-3 w-3" />Adicionar custo
                </Button>
                <span className="text-xs text-muted-foreground">Total: <strong>{fmtMoney(totalMobDesmob)}</strong></span>
              </div>
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
              {mobDesmob.markup > 0 && (
                <div>
                  <Label className="text-xs text-emerald-700">Markup aplicado</Label>
                  <Input readOnly className="border-emerald-200 bg-emerald-50 text-emerald-800" value={fmtMoney(mobDesmob.markup)} />
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {cab.bsp
                ? `Custos importados e aplicados na aba Logística Mob/Desmob para o BSP ${cab.bsp}.`
                : "Selecione o BSP para carregar os custos de transporte e hotel já aplicados."}
            </p>
            <div className="mt-3 border-t pt-3">
              <Label className="text-xs">Valor manual de Logística</Label>
              <Input
                type="number" step="0.01" value={logisticaManual}
                onChange={(e) => setLogisticaManual(Number(e.target.value) || 0)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lançamento manual, somado ao total acima e enviado pra folha de rosto do BM gerado.
              </p>
            </div>
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

              <div className="flex justify-between border-t pt-1 text-base font-semibold"><span>Total geral</span><span>{fmtMoney(totalGeral)}</span></div>

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
        </div>
      </div>
    </Card>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Gerar Novo BM: Habitat/Locação/Consumíveis/Mob-Desmob de Materiais ─────
// Medidos separadamente da Mão de Obra: cabeçalho simples (BSP + Período + Número do BM) e
// puxa os lançamentos já pendentes na aba correspondente (bm_medicoes) em vez de recalcular
// horas/rates — cada geração vira seu próprio BM, com folha de rosto própria no Histórico.
// Folha de rosto de um BM de Habitat/Locação/Consumíveis/Mob-Desmob de Materiais — mais
// simples que BmTimesheetCoverView (sem tabela de horas/diárias, que não existe pra esse
// tipo de BM), listando as linhas de bm_lines_materiais e o total geral.
function MaterialBmCoverView({ bm, linhas }: { bm: Bm; linhas: BmLineMateriais[] }) {
  const categoria = linhas[0]?.categoria;
  const tipoLabel = categoria === "rental" ? "Locação"
    : categoria === "consumable" ? "Consumíveis"
    : categoria === "mob_desmob_materiais" ? "Mob/Desmob de Materiais"
    : "Habitat";
  const quantidadeTotal = linhas.reduce((total, linha) => total + (Number(linha.qtd) || 0), 0);
  return (
    <div className="space-y-4 bg-background print:bg-white print:text-black">
      <div className="flex justify-end print:hidden">
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />Imprimir / Salvar PDF
        </Button>
      </div>
      <div className="flex items-center justify-between border-b-2 border-primary pb-4">
        <BrandLogo className="h-12 w-auto" />
        <div>
          <p className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Boletim de Medição</p>
          <p className="text-right text-xl font-semibold">{tipoLabel}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border p-4 text-sm md:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Número do BM</p><p className="font-semibold">{bm.numero_bm ?? "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">BSP</p><p className="font-semibold">{bm.project_name || bm.vessel || "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Período</p><p className="font-semibold">{fmt(bm.period_start)} - {fmt(bm.period_end)}</p></div>
        <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge tone={STATUS_TONE[bm.current_status]}>{STATUS_LABELS[bm.current_status]}</StatusBadge></div>
      </div>
      {bm.current_status === "rejected" && bm.rejection_reason && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          Motivo da rejeição: {bm.rejection_reason}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead>TAG</TableHead>
            <TableHead>BSP</TableHead>
            <TableHead>Período</TableHead>
            <TableHead className="text-right">Qtd</TableHead>
            <TableHead className="text-right">Valor unit.</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.length === 0 && <EmptyStateRow colSpan={7} icon={Coins} title="Nenhum item registrado" />}
          {linhas.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.descricao}</TableCell>
              <TableCell>{l.tag ?? "—"}</TableCell>
              <TableCell>{l.bsp ?? "—"}</TableCell>
              <TableCell>{l.period_start ? `${fmt(l.period_start)} - ${fmt(l.period_end || l.period_start)}` : "—"}</TableCell>
              <TableCell className="text-right">{l.qtd}</TableCell>
              <TableCell className="text-right">{fmtMoney(l.valor_diario ?? 0)}</TableCell>
              <TableCell className="text-right font-medium">{fmtMoney(l.valor_total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid grid-cols-2 gap-3 border-t pt-4 md:ml-auto md:max-w-md">
        <div className="rounded-md bg-muted/40 p-3 text-right">
          <p className="text-xs text-muted-foreground">Quantidade total</p>
          <p className="text-lg font-semibold">{quantidadeTotal.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-md bg-primary/10 p-3 text-right">
          <p className="text-xs text-muted-foreground">Valor final do BM</p>
          <p className="text-xl font-bold">{fmtMoney(bm.total_geral)}</p>
        </div>
      </div>
    </div>
  );
}

function MaterialBmWizard({ tipo }: { tipo: MedicaoKey }) {
  const qc = useQueryClient();
  const [bsp, setBsp] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [numeroBm, setNumeroBm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savedBm, setSavedBm] = useState<Bm | null>(null);

  const { data: registros = [], isFetching } = useQuery<MedicaoRow[]>({
    queryKey: ["bm-medicoes", tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_medicoes").select("*").eq("tipo", tipo).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MedicaoRow[];
    },
  });

  const pendentes = useMemo(() => registros.filter((r) => !r.applied), [registros]);
  const bspOptions = useMemo(
    () => Array.from(new Set(pendentes.map((r) => r.bsp).filter((b): b is string => !!b))).sort(),
    [pendentes],
  );
  const pendentesFiltrados = useMemo(
    () => (bsp ? pendentes.filter((r) => r.bsp === bsp) : pendentes),
    [pendentes, bsp],
  );

  // Ao trocar de BSP, a seleção acompanha a lista filtrada (marca tudo que ficou visível).
  useEffect(() => {
    setSelectedIds(new Set(pendentesFiltrados.map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bsp]);

  const toggleSelecionado = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const selecionados = useMemo(() => pendentesFiltrados.filter((r) => selectedIds.has(r.id)), [pendentesFiltrados, selectedIds]);
  const totalSelecionado = useMemo(() => round2(selecionados.reduce((acc, r) => acc + (r.valor_total || 0), 0)), [selecionados]);

  const headerCompleto = !!bsp && !!periodStart && !!periodEnd && !!numeroBm.trim();

  const resetLocal = () => {
    setBsp(""); setPeriodStart(""); setPeriodEnd(""); setNumeroBm("");
    setSelectedIds(new Set()); setSavedBm(null);
  };

  const gerar = useMutation({
    mutationFn: async (targetStatus: "draft" | "pending_pm") => {
      if (!headerCompleto) throw new Error("Preencha BSP, período e número do BM.");
      if (selecionados.length === 0) throw new Error("Selecione ao menos um lançamento pendente.");

      const payload = {
        numero_bm: numeroBm.trim(),
        client_id: null,
        client_name: TIPO_BM_LABEL[tipo],
        project_id: null,
        project_name: bsp,
        vessel: bsp,
        period_start: periodStart,
        period_end: periodEnd,
        po_number: null,
        po_value: null,
        po_balance_before: null,
        markup_enabled: false,
        markup_pct: 0,
        total_mo: 0,
        total_logistica: 0,
        total_materiais: totalSelecionado,
        total_habitat: tipo === "habitat" ? totalSelecionado : 0,
        total_locacao: tipo === "locacao" ? totalSelecionado : 0,
        total_consumiveis: tipo === "consumiveis" ? totalSelecionado : 0,
        total_mob_desmob_materiais: tipo === "mob_desmob_materiais" ? totalSelecionado : 0,
        pos_processamento: 0,
        team_mob_desmob: 0,
        logistica_manual: 0,
        valor_bm_manual: null,
        internal_notes: null,
        total_geral: totalSelecionado,
        current_status: targetStatus,
      };

      const { data: bmRow, error } = await supabase.from("bms").insert(payload).select("*").single();
      if (error) throw error;

      const categoria = CATEGORIA_POR_TIPO[tipo];
      const linhas = selecionados.map((r) => ({
        bm_id: bmRow.id,
        categoria,
        descricao: r.descricao,
        tag: r.tag,
        bsp: r.bsp,
        period_start: r.period_start,
        period_end: r.period_end,
        valor_diario: r.valor_unitario,
        qtd: r.qtd,
        valor_total: r.valor_total,
      }));
      const { error: errLinhas } = await supabase.from("bm_lines_materiais").insert(linhas);
      if (errLinhas) throw errLinhas;

      const { error: errMed } = await supabase.from("bm_medicoes").update({
        applied: true, applied_bm_number: numeroBm.trim(), applied_bm_row_id: null, applied_at: new Date().toISOString(),
      }).in("id", selecionados.map((r) => r.id));
      if (errMed) throw errMed;

      if (targetStatus === "pending_pm") {
        const { error: errHist } = await supabase.from("bm_status_history").insert({ bm_id: bmRow.id, status: "pending_pm", changed_by_name: "Operador", notes: null });
        if (errHist) throw errHist;
      }

      return bmRow as Bm;
    },
    onSuccess: (bm, targetStatus) => {
      qc.invalidateQueries({ queryKey: ["bm-medicoes", tipo] });
      qc.invalidateQueries({ queryKey: ["bm-historico"] });
      notify.success(targetStatus === "pending_pm" ? "BM enviado para aprovação do PM." : "Rascunho salvo.");
      setSavedBm(bm);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao gerar o BM."),
  });

  const { data: linhasGeradas = [] } = useQuery<BmLineMateriais[]>({
    queryKey: ["bm-linhas-materiais", savedBm?.id],
    enabled: !!savedBm,
    queryFn: async () => {
      const { data, error } = await supabase.from("bm_lines_materiais").select("*").eq("bm_id", savedBm!.id);
      if (error) throw error;
      return (data ?? []) as BmLineMateriais[];
    },
  });

  if (savedBm) {
    return (
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <p className="text-sm font-medium">
            BM de {TIPO_BM_LABEL[tipo]} {savedBm.current_status === "pending_pm" ? "enviado para aprovação" : "salvo como rascunho"}.
          </p>
          <Button size="sm" variant="outline" onClick={resetLocal}>Gerar novo BM</Button>
        </div>
        <MaterialBmCoverView bm={savedBm} linhas={linhasGeradas} />
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">BSP</Label>
          <Select value={bsp} onValueChange={setBsp}>
            <SelectTrigger>
              <SelectValue placeholder={bspOptions.length ? "Selecione" : "Nenhum pendente lançado"} />
            </SelectTrigger>
            <SelectContent>
              {bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Período de</Label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Período até</Label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Número do BM</Label>
        <Input value={numeroBm} onChange={(e) => setNumeroBm(e.target.value)} placeholder="Número do BM" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs">Lançamentos pendentes de {TIPO_BM_LABEL[tipo]}</Label>
          <span className="text-xs text-muted-foreground">{fmtMoney(totalSelecionado)} selecionado</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>BSP</TableHead>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Valor Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isFetching && <EmptyStateRow colSpan={6} icon={Coins} title="Carregando..." />}
            {!isFetching && pendentesFiltrados.length === 0 && (
              <EmptyStateRow colSpan={6} icon={Coins} title={`Nenhum lançamento pendente nesta aba${bsp ? ` para o BSP ${bsp}` : ""}.`} />
            )}
            {pendentesFiltrados.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelecionado(r.id)} /></TableCell>
                <TableCell>{r.descricao}</TableCell>
                <TableCell>{r.bsp ?? "—"}</TableCell>
                <TableCell>{r.period_start ? `${fmt(r.period_start)} - ${fmt(r.period_end || r.period_start)}` : "—"}</TableCell>
                <TableCell className="text-right">{r.qtd}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.valor_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button
          size="sm" variant="outline"
          disabled={!headerCompleto || selecionados.length === 0}
          loading={gerar.isPending && gerar.variables === "draft"}
          onClick={() => gerar.mutate("draft")}
        >
          Gerar BM
        </Button>
        <Button
          size="sm"
          disabled={!headerCompleto || selecionados.length === 0}
          loading={gerar.isPending && gerar.variables === "pending_pm"}
          onClick={() => gerar.mutate("pending_pm")}
        >
          Enviar para Aprovação do PM
        </Button>
      </div>
    </Card>
  );
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

// Barra de progresso que anima de 0% até o valor real logo após montar — dá o efeito de
// "cascata" preenchendo quando a aba abre, em vez de já nascer no valor final.
function CascataBar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "muted" }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-700 ease-out", tone === "primary" ? "bg-primary" : "bg-muted-foreground/40")}
        style={{ width: mounted ? `${clamped}%` : "0%" }}
      />
    </div>
  );
}

function CascataUnidadeCard({ index, vessel, bmsComPo, poValue, saldoRestante, expanded, onToggle }: {
  index: number; vessel: string; bmsComPo: Bm[]; poValue: number | null; saldoRestante: number | null;
  expanded: boolean; onToggle: () => void;
}) {
  const pctUsado = poValue && poValue > 0 && saldoRestante != null ? round2(((poValue - saldoRestante) / poValue) * 100) : 0;
  return (
    <div
      className="rounded-md border animate-in fade-in slide-in-from-bottom-2 duration-500"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "backwards" }}
    >
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 p-2.5 text-left hover:bg-muted/40 rounded-md">
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm font-medium truncate">{vessel}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">{bmsComPo.length} BM{bmsComPo.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-32 hidden sm:block"><CascataBar pct={pctUsado} /></div>
          <span className="text-xs font-medium">
            {saldoRestante != null ? fmtMoney(saldoRestante) : "—"} <span className="text-[11px] font-normal text-muted-foreground">restante</span>
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t pt-2.5">
          {poValue != null && (
            <p className="text-[11px] text-muted-foreground">
              Valor total da PO: <strong className="text-foreground">{fmtMoney(poValue)}</strong> · Já medido: <strong className="text-foreground">{fmtMoney(round2(poValue - (saldoRestante ?? 0)))}</strong> ({pctUsado.toFixed(0)}%)
            </p>
          )}
          {bmsComPo.map((b, i) => {
            const saldoDepois = round2((b.po_balance_before ?? 0) - b.total_geral);
            const pctBm = poValue && poValue > 0 ? round2(((b.po_balance_before ?? 0) - saldoDepois) / poValue * 100) : 0;
            return (
              <div
                key={b.id}
                className="text-xs animate-in fade-in slide-in-from-bottom-1 duration-500"
                style={{ animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium">BM {b.numero_bm ?? "—"}</span>
                  <span className="text-muted-foreground">
                    {fmtMoney(b.po_balance_before ?? 0)} → {fmtMoney(saldoDepois)} <span className="text-[10px]">(−{fmtMoney(b.total_geral)})</span>
                  </span>
                </div>
                <CascataBar pct={pctBm} tone="muted" />
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 pt-1 border-t">
            <span className="text-xs font-semibold">Saldo restante</span>
            <span className="text-xs font-semibold">{saldoRestante != null ? fmtMoney(saldoRestante) : "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

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
      const [mo, logistica, materiais] = await Promise.all([
        supabase.from("bm_lines_mo").select("*").eq("bm_id", viewingBm!.id),
        supabase.from("bm_lines_logistica").select("*").eq("bm_id", viewingBm!.id),
        supabase.from("bm_lines_materiais").select("*").eq("bm_id", viewingBm!.id),
      ]);
      if (mo.error) throw mo.error;
      if (logistica.error) throw logistica.error;
      if (materiais.error) throw materiais.error;
      return {
        mo: (mo.data ?? []) as BmLineMo[],
        logistica: (logistica.data ?? []) as BmLineLogistica[],
        materiais: (materiais.data ?? []) as BmLineMateriais[],
      };
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
        data: { poNumber: bm.po_number ?? "", bmNumber: bm.numero_bm ?? "", client: bm.client_name, vessel: bm.vessel, value: bm.valor_bm_manual ?? bm.total_geral },
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


  // Cascata por unidade: agrupa os BMs já gerados por "vessel" (embarcação, ou BSP nos BMs
  // simplificados de material) e mostra, do mais antigo pro mais recente, o saldo da PO indo
  // sendo consumido — cada bm.po_balance_before já vem calculado (via getBmHistoryForPo) na
  // hora em que aquele BM foi salvo, então "saldo depois" = po_balance_before - total_geral
  // desse mesmo BM, sem precisar recalcular nada aqui. Só entram na cascata BMs vinculados a
  // uma PO (po_balance_before != null) — os BMs simplificados de material não têm PO.
  const cascatas = useMemo(() => {
    const porUnidade = new Map<string, Bm[]>();
    bms.forEach((b) => {
      const key = b.vessel || "—";
      if (!porUnidade.has(key)) porUnidade.set(key, []);
      porUnidade.get(key)!.push(b);
    });
    return Array.from(porUnidade.entries())
      .map(([vessel, list]) => {
        const comPo = [...list]
          .filter((b) => b.po_balance_before != null)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const ultimo = comPo[comPo.length - 1];
        return {
          vessel,
          bms: comPo,
          poValue: ultimo?.po_value ?? null,
          saldoRestante: ultimo ? round2((ultimo.po_balance_before ?? 0) - ultimo.total_geral) : null,
        };
      })
      .filter((c) => c.bms.length > 0)
      .sort((a, b) => a.vessel.localeCompare(b.vessel));
  }, [bms]);
  const [expandedVessel, setExpandedVessel] = useState<string | null>(null);

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
      {cascatas.length > 0 && (
        <Card className="p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Saldo da PO por unidade — quanto ainda falta medir</p>
          <div className="space-y-2">
            {cascatas.map((c, i) => (
              <CascataUnidadeCard
                key={c.vessel}
                index={i}
                vessel={c.vessel}
                bmsComPo={c.bms}
                poValue={c.poValue}
                saldoRestante={c.saldoRestante}
                expanded={expandedVessel === c.vessel}
                onToggle={() => setExpandedVessel((v) => (v === c.vessel ? null : c.vessel))}
              />
            ))}
          </div>
        </Card>
      )}
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
                  {(b.current_status === "draft" || b.current_status === "rejected") && !isMaterialBm(b) && (
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
              {isMaterialBm(viewingBm) ? (
                <MaterialBmCoverView bm={viewingBm} linhas={viewingLinhas?.materiais ?? []} />
              ) : (
                <BmTimesheetCoverView bm={viewingBm} linesMo={viewingLinhas?.mo ?? []} />
              )}
            </>
          )}

        </DialogContent>
      </Dialog>
      {viewingBm && (
        <div className="hidden print:block">
          {isMaterialBm(viewingBm) ? (
            <MaterialBmCoverView bm={viewingBm} linhas={viewingLinhas?.materiais ?? []} />
          ) : (
            <BmTimesheetCoverView bm={viewingBm} linesMo={viewingLinhas?.mo ?? []} />
          )}
        </div>
      )}
    </div>
  );
}
