import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabela ainda não está nos tipos gerados; cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { selectAllPages } from "@/lib/supabasePaginate";
import { normalizeHeader, parseExcelDate } from "@/lib/histograma/import-drake";
import { todayStr } from "@/lib/histogramaNovo";
import { fmtDateTime } from "@/lib/format";
import { StringMultiCombobox, fmtDateHeadcount } from "@/components/histograma/HistogramaOffshoreNovo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyStateRow } from "@/components/EmptyState";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { Search, X, Download, Upload, Pencil, Trash2, Users, Plus, History } from "lucide-react";

// ─── Planejamento de Embarque ───────────────────────────────────────────────────────────────
// Deixou de ser uma visão derivada de hist_novo_periodos/hist_novo_colaboradores (dados do
// Drake) — a pedido dela, agora é uma tabela própria (planejamento_embarque), controlada
// inteiramente por importação de planilha (substitui tudo a cada import) e edição manual pela
// tela. Sem nenhum vínculo com o cadastro do Drake: nome/unidade/BSP/função aqui são só texto.

export interface PlanejamentoEmbarqueRow {
  id: string;
  matricula: string | null;
  nome: string;
  unidade: string | null;
  bsp: string | null;
  funcao: string | null;
  especialidade: string | null;
  status: string | null;
  embarque: string | null;
  desembarque: string | null;
  folga_inicio: string | null;
  folga_fim: string | null;
  ferias_inicio: string | null;
  ferias_fim: string | null;
  updated_at: string;
  updated_by: string | null;
}

// Status deixou de ser calculado por datas (Embarcado/Férias/Folga/etc.) — a pedido dela, agora
// é texto livre igual Unidade/BSP/Função: exatamente o que vem da coluna "Status" da planilha,
// sem nenhuma lógica por cima. Editável direto na célula (mesmo padrão popover-com-Salvar).
export function isStatusNaBase(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return s === "BASE" || s === "NA BASE";
}

// Mesmo critério acima, pra identificar quem está "Programado" (ver cruzamento em Lançamentos
// do Histograma — LancamentosTab em HistogramaOffshoreNovo.tsx).
export function isStatusProgramado(status: string | null | undefined): boolean {
  return (status ?? "").trim().toUpperCase() === "PROGRAMADO";
}

// Idem, pra "Embarcado" (ver cruzamento no cartão "Embarcados" do Dashboard — DashboardTab em
// HistogramaOffshoreNovo.tsx).
export function isStatusEmbarcado(status: string | null | undefined): boolean {
  return (status ?? "").trim().toUpperCase() === "EMBARCADO";
}

export function usePlanejamentoEmbarqueQuery() {
  return useQuery<PlanejamentoEmbarqueRow[]>({
    queryKey: ["planejamento-embarque"],
    queryFn: () =>
      selectAllPages<PlanejamentoEmbarqueRow>((from, to) =>
        supabase.from("planejamento_embarque").select("*").order("nome").range(from, to),
      ),
  });
}

// Popover de edição em texto livre — cobre Unidade, BSP e Função, que hoje são só texto
// gravado direto na linha (nada mais vem do Drake pra sugerir opções).
function TextoPlanejamentoCell({ valor, onSave }: { valor: string | null; onSave: (novoValor: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(valor ?? "");
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setInput(valor ?? ""); }}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded px-1.5 py-0.5 text-left hover:bg-muted">
          {valor || <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="start">
        <Input value={input} onChange={(e) => setInput(e.target.value)} />
        <Button size="sm" className="w-full" onClick={() => { onSave(input.trim()); setOpen(false); }}>Salvar</Button>
      </PopoverContent>
    </Popover>
  );
}

function DataPlanejamentoCell({ valor, onSave }: { valor: string | null; onSave: (novaData: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(valor ?? "");
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setInput(valor ?? ""); }}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded px-1.5 py-0.5 text-left hover:bg-muted">
          {valor ? fmtDateHeadcount(valor) : <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2" align="start">
        <Input type="date" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button size="sm" className="w-full" onClick={() => { onSave(input); setOpen(false); }}>Salvar</Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Editar registro completo / cadastrar novo colaborador ──────────────────────────────────
// row null = cadastro de colaborador novo (insert); row preenchido = edição (update) — mesmo
// formulário nos dois casos pra não duplicar os 12 campos.
function PlanejamentoEditDialog({ row, onClose }: { row: PlanejamentoEmbarqueRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    matricula: row?.matricula ?? "", nome: row?.nome ?? "", unidade: row?.unidade ?? "", bsp: row?.bsp ?? "",
    funcao: row?.funcao ?? "", especialidade: row?.especialidade ?? "", status: row?.status ?? "",
    embarque: row?.embarque ?? "", desembarque: row?.desembarque ?? "",
    folga_inicio: row?.folga_inicio ?? "", folga_fim: row?.folga_fim ?? "",
    ferias_inicio: row?.ferias_inicio ?? "", ferias_fim: row?.ferias_fim ?? "",
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome.");
      const patch = {
        matricula: form.matricula.trim() || null, nome: form.nome.trim(),
        unidade: form.unidade.trim() || null, bsp: form.bsp.trim() || null,
        funcao: form.funcao.trim() || null, especialidade: form.especialidade.trim() || null,
        status: form.status.trim() || null,
        embarque: form.embarque || null, desembarque: form.desembarque || null,
        folga_inicio: form.folga_inicio || null, folga_fim: form.folga_fim || null,
        ferias_inicio: form.ferias_inicio || null, ferias_fim: form.ferias_fim || null,
      };
      if (row) {
        const { error } = await supabase.from("planejamento_embarque").update(patch).eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("planejamento_embarque").insert(patch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
      notify.success(row ? "Registro atualizado" : "Colaborador cadastrado");
      onClose();
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{row ? "Editar registro" : "Novo colaborador"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Matrícula</Label><Input value={form.matricula} onChange={(e) => setForm({ ...form, matricula: e.target.value })} /></div>
            <div><Label className="text-xs">Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Unidade</Label><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /></div>
            <div><Label className="text-xs">BSP</Label><Input value={form.bsp} onChange={(e) => setForm({ ...form, bsp: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Função</Label><Input value={form.funcao} onChange={(e) => setForm({ ...form, funcao: e.target.value })} /></div>
            <div><Label className="text-xs">Especialidade</Label><Input value={form.especialidade} onChange={(e) => setForm({ ...form, especialidade: e.target.value })} /></div>
          </div>
          <div><Label className="text-xs">Status</Label><Input value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Embarque</Label><Input type="date" value={form.embarque} onChange={(e) => setForm({ ...form, embarque: e.target.value })} /></div>
            <div><Label className="text-xs">Desembarque</Label><Input type="date" value={form.desembarque} onChange={(e) => setForm({ ...form, desembarque: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Início Folga</Label><Input type="date" value={form.folga_inicio} onChange={(e) => setForm({ ...form, folga_inicio: e.target.value })} /></div>
            <div><Label className="text-xs">Fim Folga</Label><Input type="date" value={form.folga_fim} onChange={(e) => setForm({ ...form, folga_fim: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Início Férias</Label><Input type="date" value={form.ferias_inicio} onChange={(e) => setForm({ ...form, ferias_inicio: e.target.value })} /></div>
            <div><Label className="text-xs">Fim Férias</Label><Input type="date" value={form.ferias_fim} onChange={(e) => setForm({ ...form, ferias_fim: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!form.nome.trim()} loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Importar planilha (substitui tudo) ─────────────────────────────────────────────────────
interface PlanejamentoImportRow {
  rowNumber: number;
  matricula: string | null; nome: string; unidade: string | null; bsp: string | null;
  funcao: string | null; especialidade: string | null; status: string | null;
  embarque: string | null; desembarque: string | null;
  folgaInicio: string | null; folgaFim: string | null;
  feriasInicio: string | null; feriasFim: string | null;
}
interface PlanejamentoImportRejection { rowNumber: number; motivo: string }

const PLANEJAMENTO_HEADER_MAP: Record<string, keyof Omit<PlanejamentoImportRow, "rowNumber">> = {
  "matricula": "matricula",
  "nome": "nome",
  "unidade": "unidade",
  "unidade/localizacao": "unidade",
  "localizacao": "unidade",
  "bsp": "bsp",
  "funcao": "funcao",
  "especialidade": "especialidade",
  "status": "status",
  "embarque": "embarque",
  "desembarque": "desembarque",
  "inicio folga": "folgaInicio",
  "folga inicio": "folgaInicio",
  "fim folga": "folgaFim",
  "folga fim": "folgaFim",
  "inicio ferias": "feriasInicio",
  "ferias inicio": "feriasInicio",
  "fim ferias": "feriasFim",
  "ferias fim": "feriasFim",
};

function parsePlanejamentoWorkbook(buf: ArrayBuffer): PlanejamentoImportRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<string, number>> = {};
  headerRow.forEach((h, i) => {
    const key = PLANEJAMENTO_HEADER_MAP[h];
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });
  if (colIndex.nome === undefined) throw new Error('Coluna "Nome" não encontrada na planilha.');

  const get = (r: unknown[], k: string): string => {
    const i = colIndex[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };
  const getDate = (r: unknown[], k: string): string | null => {
    const i = colIndex[k];
    return i === undefined ? null : parseExcelDate(r[i]);
  };

  return rows
    .slice(1)
    .map((r, idx) => ({ r, rowNumber: idx + 2 }))
    .filter(({ r }) => r.some((c) => c !== ""))
    .map(({ r, rowNumber }): PlanejamentoImportRow => ({
      rowNumber,
      matricula: get(r, "matricula") || null,
      nome: get(r, "nome"),
      unidade: get(r, "unidade") || null,
      bsp: get(r, "bsp") || null,
      funcao: get(r, "funcao") || null,
      especialidade: get(r, "especialidade") || null,
      status: get(r, "status") || null,
      embarque: getDate(r, "embarque"),
      desembarque: getDate(r, "desembarque"),
      folgaInicio: getDate(r, "folgaInicio"),
      folgaFim: getDate(r, "folgaFim"),
      feriasInicio: getDate(r, "feriasInicio"),
      feriasFim: getDate(r, "feriasFim"),
    }));
}

function validatePlanejamentoRows(rows: PlanejamentoImportRow[]): { aceitas: PlanejamentoImportRow[]; rejeitadas: PlanejamentoImportRejection[] } {
  const aceitas: PlanejamentoImportRow[] = [];
  const rejeitadas: PlanejamentoImportRejection[] = [];
  rows.forEach((row) => {
    if (!row.nome) { rejeitadas.push({ rowNumber: row.rowNumber, motivo: "Faltando Nome." }); return; }
    aceitas.push(row);
  });
  return { aceitas, rejeitadas };
}

type ImportarPlanejamentoStep = "escolher" | "conferindo" | "confirmado";

function ImportarPlanejamentoDialog({ totalAtual, onClose }: { totalAtual: number; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportarPlanejamentoStep>("escolher");
  const [aceitas, setAceitas] = useState<PlanejamentoImportRow[]>([]);
  const [rejeitadas, setRejeitadas] = useState<PlanejamentoImportRejection[]>([]);
  const [resultado, setResultado] = useState<{ criadas: number } | null>(null);
  const [lendoArquivo, setLendoArquivo] = useState(false);

  const handleFile = async (file: File) => {
    setLendoArquivo(true);
    try {
      const buf = await file.arrayBuffer();
      const parsedRows = parsePlanejamentoWorkbook(buf);
      const { aceitas: ok, rejeitadas: no } = validatePlanejamentoRows(parsedRows);
      setAceitas(ok);
      setRejeitadas(no);
      setStep("conferindo");
    } catch (err: any) {
      notify.error(err.message ?? "Erro ao ler a planilha.");
    } finally {
      setLendoArquivo(false);
    }
  };

  const importar = useMutation({
    mutationFn: async () => {
      const { error: delErro } = await supabase.from("planejamento_embarque").delete().not("id", "is", null);
      if (delErro) throw delErro;

      const linhas = aceitas.map((row) => ({
        matricula: row.matricula, nome: row.nome, unidade: row.unidade, bsp: row.bsp,
        funcao: row.funcao, especialidade: row.especialidade, status: row.status,
        embarque: row.embarque, desembarque: row.desembarque,
        folga_inicio: row.folgaInicio, folga_fim: row.folgaFim,
        ferias_inicio: row.feriasInicio, ferias_fim: row.feriasFim,
      }));
      const BATCH = 500;
      for (let i = 0; i < linhas.length; i += BATCH) {
        const { error } = await supabase.from("planejamento_embarque").insert(linhas.slice(i, i + BATCH));
        if (error) throw error;
      }
      return { criadas: linhas.length };
    },
    onSuccess: (r) => {
      setResultado(r);
      setStep("confirmado");
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
    },
    onError: (err: any) => notify.error(err.message ?? "Erro ao importar."),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar Planejamento de Embarque</DialogTitle></DialogHeader>

        {step === "escolher" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Colunas esperadas: Matrícula (opcional), Nome (obrigatório), Unidade/Localização, BSP, Função,
              Especialidade, Status, Embarque, Desembarque, Início Folga, Fim Folga, Início Férias, Fim Férias —
              mesmos nomes de coluna do relatório exportado por essa tela. Status entra exatamente como está na
              planilha, sem nenhum cálculo por cima.
            </p>
            <p className="text-sm font-medium text-destructive">
              Importar substitui TODOS os {totalAtual} registro(s) atuais pelos da planilha. Essa ação não pode
              ser desfeita.
            </p>
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            />
            <Button onClick={() => fileRef.current?.click()} loading={lendoArquivo}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Escolher arquivo
            </Button>
          </div>
        )}

        {step === "conferindo" && (
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <span className="font-medium text-emerald-700">{aceitas.length} linha(s) pronta(s) pra importar</span>
              {rejeitadas.length > 0 && <span className="font-medium text-destructive">{rejeitadas.length} linha(s) rejeitada(s)</span>}
            </div>
            <p className="text-sm font-medium text-destructive">
              Isso vai apagar os {totalAtual} registro(s) atuais e substituir por {aceitas.length} da planilha.
              Essa ação não pode ser desfeita.
            </p>
            {rejeitadas.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rejeitadas.map((r) => (
                      <TableRow key={r.rowNumber}>
                        <TableCell>{r.rowNumber}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.motivo}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {aceitas.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Nome</TableHead><TableHead>Unidade</TableHead><TableHead>BSP</TableHead><TableHead>Função</TableHead><TableHead>Status</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {aceitas.map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.nome}</TableCell>
                        <TableCell>{row.unidade ?? "—"}</TableCell>
                        <TableCell>{row.bsp ?? "—"}</TableCell>
                        <TableCell>{row.funcao ?? "—"}</TableCell>
                        <TableCell>{row.status ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {step === "confirmado" && resultado && (
          <p className="text-sm font-medium text-emerald-700">{resultado.criadas} registro(s) importado(s) com sucesso.</p>
        )}

        <DialogFooter>
          {step === "conferindo" && (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button variant="destructive" onClick={() => importar.mutate()} loading={importar.isPending} disabled={aceitas.length === 0}>
                Substituir tudo ({aceitas.length})
              </Button>
            </>
          )}
          {(step === "escolher" || step === "confirmado") && <Button variant="outline" onClick={onClose}>Fechar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba principal ───────────────────────────────────────────────────────────────────────────
type PlanejamentoSortColumn =
  | "matricula" | "nome" | "unidade" | "bsp" | "funcao" | "especialidade" | "status"
  | "embarque" | "desembarque" | "folgaInicio" | "folgaFim" | "feriasInicio" | "feriasFim";

export function PlanejamentoEmbarqueTab() {
  const qc = useQueryClient();
  const { data: registros = [], isLoading } = usePlanejamentoEmbarqueQuery();

  const [showImportar, setShowImportar] = useState(false);
  const [criando, setCriando] = useState(false);
  const [editing, setEditing] = useState<PlanejamentoEmbarqueRow | null>(null);
  const [excluindo, setExcluindo] = useState<PlanejamentoEmbarqueRow | null>(null);

  const updateCampo = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from("planejamento_embarque").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["planejamento-embarque"] }); notify.success("Atualizado"); },
    onError: (e: any) => notify.error(e.message),
  });

  const excluirRegistro = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("planejamento_embarque").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
      notify.success("Registro excluído");
      setExcluindo(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  // Última atualização (qualquer linha) — pra mostrar quem mexeu por último e quando no
  // cabeçalho da aba. updated_at/updated_by são preenchidos automaticamente por gatilho no
  // banco em todo insert/update (import, edição de célula, dialog), nunca pelo app — ver
  // migração 20260918120000_planejamento_embarque_audit.sql.
  const ultimaAtualizacao = useMemo(
    () => registros.reduce<PlanejamentoEmbarqueRow | null>(
      (mais, r) => (!mais || r.updated_at > mais.updated_at ? r : mais),
      null,
    ),
    [registros],
  );
  const { data: perfilUltimaAtualizacao } = useQuery({
    queryKey: ["profile-nome", ultimaAtualizacao?.updated_by],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("full_name").eq("id", ultimaAtualizacao!.updated_by).maybeSingle();
      if (error) throw error;
      return data as { full_name: string | null } | null;
    },
    enabled: !!ultimaAtualizacao?.updated_by,
  });
  const primeiroNomeUltimaAtualizacao = perfilUltimaAtualizacao?.full_name?.trim().split(/\s+/)[0] ?? null;

  const { sortColumn, sortDirection, toggleSort } = useTableSort<PlanejamentoSortColumn>();

  const [colaboradorInput, setColaboradorInput] = useState<string[]>([]);
  const [unidadeInput, setUnidadeInput] = useState<string[]>([]);
  const [bspInput, setBspInput] = useState<string[]>([]);
  const [funcaoInput, setFuncaoInput] = useState<string[]>([]);
  const [especialidadeInput, setEspecialidadeInput] = useState<string[]>([]);
  const [statusInput, setStatusInput] = useState<string[]>([]);
  const [filterColaborador, setFilterColaborador] = useState<string[]>([]);
  const [filterUnidade, setFilterUnidade] = useState<string[]>([]);
  const [filterBsp, setFilterBsp] = useState<string[]>([]);
  const [filterFuncao, setFilterFuncao] = useState<string[]>([]);
  const [filterEspecialidade, setFilterEspecialidade] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);

  const aplicarFiltro = () => {
    setFilterColaborador(colaboradorInput);
    setFilterUnidade(unidadeInput);
    setFilterBsp(bspInput);
    setFilterFuncao(funcaoInput);
    setFilterEspecialidade(especialidadeInput);
    setFilterStatus(statusInput);
  };
  const limparFiltros = () => {
    setColaboradorInput([]); setUnidadeInput([]); setBspInput([]); setFuncaoInput([]);
    setEspecialidadeInput([]); setStatusInput([]);
    setFilterColaborador([]); setFilterUnidade([]); setFilterBsp([]); setFilterFuncao([]);
    setFilterEspecialidade([]); setFilterStatus([]);
  };

  const nomesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.nome))).sort(), [registros]);
  const unidadesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.unidade).filter((v): v is string => !!v))).sort(), [registros]);
  const bspExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.bsp).filter((v): v is string => !!v))).sort(), [registros]);
  const funcoesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.funcao).filter((v): v is string => !!v))).sort(), [registros]);
  const especialidadesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.especialidade).filter((v): v is string => !!v))).sort(), [registros]);
  const statusExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.status).filter((v): v is string => !!v))).sort(), [registros]);

  const linhas = useMemo(() => {
    return registros
      .filter((r) => filterColaborador.length === 0 || filterColaborador.includes(r.nome))
      .filter((r) => filterUnidade.length === 0 || (r.unidade != null && filterUnidade.includes(r.unidade)))
      .filter((r) => filterBsp.length === 0 || (r.bsp != null && filterBsp.includes(r.bsp)))
      .filter((r) => filterFuncao.length === 0 || (r.funcao != null && filterFuncao.includes(r.funcao)))
      .filter((r) => filterEspecialidade.length === 0 || (r.especialidade != null && filterEspecialidade.includes(r.especialidade)))
      .filter((r) => filterStatus.length === 0 || (r.status != null && filterStatus.includes(r.status)))
      .sort((a, b) => {
        if (!sortColumn) return a.nome.localeCompare(b.nome, "pt-BR");
        const dir = sortDirection === "asc" ? 1 : -1;
        switch (sortColumn) {
          case "matricula": return dir * (a.matricula ?? "").localeCompare(b.matricula ?? "");
          case "nome": return dir * a.nome.localeCompare(b.nome);
          case "unidade": return dir * (a.unidade ?? "").localeCompare(b.unidade ?? "");
          case "bsp": return dir * (a.bsp ?? "").localeCompare(b.bsp ?? "");
          case "funcao": return dir * (a.funcao ?? "").localeCompare(b.funcao ?? "");
          case "especialidade": return dir * (a.especialidade ?? "").localeCompare(b.especialidade ?? "");
          case "status": return dir * (a.status ?? "").localeCompare(b.status ?? "");
          case "embarque": return dir * (a.embarque ?? "").localeCompare(b.embarque ?? "");
          case "desembarque": return dir * (a.desembarque ?? "").localeCompare(b.desembarque ?? "");
          case "folgaInicio": return dir * (a.folga_inicio ?? "").localeCompare(b.folga_inicio ?? "");
          case "folgaFim": return dir * (a.folga_fim ?? "").localeCompare(b.folga_fim ?? "");
          case "feriasInicio": return dir * (a.ferias_inicio ?? "").localeCompare(b.ferias_inicio ?? "");
          case "feriasFim": return dir * (a.ferias_fim ?? "").localeCompare(b.ferias_fim ?? "");
          default: return 0;
        }
      });
  }, [registros, filterColaborador, filterUnidade, filterBsp, filterFuncao, filterEspecialidade, filterStatus, sortColumn, sortDirection]);

  const exportarPlanejamento = () => {
    const rows = linhas.map((r) => ({
      Matrícula: r.matricula ?? "—",
      Nome: r.nome,
      "Unidade/Localização": r.unidade ?? "—",
      BSP: r.bsp ?? "—",
      Função: r.funcao ?? "—",
      Especialidade: r.especialidade ?? "—",
      Status: r.status ?? "—",
      Embarque: r.embarque ? fmtDateHeadcount(r.embarque) : "—",
      Desembarque: r.desembarque ? fmtDateHeadcount(r.desembarque) : "—",
      "Início Folga": r.folga_inicio ? fmtDateHeadcount(r.folga_inicio) : "—",
      "Fim Folga": r.folga_fim ? fmtDateHeadcount(r.folga_fim) : "—",
      "Início Férias": r.ferias_inicio ? fmtDateHeadcount(r.ferias_inicio) : "—",
      "Fim Férias": r.ferias_fim ? fmtDateHeadcount(r.ferias_fim) : "—",
    }));
    if (rows.length === 0) { notify.error("Nenhum registro pra exportar com os filtros atuais."); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planejamento de Embarque");
    XLSX.writeFile(wb, `planejamento_embarque_${todayStr()}.xlsx`);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2" onKeyDown={(e) => e.key === "Enter" && aplicarFiltro()}>
          <div className="space-y-0.5 w-56">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <StringMultiCombobox options={nomesExistentes} value={colaboradorInput} onChange={setColaboradorInput} searchPlaceholder="Buscar colaborador..." emptyLabel="Nenhum colaborador encontrado." />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <StringMultiCombobox options={unidadesExistentes} value={unidadeInput} onChange={setUnidadeInput} placeholder="Todas" searchPlaceholder="Buscar unidade..." emptyLabel="Nenhuma unidade encontrada." />
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <StringMultiCombobox options={bspExistentes} value={bspInput} onChange={setBspInput} searchPlaceholder="Buscar BSP..." emptyLabel="Nenhum BSP encontrado." />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Função</Label>
            <StringMultiCombobox options={funcoesExistentes} value={funcaoInput} onChange={setFuncaoInput} searchPlaceholder="Buscar função..." emptyLabel="Nenhuma função encontrada." />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Especialidade</Label>
            <StringMultiCombobox options={especialidadesExistentes} value={especialidadeInput} onChange={setEspecialidadeInput} placeholder="Todas" searchPlaceholder="Buscar especialidade..." emptyLabel="Nenhuma especialidade encontrada." />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
            <StringMultiCombobox options={statusExistentes} value={statusInput} onChange={setStatusInput} placeholder="Todos" searchPlaceholder="Buscar status..." emptyLabel="Nenhum status encontrado." />
          </div>
          <Button size="sm" className="h-8" onClick={aplicarFiltro}><Search className="mr-1.5 h-3.5 w-3.5" />Buscar</Button>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={limparFiltros}><X className="mr-1.5 h-3.5 w-3.5" />Limpar filtros</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={exportarPlanejamento}><Download className="mr-1.5 h-3.5 w-3.5" />Exportar</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowImportar(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Importar</Button>
          <Button size="sm" className="h-8" onClick={() => setCriando(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Novo colaborador</Button>
          <div className="flex items-center gap-1.5 rounded px-2 py-0.5 h-8 text-[11px] bg-muted border border-border/60" title="Total de registros na lista filtrada">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-bold">{linhas.length}</span>
            <span className="text-muted-foreground">colaborador(es)</span>
          </div>
          {ultimaAtualizacao && (
            <div
              className="flex items-center gap-1.5 rounded px-2 py-0.5 h-8 text-[11px] bg-muted border border-border/60"
              title={`Última atualização em ${fmtDateTime(ultimaAtualizacao.updated_at)}${primeiroNomeUltimaAtualizacao ? ` por ${primeiroNomeUltimaAtualizacao}` : ""}`}
            >
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Última atualização:</span>
              <span className="font-semibold">{fmtDateTime(ultimaAtualizacao.updated_at)}</span>
              {primeiroNomeUltimaAtualizacao && <span className="text-muted-foreground">· {primeiroNomeUltimaAtualizacao}</span>}
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Matrícula" column="matricula" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Nome" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Unidade/Localização" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Função" column="funcao" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Especialidade" column="especialidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Embarque" column="embarque" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Desembarque" column="desembarque" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Início Folga" column="folgaInicio" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Fim Folga" column="folgaFim" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Início Férias" column="feriasInicio" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Fim Férias" column="feriasFim" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-20">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.matricula ?? "—"}</TableCell>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.unidade} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { unidade: v || null } })} /></TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.bsp} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { bsp: v || null } })} /></TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.funcao} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { funcao: v || null } })} /></TableCell>
                <TableCell>{r.especialidade ?? "—"}</TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.status} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { status: v || null } })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.embarque} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { embarque: v || null } })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.desembarque} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { desembarque: v || null } })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.folga_inicio} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { folga_inicio: v || null } })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.folga_fim} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { folga_fim: v || null } })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.ferias_inicio} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { ferias_inicio: v || null } })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.ferias_fim} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { ferias_fim: v || null } })} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setExcluindo(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {linhas.length === 0 && <EmptyStateRow colSpan={14} icon={Users} title="Nenhum registro encontrado" description="Importe uma planilha ou ajuste os filtros de busca." />}
          </TableBody>
        </Table>
      </Card>

      {(editing || criando) && <PlanejamentoEditDialog row={editing} onClose={() => { setEditing(null); setCriando(false); }} />}
      {showImportar && <ImportarPlanejamentoDialog totalAtual={registros.length} onClose={() => setShowImportar(false)} />}

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir o registro de {excluindo?.nome}? Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => excluindo && excluirRegistro.mutate(excluindo.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
