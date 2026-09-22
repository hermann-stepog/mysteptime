import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabela ainda não está nos tipos gerados; cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { selectAllPages } from "@/lib/supabasePaginate";
import { normalizeHeader, parseExcelDate } from "@/lib/histograma/import-drake";
import { todayStr, addDays } from "@/lib/histogramaNovo";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { useAuth } from "@/hooks/useAuth";
import { Search, X, Download, Upload, Pencil, Trash2, Users, Plus, History, ChevronRight } from "lucide-react";

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
  duracao_embarque_dias: number | null;
  folga_inicio: string | null;
  folga_fim: string | null;
  ferias_inicio: string | null;
  ferias_fim: string | null;
  // Colunas "PROGRAMADO 1"/"PROGRAMADO 2" da planilha dela: a 1ª é sempre data, a 2ª é texto
  // livre (às vezes data, às vezes anotação tipo "BASE - HENRIQUE").
  programado_1: string | null;
  programado_2: string | null;
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

// Unidades e BSPs pra listas suspensas fora do Planejamento de Embarque (ex.: Transporte) —
// pedido dela: essas listas devem vir da planilha de Planejamento de Embarque, não mais de
// texto livre nem do Drake. "FOLGA" é um valor de preenchimento (sem embarcação real), nunca
// uma unidade operacional de verdade — mesma exclusão já usada nos gráficos de POB.
export function unidadesPlanejamento(rows: PlanejamentoEmbarqueRow[]): string[] {
  return Array.from(new Set(
    rows.map((r) => r.unidade?.trim()).filter((u): u is string => !!u && u.toUpperCase() !== "FOLGA"),
  )).sort();
}

export function bspOptionsPlanejamento(rows: PlanejamentoEmbarqueRow[], unidade: string): string[] {
  return Array.from(new Set(
    rows
      .filter((r) => !unidade || r.unidade?.trim() === unidade)
      .map((r) => r.bsp?.trim())
      .filter((b): b is string => !!b),
  )).sort();
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

// ─── Histórico de alterações (painel lateral) ───────────────────────────────────────────────
// Gravado explicitamente em cada ação (import/cadastro/edição/exclusão) em vez de gatilho no
// banco, pra descrição sair legível em português — ver migração
// 20260918140000_planejamento_embarque_log.sql.
export interface PlanejamentoEmbarqueLogRow {
  id: string;
  created_at: string;
  user_id: string | null;
  descricao: string;
}

export function usePlanejamentoEmbarqueLogQuery() {
  return useQuery<PlanejamentoEmbarqueLogRow[]>({
    queryKey: ["planejamento-embarque-log"],
    queryFn: () =>
      selectAllPages<PlanejamentoEmbarqueLogRow>((from, to) =>
        supabase.from("planejamento_embarque_log").select("*").order("created_at", { ascending: false }).range(from, to),
      ),
  });
}

// Descrição padrão de uma edição de célula (De → Para), usada nos onSave de cada coluna
// editável da tabela — data formatada quando o campo é de data, texto puro nos outros.
function descricaoEdicaoCampo(nome: string, campo: string, antigo: string | null, novo: string | null, ehData = false): string {
  const fmt = (v: string | null) => (v ? (ehData ? fmtDateHeadcount(v) : v) : "—");
  return `Editou ${campo} de ${nome}: ${fmt(antigo)} → ${fmt(novo)}`;
}

// Mesma conta que ela já fazia na planilha via fórmula (Desembarque=Embarque+N; Início
// Folga=Desembarque; Fim Folga=Início Folga+N-1) — "N" é a Duração do embarque em dias, um
// campo dela mesma preenche (não dá pra descobrir sozinho, varia pessoa a pessoa). Só calcula
// quando os dois estão preenchidos; duração de 1 dia não gera folga nenhuma (N-1=0 dias).
function calcularDatasPorDuracao(embarque: string, duracaoDias: number): { desembarque: string; folgaInicio: string; folgaFim: string } {
  const desembarque = addDays(embarque, duracaoDias);
  const folgaInicio = desembarque;
  const folgaFim = duracaoDias > 1 ? addDays(folgaInicio, duracaoDias - 1) : folgaInicio;
  return { desembarque, folgaInicio, folgaFim };
}

// Hook simples — só grava, quem chama não precisa esperar nem tratar erro (uma falha aqui não
// pode travar a ação real que originou o log). Invalida a query do log pra o painel lateral
// atualizar sozinho.
function useRegistrarLogPlanejamento() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return (descricao: string) => {
    supabase.from("planejamento_embarque_log").insert({ user_id: profile?.id ?? null, descricao })
      .then(({ error }: { error: unknown }) => {
        if (error) { console.error(error); return; }
        qc.invalidateQueries({ queryKey: ["planejamento-embarque-log"] });
      });
  };
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

// Mesmo padrão popover-com-Salvar do TextoPlanejamentoCell, mas com uma lista dos valores já
// usados na coluna (sem repetir) em vez de sempre texto livre — pedido dela pro Status. Ainda
// permite digitar um valor novo ("Outro"), já que a coluna continua sendo texto livre no fundo.
function SelectPlanejamentoCell({ valor, opcoes, onSave }: { valor: string | null; opcoes: string[]; onSave: (novoValor: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(valor ?? "");
  const [manual, setManual] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setInput(valor ?? ""); setManual(!!valor && !opcoes.includes(valor)); }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="rounded px-1.5 py-0.5 text-left hover:bg-muted">
          {valor || <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="start">
        {manual ? (
          <div className="flex gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} className="flex-1" autoFocus />
            <Button type="button" variant="outline" size="sm" onClick={() => { setManual(false); setInput(""); }}>Lista</Button>
          </div>
        ) : (
          <Select
            value={input || "__none__"}
            onValueChange={(v) => {
              if (v === "__custom__") { setManual(true); setInput(""); }
              else setInput(v === "__none__" ? "" : v);
            }}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">—</SelectItem>
              {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              <SelectItem value="__custom__">Outro (digitar)...</SelectItem>
            </SelectContent>
          </Select>
        )}
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

// Duração do embarque em dias — mesmo padrão popover-com-Salvar, número em vez de texto/data.
function NumeroPlanejamentoCell({ valor, onSave }: { valor: number | null; onSave: (novoValor: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(valor != null ? String(valor) : "");
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setInput(valor != null ? String(valor) : ""); }}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded px-1.5 py-0.5 text-left hover:bg-muted">
          {valor ?? <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 space-y-2" align="start">
        <Input type="number" min={1} value={input} onChange={(e) => setInput(e.target.value)} />
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
  const registrarLog = useRegistrarLogPlanejamento();
  // Mesma lista de Status já usados (sem repetir) da célula da tabela — reaproveita a mesma
  // consulta já em cache, sem custo extra.
  const { data: registrosTodos = [] } = usePlanejamentoEmbarqueQuery();
  const statusExistentes = useMemo(
    () => Array.from(new Set(registrosTodos.map((r) => r.status).filter((v): v is string => !!v))).sort(),
    [registrosTodos],
  );
  const [statusManual, setStatusManual] = useState(() => !!row?.status && !statusExistentes.includes(row.status));
  const [form, setForm] = useState({
    matricula: row?.matricula ?? "", nome: row?.nome ?? "", unidade: row?.unidade ?? "", bsp: row?.bsp ?? "",
    funcao: row?.funcao ?? "", especialidade: row?.especialidade ?? "", status: row?.status ?? "",
    embarque: row?.embarque ?? "", desembarque: row?.desembarque ?? "",
    duracao_embarque_dias: row?.duracao_embarque_dias != null ? String(row.duracao_embarque_dias) : "",
    folga_inicio: row?.folga_inicio ?? "", folga_fim: row?.folga_fim ?? "",
    ferias_inicio: row?.ferias_inicio ?? "", ferias_fim: row?.ferias_fim ?? "",
    programado_1: row?.programado_1 ?? "", programado_2: row?.programado_2 ?? "",
  });

  // Recalcula Desembarque/Início Folga/Fim Folga sozinho sempre que Embarque ou Duração
  // mudam (mesma fórmula da planilha dela — ver calcularDatasPorDuracao) — ela continua
  // podendo editar essas datas na mão depois, se precisar de uma exceção.
  const aplicarDuracao = (embarque: string, duracaoStr: string) => {
    const duracao = parseInt(duracaoStr, 10);
    if (!embarque || !duracaoStr || Number.isNaN(duracao) || duracao < 1) return {};
    const { desembarque, folgaInicio, folgaFim } = calcularDatasPorDuracao(embarque, duracao);
    return { desembarque, folga_inicio: folgaInicio, folga_fim: folgaFim };
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome.");
      const patch = {
        matricula: form.matricula.trim() || null, nome: form.nome.trim(),
        unidade: form.unidade.trim() || null, bsp: form.bsp.trim() || null,
        funcao: form.funcao.trim() || null, especialidade: form.especialidade.trim() || null,
        status: form.status.trim() || null,
        embarque: form.embarque || null, desembarque: form.desembarque || null,
        duracao_embarque_dias: form.duracao_embarque_dias.trim() ? parseInt(form.duracao_embarque_dias, 10) : null,
        folga_inicio: form.folga_inicio || null, folga_fim: form.folga_fim || null,
        ferias_inicio: form.ferias_inicio || null, ferias_fim: form.ferias_fim || null,
        programado_1: form.programado_1 || null, programado_2: form.programado_2.trim() || null,
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
      registrarLog(row ? `Editou registro de ${form.nome.trim()}` : `Cadastrou ${form.nome.trim()}`);
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
          <div>
            <Label className="text-xs">Status</Label>
            {statusManual ? (
              <div className="flex gap-2">
                <Input value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={() => { setStatusManual(false); setForm({ ...form, status: "" }); }}>Lista</Button>
              </div>
            ) : (
              <Select
                value={form.status || "__none__"}
                onValueChange={(v) => {
                  if (v === "__custom__") { setStatusManual(true); setForm({ ...form, status: "" }); }
                  else setForm({ ...form, status: v === "__none__" ? "" : v });
                }}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {statusExistentes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  <SelectItem value="__custom__">Outro (digitar)...</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Embarque</Label>
              <Input
                type="date" value={form.embarque}
                onChange={(e) => setForm({ ...form, embarque: e.target.value, ...aplicarDuracao(e.target.value, form.duracao_embarque_dias) })}
              />
            </div>
            <div>
              <Label className="text-xs">Duração (dias)</Label>
              <Input
                type="number" min={1} value={form.duracao_embarque_dias}
                onChange={(e) => setForm({ ...form, duracao_embarque_dias: e.target.value, ...aplicarDuracao(form.embarque, e.target.value) })}
              />
            </div>
            <div><Label className="text-xs">Desembarque</Label><Input type="date" value={form.desembarque} onChange={(e) => setForm({ ...form, desembarque: e.target.value })} /></div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">Preenchendo Embarque + Duração, Desembarque/Início Folga/Fim Folga calculam sozinhos (mesma conta da sua planilha) — dá pra ajustar na mão depois se precisar.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Início Folga</Label><Input type="date" value={form.folga_inicio} onChange={(e) => setForm({ ...form, folga_inicio: e.target.value })} /></div>
            <div><Label className="text-xs">Fim Folga</Label><Input type="date" value={form.folga_fim} onChange={(e) => setForm({ ...form, folga_fim: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Início Férias</Label><Input type="date" value={form.ferias_inicio} onChange={(e) => setForm({ ...form, ferias_inicio: e.target.value })} /></div>
            <div><Label className="text-xs">Fim Férias</Label><Input type="date" value={form.ferias_fim} onChange={(e) => setForm({ ...form, ferias_fim: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Programado 1</Label><Input type="date" value={form.programado_1} onChange={(e) => setForm({ ...form, programado_1: e.target.value })} /></div>
            <div><Label className="text-xs">Programado 2</Label><Input value={form.programado_2} onChange={(e) => setForm({ ...form, programado_2: e.target.value })} /></div>
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
  programado1: string | null; programado2: string | null;
}
interface PlanejamentoImportRejection { rowNumber: number; motivo: string }

const PLANEJAMENTO_HEADER_MAP: Record<string, keyof Omit<PlanejamentoImportRow, "rowNumber">> = {
  "matricula": "matricula",
  "chapa": "matricula",
  "re": "matricula",
  "nome": "nome",
  "colaborador": "nome",
  "nome do colaborador": "nome",
  "nome colaborador": "nome",
  "funcionario": "nome",
  "unidade": "unidade",
  "unidade/localizacao": "unidade",
  "unidade operacional": "unidade",
  "localizacao": "unidade",
  "local": "unidade",
  "bsp": "bsp",
  "projeto": "bsp",
  "funcao": "funcao",
  "cargo": "funcao",
  "especialidade": "especialidade",
  "status": "status",
  "situacao": "status",
  "embarque": "embarque",
  "data embarque": "embarque",
  "data de embarque": "embarque",
  "inicio do embarque": "embarque",
  "desembarque": "desembarque",
  "data desembarque": "desembarque",
  "data de desembarque": "desembarque",
  "fim do embarque": "desembarque",
  "inicio folga": "folgaInicio",
  "folga inicio": "folgaInicio",
  "inicio da folga": "folgaInicio",
  "fim folga": "folgaFim",
  "folga fim": "folgaFim",
  "fim da folga": "folgaFim",
  "inicio ferias": "feriasInicio",
  "ferias inicio": "feriasInicio",
  "inicio das ferias": "feriasInicio",
  "fim ferias": "feriasFim",
  "ferias fim": "feriasFim",
  "fim das ferias": "feriasFim",
  "programado 1": "programado1",
  "programado1": "programado1",
  "programado 2": "programado2",
  "programado2": "programado2",
};

// A planilha nem sempre começa o cabeçalho na primeira linha (pode ter título/logo em cima),
// então procuramos nas primeiras linhas a que realmente contém a coluna de nome.
function findHeaderRowIndex(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const normalized = (rows[i] ?? []).map(normalizeHeader);
    if (normalized.some((h) => PLANEJAMENTO_HEADER_MAP[h] === "nome")) return i;
  }
  return -1;
}

function parsePlanejamentoWorkbook(buf: ArrayBuffer): PlanejamentoImportRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) {
    const encontradas = (rows[0] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean).join(", ");
    throw new Error(
      `Coluna "Nome" não encontrada na planilha. Colunas lidas: ${encontradas || "(nenhuma)"}.`,
    );
  }

  const headerRow = rows[headerIdx].map(normalizeHeader);
  const colIndex: Partial<Record<string, number>> = {};
  headerRow.forEach((h, i) => {
    const key = PLANEJAMENTO_HEADER_MAP[h];
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });

  const get = (r: unknown[], k: string): string => {
    const i = colIndex[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };
  const getDate = (r: unknown[], k: string): string | null => {
    const i = colIndex[k];
    return i === undefined ? null : parseExcelDate(r[i]);
  };

  return rows
    .slice(headerIdx + 1)
    .map((r, idx) => ({ r, rowNumber: headerIdx + idx + 2 }))
    .filter(({ r }) => r.some((c) => String(c ?? "").trim() !== ""))
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
      programado1: getDate(r, "programado1"),
      programado2: get(r, "programado2") || null,
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
  const registrarLog = useRegistrarLogPlanejamento();
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

      // Duração (dias) já vem preenchida sozinha quando a planilha tem Embarque e Desembarque
      // — mesmo intervalo que ela hoje calcula na mão via fórmula, sem precisar retypar pra
      // quem já tinha essas duas datas na planilha.
      const linhas = aceitas.map((row) => ({
        matricula: row.matricula, nome: row.nome, unidade: row.unidade, bsp: row.bsp,
        funcao: row.funcao, especialidade: row.especialidade, status: row.status,
        embarque: row.embarque, desembarque: row.desembarque,
        duracao_embarque_dias: row.embarque && row.desembarque
          ? Math.round((new Date(`${row.desembarque}T00:00:00`).getTime() - new Date(`${row.embarque}T00:00:00`).getTime()) / 86400000)
          : null,
        folga_inicio: row.folgaInicio, folga_fim: row.folgaFim,
        ferias_inicio: row.feriasInicio, ferias_fim: row.feriasFim,
        programado_1: row.programado1, programado_2: row.programado2,

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
      registrarLog(`Importação de planilha: substituiu ${totalAtual} registro(s) atual(is) por ${r.criadas} da planilha`);
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
  | "embarque" | "duracao" | "desembarque" | "folgaInicio" | "folgaFim" | "feriasInicio" | "feriasFim"
  | "programado1" | "programado2";

export function PlanejamentoEmbarqueTab() {
  const qc = useQueryClient();
  const registrarLog = useRegistrarLogPlanejamento();
  const { data: registros = [], isLoading } = usePlanejamentoEmbarqueQuery();

  const [showImportar, setShowImportar] = useState(false);
  const [criando, setCriando] = useState(false);
  const [editing, setEditing] = useState<PlanejamentoEmbarqueRow | null>(null);
  const [excluindo, setExcluindo] = useState<PlanejamentoEmbarqueRow | null>(null);
  const [showHistorico, setShowHistorico] = useState(false);

  const updateCampo = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown>; descricao?: string }) => {
      const { error } = await supabase.from("planejamento_embarque").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
      notify.success("Atualizado");
      if (variables.descricao) registrarLog(variables.descricao);
    },
    onError: (e: any) => notify.error(e.message),
  });

  // Assim que a tela carrega, quem está "Embarcado" e já chegou (ou passou) da data de
  // Desembarque muda sozinho pra "Folga" — mesma regra Início Folga = Desembarque já usada em
  // todo o app. O campo continua editável normalmente depois (ela pode trocar na mão quando
  // quiser), isso só evita deixar "Embarcado" parado indefinidamente sem ninguém mexer. O Set
  // evita mandar o update de novo pro mesmo registro enquanto o primeiro ainda está em voo.
  const autoFolgaEmAndamento = useRef<Set<string>>(new Set());
  useEffect(() => {
    const hoje = todayStr();
    const pendentes = registros.filter((r) =>
      isStatusEmbarcado(r.status) && r.desembarque && r.desembarque <= hoje && !autoFolgaEmAndamento.current.has(r.id),
    );
    if (pendentes.length === 0) return;
    pendentes.forEach((r) => autoFolgaEmAndamento.current.add(r.id));
    (async () => {
      let ok = 0;
      for (const r of pendentes) {
        const { error } = await supabase.from("planejamento_embarque").update({ status: "FOLGA" }).eq("id", r.id);
        if (!error) {
          ok++;
          registrarLog(`${descricaoEdicaoCampo(r.nome, "Status", r.status, "FOLGA")} (automático — desembarque em ${fmtDateHeadcount(r.desembarque!)})`);
        }
      }
      if (ok > 0) {
        qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
        notify.success(`${ok} colaborador${ok > 1 ? "es" : ""} passou pra Folga automaticamente (desembarque de hoje)`);
      }
    })();
  }, [registros, qc, registrarLog]);

  const excluirRegistro = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("planejamento_embarque").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
      notify.success("Registro excluído");
      registrarLog(`Excluiu registro de ${excluindo?.nome ?? ""}`);
      setExcluindo(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  // Histórico de alterações (painel lateral) — data/hora, o que mudou e quem mudou, gravado
  // explicitamente em cada ação (ver useRegistrarLogPlanejamento). O indicador do cabeçalho
  // mostra só a entrada mais recente; o painel lateral (seta ao lado) mostra tudo.
  const { data: logEntries = [] } = usePlanejamentoEmbarqueLogQuery();
  const logUserIds = useMemo(
    () => Array.from(new Set(logEntries.map((l) => l.user_id).filter((id): id is string => !!id))),
    [logEntries],
  );
  const { data: logPerfis = [] } = useQuery({
    queryKey: ["planejamento-embarque-log-perfis", logUserIds],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", logUserIds);
      if (error) throw error;
      return data as { id: string; full_name: string | null }[];
    },
    enabled: logUserIds.length > 0,
  });
  const nomePorUserId = useMemo(() => new Map(logPerfis.map((p) => [p.id, p.full_name])), [logPerfis]);
  const primeiroNome = (nomeCompleto: string | null | undefined) => nomeCompleto?.trim().split(/\s+/)[0] ?? null;
  const ultimaAtualizacao = logEntries[0] ?? null;

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

  // Base sem o filtro de Status: é a partir dela que os cartões contam cada status, senão
  // ao clicar num cartão todos os outros zerariam.
  const linhasSemStatus = useMemo(() => {
    return registros
      .filter((r) => filterColaborador.length === 0 || filterColaborador.includes(r.nome))
      .filter((r) => filterUnidade.length === 0 || (r.unidade != null && filterUnidade.includes(r.unidade)))
      .filter((r) => filterBsp.length === 0 || (r.bsp != null && filterBsp.includes(r.bsp)))
      .filter((r) => filterFuncao.length === 0 || (r.funcao != null && filterFuncao.includes(r.funcao)))
      .filter((r) => filterEspecialidade.length === 0 || (r.especialidade != null && filterEspecialidade.includes(r.especialidade)));
  }, [registros, filterColaborador, filterUnidade, filterBsp, filterFuncao, filterEspecialidade]);

  const contagemStatus = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const r of linhasSemStatus) {
      const chave = (r.status ?? "").trim() || "Sem status";
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return Array.from(mapa.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  }, [linhasSemStatus]);

  const linhas = useMemo(() => {
    // Vazios sempre no fim, independente da direção da ordenação.
    const cmp = (av: string | null | undefined, bv: string | null | undefined, dir: number) => {
      const a = (av ?? "").trim();
      const b = (bv ?? "").trim();
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return dir * a.localeCompare(b, "pt-BR");
    };
    return linhasSemStatus
      .filter((r) => filterStatus.length === 0 || (r.status != null && filterStatus.includes(r.status)))
      .sort((a, b) => {
        if (!sortColumn) return a.nome.localeCompare(b.nome, "pt-BR");
        const dir = sortDirection === "asc" ? 1 : -1;
        switch (sortColumn) {
          case "matricula": return cmp(a.matricula, b.matricula, dir);
          case "nome": return cmp(a.nome, b.nome, dir);
          case "unidade": return cmp(a.unidade, b.unidade, dir);
          case "bsp": return cmp(a.bsp, b.bsp, dir);
          case "funcao": return cmp(a.funcao, b.funcao, dir);
          case "especialidade": return cmp(a.especialidade, b.especialidade, dir);
          case "status": return cmp(a.status, b.status, dir);
          case "embarque": return cmp(a.embarque, b.embarque, dir);
          case "duracao": {
            if (a.duracao_embarque_dias == null && b.duracao_embarque_dias == null) return 0;
            if (a.duracao_embarque_dias == null) return 1;
            if (b.duracao_embarque_dias == null) return -1;
            return dir * (a.duracao_embarque_dias - b.duracao_embarque_dias);
          }
          case "desembarque": return cmp(a.desembarque, b.desembarque, dir);
          case "folgaInicio": return cmp(a.folga_inicio, b.folga_inicio, dir);
          case "folgaFim": return cmp(a.folga_fim, b.folga_fim, dir);
          case "feriasInicio": return cmp(a.ferias_inicio, b.ferias_inicio, dir);
          case "feriasFim": return cmp(a.ferias_fim, b.ferias_fim, dir);
          case "programado1": return cmp(a.programado_1, b.programado_1, dir);
          case "programado2": return cmp(a.programado_2, b.programado_2, dir);
          default: return 0;
        }
      });
  }, [linhasSemStatus, filterStatus, sortColumn, sortDirection]);


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
      "Duração (dias)": r.duracao_embarque_dias ?? "—",
      Desembarque: r.desembarque ? fmtDateHeadcount(r.desembarque) : "—",
      "Início Folga": r.folga_inicio ? fmtDateHeadcount(r.folga_inicio) : "—",
      "Fim Folga": r.folga_fim ? fmtDateHeadcount(r.folga_fim) : "—",
      "Programado 1": r.programado_1 ? fmtDateHeadcount(r.programado_1) : "—",
      "Programado 2": r.programado_2 ?? "—",
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
            <button
              type="button"
              onClick={() => setShowHistorico(true)}
              className="flex items-center gap-1.5 rounded px-2 py-0.5 h-8 text-[11px] bg-muted border border-border/60 hover:bg-muted/70"
              title={`Última atualização em ${fmtDateTime(ultimaAtualizacao.created_at)}${primeiroNome(nomePorUserId.get(ultimaAtualizacao.user_id ?? "")) ? ` por ${primeiroNome(nomePorUserId.get(ultimaAtualizacao.user_id ?? ""))}` : ""} — clique pra ver o histórico completo`}
            >
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Última atualização:</span>
              <span className="font-semibold">{fmtDateTime(ultimaAtualizacao.created_at)}</span>
              {primeiroNome(nomePorUserId.get(ultimaAtualizacao.user_id ?? "")) && (
                <span className="text-muted-foreground">· {primeiroNome(nomePorUserId.get(ultimaAtualizacao.user_id ?? ""))}</span>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </Card>

      <Sheet open={showHistorico} onOpenChange={setShowHistorico}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Histórico de alterações</SheetTitle>
            <SheetDescription>Planejamento de Embarque — mais recente primeiro.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {logEntries.length === 0 ? (
              <EmptyState icon={History} title="Nenhuma alteração registrada ainda" />
            ) : (
              logEntries.map((l) => (
                <div key={l.id} className="rounded-md border p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{fmtDateTime(l.created_at)}</span>
                    <span className="font-medium">{primeiroNome(nomePorUserId.get(l.user_id ?? "")) ?? "—"}</span>
                  </div>
                  <p className="mt-1">{l.descricao}</p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {contagemStatus.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {contagemStatus.map(([status, total]) => {
            const ativo = filterStatus.includes(status);
            return (
              <Card
                key={status}
                role="button"
                tabIndex={0}
                onClick={() => {
                  const novo = ativo ? filterStatus.filter((s) => s !== status) : [...filterStatus, status];
                  setFilterStatus(novo);
                  setStatusInput(novo);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
                className={`cursor-pointer p-3 transition-colors hover:bg-muted/60 ${ativo ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate" title={status}>{status}</div>
                <div className="text-xl font-bold tabular-nums">{total}</div>
              </Card>
            );
          })}
        </div>
      )}



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
              <SortableHead label="Duração (dias)" column="duracao" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Desembarque" column="desembarque" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Início Folga" column="folgaInicio" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Fim Folga" column="folgaFim" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Programado 1" column="programado1" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Programado 2" column="programado2" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
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
                <TableCell><TextoPlanejamentoCell valor={r.unidade} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { unidade: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Unidade", r.unidade, v || null) })} /></TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.bsp} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { bsp: v || null }, descricao: descricaoEdicaoCampo(r.nome, "BSP", r.bsp, v || null) })} /></TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.funcao} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { funcao: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Função", r.funcao, v || null) })} /></TableCell>
                <TableCell>{r.especialidade ?? "—"}</TableCell>
                <TableCell><SelectPlanejamentoCell valor={r.status} opcoes={statusExistentes} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { status: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Status", r.status, v || null) })} /></TableCell>
                <TableCell>
                  <DataPlanejamentoCell
                    valor={r.embarque}
                    onSave={(v) => {
                      const patch: Record<string, unknown> = { embarque: v || null };
                      let descricao = descricaoEdicaoCampo(r.nome, "Embarque", r.embarque, v || null, true);
                      if (v && r.duracao_embarque_dias) {
                        const { desembarque, folgaInicio, folgaFim } = calcularDatasPorDuracao(v, r.duracao_embarque_dias);
                        Object.assign(patch, { desembarque, folga_inicio: folgaInicio, folga_fim: folgaFim });
                        descricao = `Editou Embarque de ${r.nome}: ${r.embarque ? fmtDateHeadcount(r.embarque) : "—"} → ${fmtDateHeadcount(v)} (recalculou Desembarque/Folga pela Duração)`;
                      }
                      updateCampo.mutate({ id: r.id, patch, descricao });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <NumeroPlanejamentoCell
                    valor={r.duracao_embarque_dias}
                    onSave={(v) => {
                      const duracao = parseInt(v, 10);
                      const duracaoValida = v.trim() !== "" && !Number.isNaN(duracao) && duracao >= 1;
                      const patch: Record<string, unknown> = { duracao_embarque_dias: duracaoValida ? duracao : null };
                      let descricao = descricaoEdicaoCampo(r.nome, "Duração (dias)", r.duracao_embarque_dias != null ? String(r.duracao_embarque_dias) : null, duracaoValida ? String(duracao) : null);
                      if (r.embarque && duracaoValida) {
                        const { desembarque, folgaInicio, folgaFim } = calcularDatasPorDuracao(r.embarque, duracao);
                        Object.assign(patch, { desembarque, folga_inicio: folgaInicio, folga_fim: folgaFim });
                        descricao = `Editou Duração de ${r.nome}: ${r.duracao_embarque_dias ?? "—"} → ${duracao} dia(s) (recalculou Desembarque/Folga)`;
                      }
                      updateCampo.mutate({ id: r.id, patch, descricao });
                    }}
                  />
                </TableCell>
                <TableCell><DataPlanejamentoCell valor={r.desembarque} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { desembarque: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Desembarque", r.desembarque, v || null, true) })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.folga_inicio} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { folga_inicio: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Início Folga", r.folga_inicio, v || null, true) })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.folga_fim} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { folga_fim: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Fim Folga", r.folga_fim, v || null, true) })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.programado_1} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { programado_1: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Programado 1", r.programado_1, v || null, true) })} /></TableCell>
                <TableCell><TextoPlanejamentoCell valor={r.programado_2} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { programado_2: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Programado 2", r.programado_2, v || null) })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.ferias_inicio} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { ferias_inicio: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Início Férias", r.ferias_inicio, v || null, true) })} /></TableCell>
                <TableCell><DataPlanejamentoCell valor={r.ferias_fim} onSave={(v) => updateCampo.mutate({ id: r.id, patch: { ferias_fim: v || null }, descricao: descricaoEdicaoCampo(r.nome, "Fim Férias", r.ferias_fim, v || null, true) })} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setExcluindo(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {linhas.length === 0 && <EmptyStateRow colSpan={17} icon={Users} title="Nenhum registro encontrado" description="Importe uma planilha ou ajuste os filtros de busca." />}
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
