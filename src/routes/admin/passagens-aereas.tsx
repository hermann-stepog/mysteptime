import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { matchesNameSearch } from "@/lib/utils";
// passagens_aereas ainda não está nos tipos gerados (mesmo padrão de hospedagem.tsx/
// nominations.tsx) — cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyStateRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { NomeUsuarioField, NomeUsuarioMultiField, BspMultiField, MotivoField, useRateioComplementar, usePessoasAdicionais, useUnidadesAdicionais, UnidadeMultiField, FormaPagamentoField } from "@/components/LogisticaFormFields";
import {
  Plane, Plus, Pencil, Trash2, BedDouble, ListChecks, AlertTriangle,
  Globe2, Check, Upload, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Building2, Ship, Layers3,
} from "lucide-react";
import { clienteDaUnidade } from "@/lib/clientes";
import {
  parsePlanilhaCustos, parseCustoBRL, parseDataBR, parseUnidadeBsp, splitNomes,
  parseBooleanoSN, parseBooleanoSimNao, parseCheckOutDeObservacao, type LinhaCustoBruta,
} from "@/lib/importCustos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/lib/notify";
import { pageTitle } from "@/lib/pageTitle";
import { cn } from "@/lib/utils";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, todayStr, addDays, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import {
  TIPOS_PASSAGEM, STATUS_PASSAGEM, STATUS_FLUXO_ORDER, STATUS_FLUXO_LABEL, STATUS_FLUXO_COLOR,
  STATUS_FLUXO_RESPONSAVEL, STATUS_FLUXO_PROXIMA_ACAO,
  type PassagemAerea, type PassagemOpcao, type PassagemStatusHistory, type StatusFluxo,
} from "@/lib/passagensAereas";
import { notifyPassagemStageAdvance } from "@/lib/passagemEmails";
import { useAuth } from "@/hooks/useAuth";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { AeroportoSelect } from "@/components/AeroportoSelect";

export const Route = createFileRoute("/admin/passagens-aereas")({ head: () => pageTitle("Passagens Aéreas"), component: PassagensAereasPage });

function fmt(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_BADGE: Record<string, "default" | "destructive" | "secondary"> = {
  Confirmada: "default", Cancelada: "destructive", Remarcada: "secondary",
};

type PassagensSortColumn = "unidade" | "bsp" | "nome" | "companhia" | "origemDestino" | "ida" | "volta" | "tipo" | "valor" | "status" | "motivo";

// Ordem de prioridade lógica do status (não alfabética) — Confirmada (ativa) antes de
// Remarcada, e Cancelada (estado terminal) por último.
const STATUS_PASSAGEM_ORDER: Record<string, number> = { Confirmada: 0, Remarcada: 1, Cancelada: 2 };

function usePassagensQuery() {
  return useQuery<PassagemAerea[]>({
    queryKey: ["passagens-aereas"],
    queryFn: () => selectAllPages<PassagemAerea>((from, to) =>
      supabase.from("passagens_aereas").select("*").order("data_ida", { ascending: false }).order("id").range(from, to),
    ),
    // Mesmo padrão de atualização automática do Transporte (SolicitacoesTab) — sem Realtime,
    // só uma checagem periódica, pra tela do fluxo de aprovação não ficar parada.
    refetchInterval: 10000,
  });
}

function usePeriodosEQuery() {
  return useQuery<HistNovoPeriodo[]>({
    queryKey: ["hist-novo-periodos"],
    queryFn: () => selectAllPages<HistNovoPeriodo>((from, to) =>
      supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to),
    ),
  });
}

interface ColaboradorBasico { id: string; nome: string; funcao: string | null; funcao_operacao: string | null; }
function useColaboradoresQuery() {
  return useQuery<ColaboradorBasico[]>({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: () => selectAllPages<ColaboradorBasico>((from, to) =>
      supabase.from("hist_novo_colaboradores").select("id, nome, funcao, funcao_operacao").order("nome").range(from, to),
    ),
  });
}

const FORM_VAZIO = {
  unidade: "", bsp: "", nomeUsuario: "", companhiaAerea: "", origem: "", destino: "",
  dataIda: "", dataVolta: "", tipo: "Ida e Volta", valor: "", status: "Confirmada",
  motivo: "", motivoCancelamento: "", formaPagamento: "", observacoes: "",
  solicitante: "", solicitanteEmail: "", internacional: false,
};

// ─── Dialog: Nova passagem / Editar ─────────────────────────────────────────
function PassagemDialog({ open, onOpenChange, editing, periodosE, colaboradores, unidadeOptions }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: PassagemAerea | null;
  periodosE: HistNovoPeriodo[]; colaboradores: { id: string; nome: string }[]; unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(FORM_VAZIO);
  const [bound, setBound] = useState<string | null>(null);
  const valorPassagem = Number(f.valor) || 0;
  const rateio = useRateioComplementar(valorPassagem);
  const pessoas = usePessoasAdicionais();
  const unidades = useUnidadesAdicionais();

  if (open && editing && bound !== editing.id) {
    setF({
      unidade: editing.unidade, bsp: editing.bsp, nomeUsuario: editing.nome_usuario,
      companhiaAerea: editing.companhia_aerea ?? "", origem: editing.origem ?? "", destino: editing.destino ?? "",
      dataIda: editing.data_ida, dataVolta: editing.data_volta ?? "", tipo: editing.tipo,
      valor: String(editing.valor), status: editing.status, motivo: editing.motivo ?? "",
      motivoCancelamento: editing.motivo_cancelamento ?? "", formaPagamento: editing.forma_pagamento ?? "",
      observacoes: editing.observacoes ?? "",
      solicitante: editing.solicitante ?? "", solicitanteEmail: editing.solicitante_email ?? "",
      internacional: editing.internacional ?? false,
    });
    // Reconstrói o percentual a partir do valor já gravado (o que fica salvo é sempre o
    // valor calculado, o percentual é só conveniência de preenchimento — ver useRateioComplementar).
    const totalEditado = editing.valor || 0;
    if (editing.bsp_2 && editing.valor_2 && totalEditado > 0) {
      rateio.setAtivo(true); rateio.setBsp2(editing.bsp_2); rateio.setPercentual2(String(Math.round((editing.valor_2 / totalEditado) * 10000) / 100));
    }
    if (editing.bsp_3 && editing.valor_3 && totalEditado > 0) {
      rateio.setAtivo(true); rateio.setBsp3(editing.bsp_3); rateio.setPercentual3(String(Math.round((editing.valor_3 / totalEditado) * 10000) / 100));
    }
    setBound(editing.id);
  }
  if (open && !editing && bound !== "novo") { setF(FORM_VAZIO); rateio.reset(); pessoas.reset(); unidades.reset(); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, f.unidade || "all"), [periodosE, f.unidade]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.unidade) throw new Error("Selecione a unidade.");
      if (!f.bsp) throw new Error("Selecione o BSP.");
      if (!f.nomeUsuario.trim()) throw new Error("Informe o nome de quem vai utilizar.");
      if (!f.dataIda) throw new Error("Informe a data de ida.");
      if (!f.valor) throw new Error("Informe o valor.");
      const payload = {
        unidade: f.unidade, bsp: f.bsp, nome_usuario: f.nomeUsuario.trim(),
        companhia_aerea: f.companhiaAerea.trim() || null, origem: f.origem.trim() || null, destino: f.destino.trim() || null,
        data_ida: f.dataIda, data_volta: f.dataVolta || null, tipo: f.tipo, valor: valorPassagem,
        status: f.status, motivo: f.motivo.trim() || null,
        motivo_cancelamento: f.status === "Cancelada" ? (f.motivoCancelamento.trim() || null) : null,
        forma_pagamento: f.formaPagamento || null,
        observacoes: f.observacoes.trim() || null,
        solicitante: f.solicitante.trim() || null, solicitante_email: f.solicitanteEmail.trim() || null,
        internacional: f.internacional,
        bsp_2: rateio.ativo && rateio.bsp2.trim() ? rateio.bsp2.trim() : null,
        bsp_3: rateio.ativo && rateio.bsp3.trim() ? rateio.bsp3.trim() : null,
        valor_2: rateio.ativo && rateio.bsp2.trim() ? rateio.valor2 : null,
        valor_3: rateio.ativo && rateio.bsp3.trim() ? rateio.valor3 : null,
      };
      if (editing) {
        const { error } = await supabase.from("passagens_aereas").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        // Solicitação nova sempre entra no início do fluxo — status_fluxo default do banco
        // ("emitida") é só pra registro histórico lançado direto, não pra quem passa por aqui.
        // Um lançamento por passageiro: o principal + cada colaborador adicional (unidade/BSP
        // próprios quando informados, senão herdando os do formulário).
        const base = { ...payload, status_fluxo: "solicitada" };
        const linhas = [base, ...pessoas.validas.map((p) => ({
          ...base,
          nome_usuario: p.nome.trim(),
          unidade: p.unidade || base.unidade,
          bsp: p.bsp || base.bsp,
        })), ...unidades.validas.map((u) => ({
          ...base,
          unidade: u.unidade,
          bsp: u.bsp || base.bsp,
        }))];
        const { error } = await supabase.from("passagens_aereas").insert(linhas);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagens-aereas"] });
      notify.success(editing ? "Passagem atualizada" : `${1 + pessoas.validas.length + unidades.validas.length} passagem(ns) lançada(s)`);
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{editing ? "Editar passagem" : "Nova passagem"}</DialogTitle></DialogHeader>
        <div className="-mr-2 grid gap-3 overflow-y-auto pr-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Motivo</Label>
              <MotivoField value={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} />
            </div>
            <div>
              <Label className="text-xs">Forma de pagamento</Label>
              <FormaPagamentoField value={f.formaPagamento} onChange={(v) => setF({ ...f, formaPagamento: v })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Solicitante</Label>
              <Input value={f.solicitante} onChange={(e) => setF({ ...f, solicitante: e.target.value })} placeholder="Quem está pedindo" />
            </div>
            <div>
              <Label className="text-xs">E-mail do solicitante (opcional)</Label>
              <Input type="email" value={f.solicitanteEmail} onChange={(e) => setF({ ...f, solicitanteEmail: e.target.value })} placeholder="Pra avisar a cada etapa" />
            </div>
          </div>
          <NomeUsuarioMultiField
            label="Colaborador (quem vai viajar)"
            value={f.nomeUsuario} onChange={(v) => setF({ ...f, nomeUsuario: v })}
            colaboradores={colaboradores} extras={pessoas} permiteAdicionar={!editing}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.internacional} onChange={(e) => setF({ ...f, internacional: e.target.checked })} />
            Viagem internacional (entra no Relatório de Viagens)
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Companhia aérea</Label>
              <Input value={f.companhiaAerea} onChange={(e) => setF({ ...f, companhiaAerea: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Aeroporto de origem</Label>
              <AeroportoSelect value={f.origem} onValueChange={(v) => setF({ ...f, origem: v })} placeholder="Selecionar aeroporto" />
            </div>
            <div>
              <Label className="text-xs">Aeroporto de destino</Label>
              <AeroportoSelect value={f.destino} onValueChange={(v) => setF({ ...f, destino: v })} placeholder="Selecionar aeroporto" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Data de ida</Label>
              <Input type="date" value={f.dataIda} onChange={(e) => setF({ ...f, dataIda: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Data de volta (opcional)</Label>
              <Input type="date" value={f.dataVolta} onChange={(e) => setF({ ...f, dataVolta: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS_PASSAGEM.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor</Label>
              <Input type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_PASSAGEM.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UnidadeMultiField
              value={f.unidade} onChange={(v) => setF({ ...f, unidade: v, bsp: "" })}
              options={unidadeOptions} extras={unidades} permiteAdicionar={!editing}
              bspOptionsFor={(u) => bspOptionsForUnidade(periodosE, u || "all")}
            />
            <BspMultiField
              value={f.bsp} onChange={(v) => setF({ ...f, bsp: v })}
              options={bspOptions} disabled={!f.unidade} rateio={rateio}
            />
          </div>
          {f.status === "Cancelada" && (
            <div>
              <Label className="text-xs">Motivo do cancelamento</Label>
              <Input value={f.motivoCancelamento} onChange={(e) => setF({ ...f, motivoCancelamento: e.target.value })} />
            </div>
          )}
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => salvar.mutate()} loading={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: Gerenciar fluxo da solicitação ─────────────────────────────────
function useOpcoesQuery(passagemId: string | null) {
  return useQuery<PassagemOpcao[]>({
    queryKey: ["passagem-opcoes", passagemId],
    enabled: !!passagemId,
    queryFn: () => selectAllPages<PassagemOpcao>((from, to) =>
      supabase.from("passagem_opcoes").select("*").eq("passagem_id", passagemId).order("numero").range(from, to),
    ),
  });
}

function useHistoricoQuery(passagemId: string | null) {
  return useQuery<PassagemStatusHistory[]>({
    queryKey: ["passagem-historico", passagemId],
    enabled: !!passagemId,
    queryFn: () => selectAllPages<PassagemStatusHistory>((from, to) =>
      supabase.from("passagem_status_history").select("*").eq("passagem_id", passagemId).order("changed_at", { ascending: false }).range(from, to),
    ),
  });
}

const OPCAO_VAZIA = { companhia: "", voo: "", dataHoraIda: "", bagagem: "", valor: "", valorAlteracao: "" };

// Card comparativo de opção de voo — usado tanto pra só exibir quanto (durante "aguardando
// aprovação") como alvo clicável de seleção, pra não duplicar a mesma opção em duas listas
// diferentes (lista + rádio) como antes.
function OpcaoCard({ o, selecionavel, selecionada, onSelect, onDelete }: {
  o: PassagemOpcao; selecionavel?: boolean; selecionada?: boolean;
  onSelect?: () => void; onDelete?: () => void;
}) {
  return (
    <div
      onClick={selecionavel ? onSelect : undefined}
      className={cn(
        "relative flex flex-col gap-1 rounded-lg border p-3 pr-8 text-xs transition-colors",
        selecionavel && "cursor-pointer hover:border-primary/50",
        selecionada && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      {selecionada && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Opção {o.numero}</span>
      <span className="text-sm font-semibold">{o.companhia || "Companhia não informada"}{o.voo && ` · ${o.voo}`}</span>
      {o.data_hora_ida && (
        <span className="text-muted-foreground">
          {new Date(o.data_hora_ida).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
      {o.bagagem && <span className="text-muted-foreground">Bagagem: {o.bagagem}</span>}
      <span className="mt-1 text-base font-bold text-foreground">{o.valor != null ? fmtMoney(o.valor) : "—"}</span>
      {o.valor_alteracao != null && <span className="text-muted-foreground">Alteração: {fmtMoney(o.valor_alteracao)}</span>}
      {onDelete && (
        <Button
          variant="ghost" size="icon" className="absolute bottom-1 right-1 h-6 w-6"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function GerenciarFluxoDialog({ passagem, open, onOpenChange }: {
  passagem: PassagemAerea | null; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const displayName = profile?.full_name || profile?.email || "Usuário";
  const passagemId = passagem?.id ?? null;

  const { data: opcoes = [] } = useOpcoesQuery(passagemId);
  const { data: historico = [] } = useHistoricoQuery(passagemId);

  const [textoAgencia, setTextoAgencia] = useState("");
  const [novaOpcao, setNovaOpcao] = useState(OPCAO_VAZIA);
  const [opcaoSelecionada, setOpcaoSelecionada] = useState<string>("");
  const [comentario, setComentario] = useState("");
  const [precoConfirmado, setPrecoConfirmado] = useState(true);
  const [diferencaPreco, setDiferencaPreco] = useState("");
  const [bound, setBound] = useState<string | null>(null);

  if (open && passagem && bound !== passagem.id) {
    setTextoAgencia(passagem.opcoes_texto_agencia ?? "");
    setOpcaoSelecionada(passagem.opcao_escolhida_id ?? "");
    setComentario(""); setPrecoConfirmado(true); setDiferencaPreco(""); setNovaOpcao(OPCAO_VAZIA);
    setBound(passagem.id);
  }
  if (!open && bound !== null) setBound(null);

  const salvarTexto = useMutation({
    mutationFn: async () => {
      if (!passagem) return;
      const { error } = await supabase.from("passagens_aereas").update({ opcoes_texto_agencia: textoAgencia.trim() || null }).eq("id", passagem.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passagens-aereas"] }),
    onError: (e: any) => notify.error(e.message),
  });

  const adicionarOpcao = useMutation({
    mutationFn: async () => {
      if (!passagem) return;
      const { error } = await supabase.from("passagem_opcoes").insert({
        passagem_id: passagem.id, numero: opcoes.length + 1,
        companhia: novaOpcao.companhia.trim() || null, voo: novaOpcao.voo.trim() || null,
        data_hora_ida: novaOpcao.dataHoraIda || null, bagagem: novaOpcao.bagagem.trim() || null,
        valor: novaOpcao.valor ? Number(novaOpcao.valor) : null,
        valor_alteracao: novaOpcao.valorAlteracao ? Number(novaOpcao.valorAlteracao) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagem-opcoes", passagemId] });
      setNovaOpcao(OPCAO_VAZIA);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const excluirOpcao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("passagem_opcoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passagem-opcoes", passagemId] }),
    onError: (e: any) => notify.error(e.message),
  });

  const avancar = useMutation({
    mutationFn: async ({ novoStatus, extra, notes }: { novoStatus: StatusFluxo; extra?: Record<string, unknown>; notes?: string }) => {
      if (!passagem) return;
      const { error } = await supabase.from("passagens_aereas").update({ status_fluxo: novoStatus, ...extra }).eq("id", passagem.id);
      if (error) throw error;
      const { error: he } = await supabase.from("passagem_status_history").insert({
        passagem_id: passagem.id, status: novoStatus, changed_by_name: displayName, notes: notes || null,
      });
      if (he) throw he;
      await notifyPassagemStageAdvance({ ...passagem, ...extra, status_fluxo: novoStatus } as PassagemAerea, novoStatus, notes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagens-aereas"] });
      qc.invalidateQueries({ queryKey: ["passagem-historico", passagemId] });
      notify.success("Etapa atualizada");
      setComentario("");
    },
    onError: (e: any) => notify.error(e.message),
  });

  if (!passagem) return null;
  const status = passagem.status_fluxo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Solicitação — {passagem.nome_usuario}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {passagem.unidade} · BSP {passagem.bsp} · {passagem.origem ?? "—"} → {passagem.destino ?? "—"}
            {passagem.data_ida && ` · ${fmt(passagem.data_ida)}`}
          </p>

          {/* Barra de etapas — stepper com conector, etapas concluídas marcadas com check */}
          <div className="flex items-start">
            {STATUS_FLUXO_ORDER.map((s, i) => {
              const idxAtual = STATUS_FLUXO_ORDER.indexOf(status);
              const idxEsta = i;
              const atual = idxEsta === idxAtual;
              const passada = idxEsta < idxAtual;
              return (
                <div key={s} className="flex flex-1 flex-col items-center last:flex-none">
                  <div className="flex w-full items-center">
                    <div
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        atual ? `${STATUS_FLUXO_COLOR[s].bg} ${STATUS_FLUXO_COLOR[s].text} ring-2 ring-offset-1 ring-current`
                          : passada ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground/60",
                      )}
                    >
                      {passada ? <Check className="h-3 w-3" /> : i + 1}
                    </div>
                    {i < STATUS_FLUXO_ORDER.length - 1 && (
                      <div className={cn("mx-1 h-0.5 flex-1", passada ? "bg-emerald-600" : "bg-muted")} />
                    )}
                  </div>
                  <span className={cn("mt-1 max-w-16 text-center text-[10px] leading-tight", atual ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {STATUS_FLUXO_LABEL[s]}
                  </span>
                </div>
              );
            })}
          </div>

          {status !== "concluida" && (
            <p className="text-xs text-muted-foreground">
              Responsável agora: <strong className="text-foreground">{STATUS_FLUXO_RESPONSAVEL[status]}</strong>
              {" · "}Próxima ação: {STATUS_FLUXO_PROXIMA_ACAO[status]}
            </p>
          )}

          {/* Opções da agência */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opções da agência</p>
            <div>
              <Label className="text-xs">Texto colado (e-mail/WhatsApp) — fica guardado do jeito que veio</Label>
              <Textarea rows={4} value={textoAgencia} onChange={(e) => setTextoAgencia(e.target.value)} onBlur={() => salvarTexto.mutate()} placeholder="Cole aqui o texto recebido da agência..." />
            </div>

            {opcoes.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {opcoes.map((o) => (
                  <OpcaoCard
                    key={o.id} o={o}
                    selecionavel={status === "aguardando_aprovacao"}
                    selecionada={opcaoSelecionada === o.id}
                    onSelect={() => setOpcaoSelecionada(o.id)}
                    onDelete={status === "solicitada" || status === "cotacao_recebida" ? () => excluirOpcao.mutate(o.id) : undefined}
                  />
                ))}
              </div>
            )}

            {(status === "solicitada" || status === "cotacao_recebida") && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Input className="h-8 text-xs" placeholder="Companhia" value={novaOpcao.companhia} onChange={(e) => setNovaOpcao({ ...novaOpcao, companhia: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="Voo" value={novaOpcao.voo} onChange={(e) => setNovaOpcao({ ...novaOpcao, voo: e.target.value })} />
                <Input className="h-8 text-xs" type="datetime-local" value={novaOpcao.dataHoraIda} onChange={(e) => setNovaOpcao({ ...novaOpcao, dataHoraIda: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="Bagagem" value={novaOpcao.bagagem} onChange={(e) => setNovaOpcao({ ...novaOpcao, bagagem: e.target.value })} />
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="Valor" value={novaOpcao.valor} onChange={(e) => setNovaOpcao({ ...novaOpcao, valor: e.target.value })} />
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="Valor de alteração" value={novaOpcao.valorAlteracao} onChange={(e) => setNovaOpcao({ ...novaOpcao, valorAlteracao: e.target.value })} />
                <Button size="sm" variant="outline" className="col-span-2 sm:col-span-3" onClick={() => adicionarOpcao.mutate()} loading={adicionarOpcao.isPending}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar opção
                </Button>
              </div>
            )}
          </div>

          {/* Ações por etapa */}
          {status === "solicitada" && (
            <Button size="sm" disabled={opcoes.length === 0} onClick={() => avancar.mutate({ novoStatus: "cotacao_recebida" })} loading={avancar.isPending}>
              Marcar cotação recebida
            </Button>
          )}

          {status === "cotacao_recebida" && (
            <Button size="sm" disabled={opcoes.length === 0} onClick={() => avancar.mutate({ novoStatus: "aguardando_aprovacao" })} loading={avancar.isPending}>
              Enviar para aprovação
            </Button>
          )}

          {status === "aguardando_aprovacao" && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aprovação do solicitante</p>
              <p className="text-xs text-muted-foreground">Clique numa opção acima pra selecioná-la.</p>
              <Textarea rows={2} placeholder="Comentário (opcional)" value={comentario} onChange={(e) => setComentario(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm" disabled={!opcaoSelecionada}
                  onClick={() => avancar.mutate({ novoStatus: "aguardando_revalidacao", extra: { opcao_escolhida_id: opcaoSelecionada, aprovado_por: displayName, aprovado_em: new Date().toISOString(), comentario_aprovacao: comentario.trim() || null }, notes: comentario })}
                >
                  Aprovar opção selecionada
                </Button>
                <Button size="sm" variant="outline" onClick={() => avancar.mutate({ novoStatus: "cotacao_recebida", notes: comentario || "Rejeitada pelo solicitante" })}>
                  Rejeitar
                </Button>
                <Button size="sm" variant="outline" onClick={() => avancar.mutate({ novoStatus: "cotacao_recebida", notes: comentario || "Solicitante pediu novas opções" })}>
                  Pedir novas opções
                </Button>
              </div>
            </div>
          )}

          {status === "aguardando_revalidacao" && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revalidação com a agência</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={precoConfirmado} onChange={(e) => setPrecoConfirmado(e.target.checked)} />
                Valor e disponibilidade confirmados, sem alteração
              </label>
              {!precoConfirmado && (
                <div className="w-40">
                  <Label className="text-xs">Diferença de preço</Label>
                  <Input type="number" step="0.01" value={diferencaPreco} onChange={(e) => setDiferencaPreco(e.target.value)} />
                </div>
              )}
              <Button
                size="sm"
                onClick={() => {
                  if (precoConfirmado) {
                    avancar.mutate({ novoStatus: "aguardando_emissao", extra: { revalidado_por: displayName, revalidado_em: new Date().toISOString(), diferenca_preco: 0 } });
                  } else {
                    avancar.mutate({
                      novoStatus: "aguardando_aprovacao",
                      extra: { revalidado_por: displayName, revalidado_em: new Date().toISOString(), diferenca_preco: Number(diferencaPreco) || 0 },
                      notes: `Preço aumentou em ${fmtMoney(Number(diferencaPreco) || 0)} — nova aprovação necessária`,
                    });
                  }
                }}
                loading={avancar.isPending}
              >
                Confirmar revalidação
              </Button>
            </div>
          )}

          {status === "aguardando_emissao" && (
            <Button size="sm" onClick={() => avancar.mutate({ novoStatus: "emitida" })} loading={avancar.isPending}>
              Marcar emitida
            </Button>
          )}

          {status === "emitida" && (
            <Button size="sm" variant="outline" onClick={() => avancar.mutate({ novoStatus: "concluida" })} loading={avancar.isPending}>
              Concluir viagem
            </Button>
          )}

          {/* Histórico */}
          {historico.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {historico.map((h) => (
                  <div key={h.id}>
                    {new Date(h.changed_at).toLocaleString("pt-BR")} · <strong>{h.changed_by_name}</strong> → {STATUS_FLUXO_LABEL[h.status]}
                    {h.notes && ` — ${h.notes}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba "Relatório de Viagens" ──────────────────────────────────────────────
// Nunca inventa/duplica dado do Drake — função vem de hist_novo_colaboradores (mesmo campo já
// usado em todo o resto do sistema). Mostra TODAS as passagens (lançadas manualmente ou vindas
// da importação de custos), não só as marcadas como internacionais — "internacional" vira só um
// selo por pessoa, pra RH/SMS (que via RLS só recebem registro internacional) continuarem
// enxergando exatamente o que já viam antes.
type StatusInternacional = "no_brasil" | "fora" | "chegando" | "saindo" | "sem_retorno";
const STATUS_INTERNACIONAL_LABEL: Record<StatusInternacional, string> = {
  no_brasil: "Disponível", fora: "Em viagem", chegando: "Chegando", saindo: "Saindo",
  sem_retorno: "Sem retorno programado",
};
const STATUS_INTERNACIONAL_COLOR: Record<StatusInternacional, string> = {
  no_brasil: "bg-emerald-100 text-emerald-800", fora: "bg-slate-200 text-slate-700",
  chegando: "bg-sky-100 text-sky-800", saindo: "bg-amber-100 text-amber-800",
  sem_retorno: "bg-red-100 text-red-800",
};

interface PessoaInternacional {
  nome: string; funcao: string | null; unidade: string; bsp: string;
  ultimaChegada: string | null; proximaSaida: string | null; proximoRetorno: string | null;
  status: StatusInternacional; passagens: PassagemAerea[]; internacional: boolean;
}

function computeStatusInternacional(passagens: PassagemAerea[], hoje: string): Pick<PessoaInternacional, "status" | "ultimaChegada" | "proximaSaida" | "proximoRetorno"> {
  const emCurso = passagens.find((p) => p.data_ida <= hoje && (!p.data_volta || p.data_volta >= hoje));
  const futuras = [...passagens].filter((p) => p.data_ida > hoje).sort((a, b) => a.data_ida.localeCompare(b.data_ida));
  const passadas = [...passagens].filter((p) => p.data_volta && p.data_volta < hoje).sort((a, b) => (b.data_volta as string).localeCompare(a.data_volta as string));

  const ultimaChegada = passadas[0]?.data_volta ?? null;
  const proximaViagem = futuras[0] ?? null;
  const proximaSaida = proximaViagem?.data_ida ?? null;
  const proximoRetorno = proximaViagem?.data_volta ?? null;

  let status: StatusInternacional;
  if (emCurso) {
    if (!emCurso.data_volta) status = "sem_retorno";
    else if (emCurso.data_volta <= addDays(hoje, 3)) status = "chegando";
    else status = "fora";
  } else if (proximaViagem && proximaViagem.data_ida <= addDays(hoje, 3)) {
    status = "saindo";
  } else {
    status = "no_brasil";
  }
  return { status, ultimaChegada, proximaSaida, proximoRetorno };
}

// "Não informado" é valor gravado de verdade pela importação (ver parseUnidadeBsp/
// buildPassagemRows), não só um texto de fallback da tela — por isso não basta checar
// truthy, tem que descartar essa string literal pra não exibir campo "vazio" preenchido.
function temValor(v: string | null | undefined): v is string {
  return !!v && v.trim() !== "" && v.trim().toLocaleLowerCase("pt-BR") !== "não informado";
}

function CardPessoaViagem({ p }: { p: PessoaInternacional }) {
  const datas = [
    p.ultimaChegada && `Chegou ${fmt(p.ultimaChegada)}`,
    p.proximaSaida && `Sai ${fmt(p.proximaSaida)}`,
    p.proximoRetorno && `Volta ${fmt(p.proximoRetorno)}`,
  ].filter(Boolean).join(" · ");
  const secundario = [p.funcao, temValor(p.bsp) ? `BSP ${p.bsp}` : null].filter(Boolean).join(" · ");
  return (
    <div className="rounded border px-2 py-1.5 text-xs leading-tight">
      <p className="font-medium text-foreground">{p.nome}</p>
      {temValor(p.unidade) && <p className="text-muted-foreground">{p.unidade}</p>}
      {datas && <p className="text-muted-foreground">{datas}</p>}
      {secundario && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{secundario}</p>}
    </div>
  );
}

// Lista com os 5 status (Chegando/Saindo/Em viagem/Sem retorno/Disponível) pro conjunto de
// passagens já filtrado (nacional OU internacional) — reaproveitada pelas duas sub-abas e
// pelo acesso de RH/SMS (que via RLS só recebe registro internacional de qualquer forma).
function ListaViagensPorStatus({ passagens, colaboradores }: { passagens: PassagemAerea[]; colaboradores: ColaboradorBasico[] }) {
  const [expandido, setExpandido] = useState<Set<StatusInternacional>>(new Set());
  const toggle = (s: StatusInternacional) => setExpandido((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const funcaoPorNome = useMemo(() => {
    const m = new Map<string, string | null>();
    colaboradores.forEach((c) => m.set(c.nome.trim().toUpperCase(), c.funcao || c.funcao_operacao || null));
    return m;
  }, [colaboradores]);

  const hoje = todayStr();
  const pessoas = useMemo<PessoaInternacional[]>(() => {
    const porNome = new Map<string, PassagemAerea[]>();
    passagens.forEach((p) => {
      const key = p.nome_usuario.trim().toUpperCase();
      if (!porNome.has(key)) porNome.set(key, []);
      porNome.get(key)!.push(p);
    });
    return Array.from(porNome.values()).map((lista) => {
      const maisRecente = [...lista].sort((a, b) => b.data_ida.localeCompare(a.data_ida))[0];
      const { status, ultimaChegada, proximaSaida, proximoRetorno } = computeStatusInternacional(lista, hoje);
      return {
        nome: maisRecente.nome_usuario, funcao: funcaoPorNome.get(maisRecente.nome_usuario.trim().toUpperCase()) ?? null,
        unidade: maisRecente.unidade, bsp: maisRecente.bsp,
        ultimaChegada, proximaSaida, proximoRetorno, status, passagens: lista,
        internacional: lista.some((p) => p.internacional),
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [passagens, funcaoPorNome, hoje]);

  const porStatus = (STATUS_ORDER_INTERNACIONAL).map((s) => ({ status: s, pessoas: pessoas.filter((p) => p.status === s) }));

  return (
    <div className="flex flex-wrap gap-2">
      {porStatus.map(({ status, pessoas: lista }) => {
        const aberto = expandido.has(status);
        return (
          <div key={status} className={cn("rounded-md border text-xs", aberto && "w-full")}>
            <button type="button" className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left" onClick={() => toggle(status)}>
              <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_INTERNACIONAL_COLOR[status]}`}>{STATUS_INTERNACIONAL_LABEL[status]}</span>
              <span className="font-semibold">{lista.length}</span>
            </button>
            {aberto && (
              <div className="grid grid-cols-2 gap-1.5 border-t px-2 py-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {lista.length === 0 ? (
                  <p className="text-muted-foreground">Ninguém nesse status.</p>
                ) : lista.map((p) => <CardPessoaViagem key={p.nome} p={p} />)}
              </div>
            )}
          </div>
        );
      })}
      {pessoas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma viagem lançada ainda.</p>}
    </div>
  );
}
const STATUS_ORDER_INTERNACIONAL: StatusInternacional[] = ["chegando", "saindo", "fora", "sem_retorno", "no_brasil"];

// Mesmo critério que já gera o selo "Internacional" na passagem (campo internacional,
// marcado na própria solicitação, nunca inferido) — só decide em qual sub-aba a pessoa
// aparece; uma pessoa com viagem nos dois grupos aparece nas duas abas, cada uma só com as
// passagens daquele tipo.
function RelatorioInternacionalTab({ passagens, colaboradores, somenteInternacionais }: {
  passagens: PassagemAerea[]; colaboradores: ColaboradorBasico[]; somenteInternacionais?: boolean;
}) {
  const [subAba, setSubAba] = useState<"internacionais" | "nacionais">("internacionais");

  // RH/SMS só recebem passagem internacional via RLS — não faz sentido oferecer a sub-aba
  // Nacionais nesse caso, ela sempre viria vazia.
  if (somenteInternacionais) {
    return <ListaViagensPorStatus passagens={passagens} colaboradores={colaboradores} />;
  }

  const passagensDaSubAba = passagens.filter((p) => subAba === "internacionais" ? p.internacional : !p.internacional);

  return (
    <div className="space-y-3">
      {/* O switcher fica FORA da área que rola — como a página inteira usa o scroll do
          documento (não um painel com altura própria), "position: sticky" aqui não segura
          nada (o <main> do layout tem overflow-auto mas nunca chega a estourar sua própria
          altura, então quem rola de verdade é a janela). Uma área de rolagem com altura
          própria abaixo resolve o pedido de "Internacionais sempre visível" sem depender de
          sticky. */}
      <div className="space-y-2">
        <Tabs value={subAba} onValueChange={(v) => setSubAba(v as "internacionais" | "nacionais")}>
          <TabsList>
            <TabsTrigger value="internacionais">
              <Globe2 className="mr-1.5 h-3.5 w-3.5" />Internacionais
            </TabsTrigger>
            <TabsTrigger value="nacionais">Nacionais</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          {subAba === "internacionais"
            ? "Voos internacionais — acompanhamento prioritário (documentação e prazos)."
            : "Voos nacionais."}
        </p>
      </div>
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <ListaViagensPorStatus passagens={passagensDaSubAba} colaboradores={colaboradores} />
      </div>
    </div>
  );
}

// ─── Importação da planilha de custos histórica (aba "Passagens Aéreas") ───────────────────
// Mesma planilha "Relatorio_Custos_Stepup_2026_por_modulo.xlsx" já usada em Transporte/
// Hospedagem — nome exato da aba ainda não confirmado, tenta as variações mais prováveis.
const PASSAGENS_SHEET_NAMES = ["Passagens Aéreas", "Passagem Aérea", "Passagens", "Aéreo"];

interface ParsedPassagemRow {
  payload: Record<string, unknown> | null;
  erro: string | null;
  nome: string; data: string; custo: number | null;
}

function buildPassagemRows(l: LinhaCustoBruta): ParsedPassagemRow[] {
  const dataIda = parseDataBR(l.data);
  const valor = parseCustoBRL(l.custo);
  const nomes = splitNomes(l.funcionario);
  if (!dataIda) return [{ payload: null, erro: "Data inválida", nome: l.funcionario, data: l.data, custo: valor }];
  if (valor == null) return [{ payload: null, erro: "Valor inválido", nome: l.funcionario, data: l.data, custo: valor }];
  if (nomes.length === 0) return [{ payload: null, erro: "Sem nome de colaborador", nome: "", data: l.data, custo: valor }];

  const { unidade, bsp } = parseUnidadeBsp(l.projeto);
  // "CARAPEBUS X MACAE" → origem/destino, igual ao mesmo padrão usado em Transporte — aqui os
  // dois campos são opcionais de verdade (coluna aceita nulo), então sem esse padrão fica
  // vazio mesmo, não força um "Não informado".
  const obsMatch = l.observacao.match(/^(.+?)\s+[Xx]\s+(.+)$/);
  const origem = obsMatch ? obsMatch[1].trim() : null;
  const destino = obsMatch ? obsMatch[2].trim() : null;
  // "PERIODO: 04 A 06/02" / "04/02 A 06/02" → data de volta (mesma lógica de
  // parseCheckOutDeObservacao usada em Hospedagem, reaproveitada aqui pro mesmo formato).
  const dataVolta = parseCheckOutDeObservacao(l.observacao, dataIda);
  const observacoes = [l.tipoApontamento, l.observacao].filter(Boolean).join(" — ") || null;

  return nomes.map((nome) => ({
    payload: {
      unidade, bsp: bsp || "Não informado", nome_usuario: nome,
      companhia_aerea: l.fornecedor.trim() || null,
      origem, destino,
      data_ida: dataIda, data_volta: dataVolta,
      tipo: dataVolta ? "Ida e Volta" : "Ida",
      valor, status: "Confirmada", motivo: l.motivo.trim() || null,
      motivo_cancelamento: null, observacoes,
      solicitante: null, solicitante_email: null, internacional: false, status_fluxo: "emitida",
      nf: l.nf.trim() || null, cobrado: parseBooleanoSN(l.cobrado),
      status_lancamento: l.statusLancamento.trim() || null, faturado: parseBooleanoSimNao(l.faturado),
      usuario_faturamento: l.usuarioFaturamento.trim() || null, data_faturamento: parseDataBR(l.dataFaturamento),
    },
    erro: null, nome, data: l.data, custo: valor,
  }));
}

function ImportCustosPassagensDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedPassagemRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [abaUsada, setAbaUsada] = useState<string | null>(null);

  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    let linhas: LinhaCustoBruta[] = [];
    let aba: string | null = null;
    for (const nome of PASSAGENS_SHEET_NAMES) {
      const tentativa = parsePlanilhaCustos(buf, nome);
      if (tentativa.length > 0) { linhas = tentativa; aba = nome; break; }
    }
    if (linhas.length === 0) {
      notify.error(`Nenhuma linha encontrada — tentei as abas: ${PASSAGENS_SHEET_NAMES.join(", ")}. Me diga o nome exato da aba se for diferente.`);
      return;
    }
    setAbaUsada(aba);
    setPreview(linhas.flatMap((l) => buildPassagemRows(l)));
  };

  const validas = preview?.filter((p) => !p.erro && p.payload) ?? [];
  const invalidas = preview?.filter((p) => p.erro) ?? [];

  const importar = useMutation({
    mutationFn: async () => {
      const BATCH = 500;
      for (let i = 0; i < validas.length; i += BATCH) {
        const lote = validas.slice(i, i + BATCH);
        const { error } = await supabase.from("passagens_aereas").insert(lote.map((r) => r.payload));
        if (error) throw error;
        setProgress({ done: Math.min(i + BATCH, validas.length), total: validas.length });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagens-aereas"] });
      notify.success(`${validas.length} passagem(ns) importada(s).`);
      setPreview(null); setProgress(null); setAbaUsada(null); onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importar.isPending) { onOpenChange(o); if (!o) { setPreview(null); setProgress(null); setAbaUsada(null); } } }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar planilha de custos — Passagens Aéreas</DialogTitle></DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecione o arquivo "Relatorio_Custos_Stepup..." — os dados viram registros já "Emitidos"
              (histórico, não passam pelo fluxo de solicitação/aprovação).
            </p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Plus className="mr-2 h-4 w-4" />Escolher arquivo</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {abaUsada && <p className="text-xs text-muted-foreground">Lendo a aba "{abaUsada}" da planilha.</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="p-3"><p className="text-xs text-muted-foreground">Linhas geradas</p><p className="text-xl font-semibold">{preview.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Válidas</p><p className="text-xl font-semibold text-success">{validas.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Com erro</p><p className="text-xl font-semibold text-destructive">{invalidas.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Custo total</p><p className="text-xl font-semibold">{fmtMoney(validas.reduce((a, p) => a + (p.custo ?? 0), 0))}</p></Card>
            </div>
            {invalidas.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {invalidas.length} linha(s) não serão importadas — revise a planilha se o número parecer alto.
              </div>
            )}
            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Data</TableHead><TableHead>Nome</TableHead><TableHead>Custo</TableHead><TableHead>Situação</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 200).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{p.data}</TableCell>
                      <TableCell className="text-xs">{p.nome}</TableCell>
                      <TableCell className="text-xs">{p.custo != null ? fmtMoney(p.custo) : "—"}</TableCell>
                      <TableCell className="text-xs">{p.erro ? <span className="text-destructive">{p.erro}</span> : "OK"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > 200 && <p className="p-2 text-center text-xs text-muted-foreground">Mostrando as primeiras 200 de {preview.length} linhas — a importação processa todas.</p>}
            </div>
            {progress && <p className="text-xs text-muted-foreground">Importando {progress.done}/{progress.total}...</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); setAbaUsada(null); }} disabled={importar.isPending}>Escolher outro arquivo</Button>
              <Button onClick={() => importar.mutate()} loading={importar.isPending} disabled={validas.length === 0}>
                Confirmar importação ({validas.length})
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────
function PassagensAereasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  // RH/SMS só acompanham o Relatório de Viagens Internacionais — RLS (rh_sms_view_international)
  // já limita o que `passagens` traz pra eles a registros internacionais; aqui só decide o que
  // aparece na tela, pra não mostrar botões de ação que dariam erro de permissão no clique.
  const somenteRelatorioInternacional = role === "rh" || role === "sms";
  const { data: passagens = [], isLoading: l1 } = usePassagensQuery();
  const { data: periodos = [], isLoading: l2 } = usePeriodosEQuery();
  const { data: colaboradores = [], isLoading: l3 } = useColaboradoresQuery();

  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);
  const unidadeOptions = useMemo(
    () => Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort(),
    [periodos],
  );

  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [filterMotivo, setFilterMotivo] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterNome, setFilterNome] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PassagemAerea | null>(null);
  const [gerenciando, setGerenciando] = useState<PassagemAerea | null>(null);
  const [gerenciarOpen, setGerenciarOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Ordenação clicável no cabeçalho — aplicada só nos dados já filtrados na tela. Sem coluna
  // escolhida, mantém a ordem padrão vinda da consulta (data de ida mais recente primeiro).
  const { sortColumn, sortDirection, toggleSort } = useTableSort<PassagensSortColumn>();

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, filterUnidade), [periodosE, filterUnidade]);
  const motivosVistos = useMemo(
    () => Array.from(new Set(passagens.map((p) => p.motivo).filter((m): m is string => !!m))).sort(),
    [passagens],
  );

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("passagens_aereas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagens-aereas"] });
      notify.success("Passagem excluída");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const filtradas = useMemo(() => passagens.filter((p) =>
    (filterUnidade === "all" || p.unidade === filterUnidade) &&
    (filterBsp === "all" || p.bsp === filterBsp) &&
    (filterMotivo === "all" || (p.motivo ?? "") === filterMotivo) &&
    (filterStatus === "all" || p.status === filterStatus) &&
    (!filterNome || matchesNameSearch(p.nome_usuario, filterNome)),
  ).sort((a, b) => {
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "unidade":
        return dir * a.unidade.localeCompare(b.unidade);
      case "bsp":
        return dir * a.bsp.localeCompare(b.bsp);
      case "nome":
        return dir * a.nome_usuario.localeCompare(b.nome_usuario);
      case "companhia":
        return dir * (a.companhia_aerea ?? "").localeCompare(b.companhia_aerea ?? "");
      case "origemDestino":
        return dir * `${a.origem ?? ""} ${a.destino ?? ""}`.localeCompare(`${b.origem ?? ""} ${b.destino ?? ""}`);
      case "ida":
        return dir * a.data_ida.localeCompare(b.data_ida);
      case "volta":
        return dir * (a.data_volta ?? "").localeCompare(b.data_volta ?? "");
      case "tipo":
        return dir * a.tipo.localeCompare(b.tipo);
      case "valor":
        return dir * (a.valor - b.valor);
      case "status":
        return dir * (STATUS_PASSAGEM_ORDER[a.status] - STATUS_PASSAGEM_ORDER[b.status]);
      case "motivo":
        return dir * (a.motivo ?? "").localeCompare(b.motivo ?? "");
      default:
        return 0;
    }
  }), [passagens, filterUnidade, filterBsp, filterMotivo, filterStatus, filterNome, sortColumn, sortDirection]);

  // Cascata Cliente → Unidade → BSP — mesmo formato em árvore já usado em Hospedagem/Transporte
  // (Custos). Passagens Aéreas não tem campo Cliente próprio, usa o mesmo vínculo Unidade→Cliente
  // (clienteDaUnidade) já confirmado pela operação, com "Base" pra BSP real sem cliente mapeado.
  const consolidado = useMemo(() => {
    const porCliente = new Map<string, Map<string, Map<string, PassagemAerea[]>>>();
    filtradas.forEach((p) => {
      const cliente = clienteDaUnidade(p.unidade) ?? (p.bsp?.trim() ? "Base" : p.unidade);
      if (!porCliente.has(cliente)) porCliente.set(cliente, new Map());
      const porUnidade = porCliente.get(cliente)!;
      if (!porUnidade.has(p.unidade)) porUnidade.set(p.unidade, new Map());
      const porBsp = porUnidade.get(p.unidade)!;
      if (!porBsp.has(p.bsp)) porBsp.set(p.bsp, []);
      porBsp.get(p.bsp)!.push(p);
    });
    return Array.from(porCliente.entries())
      .map(([cliente, porUnidade]) => {
        const unidades = Array.from(porUnidade.entries())
          .map(([unidade, porBsp]) => {
            const bsps = Array.from(porBsp.entries())
              .map(([bsp, itens]) => ({
                bsp, total: itens.reduce((a, p) => a + p.valor, 0),
                itens: [...itens].sort((a, b) => b.data_ida.localeCompare(a.data_ida)),
              }))
              .sort((a, b) => b.total - a.total);
            return { unidade, total: bsps.reduce((a, b) => a + b.total, 0), bsps };
          })
          .sort((a, b) => b.total - a.total);
        return { cliente, total: unidades.reduce((a, u) => a + u.total, 0), unidades };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtradas]);
  const [collapsedClientes, setCollapsedClientes] = useState<Set<string>>(new Set());
  const [collapsedUnidades, setCollapsedUnidades] = useState<Set<string>>(new Set());
  const [expandedBsps, setExpandedBsps] = useState<Set<string>>(new Set());
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const criarHospedagemVinculada = (p: PassagemAerea) => {
    navigate({
      to: "/admin/hospedagem",
      search: { prefillUnidade: p.unidade, prefillBsp: p.bsp, prefillNome: p.nome_usuario, prefillMotivo: "Voo Cancelado" },
    });
  };

  if (l1 || l2 || l3) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Card className="p-3">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-44" /><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-48" />
          </div>
        </Card>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead><TableHead>BSP</TableHead><TableHead>Nome</TableHead>
                <TableHead>Origem/Destino</TableHead><TableHead>Ida</TableHead><TableHead>Volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton rows={6} cols={6} />
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex items-center gap-2">
        <Plane className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Passagens Aéreas</h1>
      </div>

      {somenteRelatorioInternacional ? (
        <RelatorioInternacionalTab passagens={passagens} colaboradores={colaboradores} somenteInternacionais />
      ) : (
      <Tabs defaultValue="solicitacoes">
        <TabsList>
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          <TabsTrigger value="internacionais">Relatório de Viagens</TabsTrigger>
        </TabsList>

        <TabsContent value="internacionais" className="mt-4">
          <RelatorioInternacionalTab passagens={passagens} colaboradores={colaboradores} />
        </TabsContent>

        <TabsContent value="solicitacoes" className="mt-4 space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={filterUnidade} onValueChange={(v) => { setFilterUnidade(v); setFilterBsp("all"); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <Select value={filterBsp} onValueChange={setFilterBsp}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Motivo</Label>
            <Select value={filterMotivo} onValueChange={setFilterMotivo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {motivosVistos.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {STATUS_PASSAGEM.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-52">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Nome do usuário</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" />Importar planilha de custos
            </Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Nova passagem
            </Button>
          </div>
        </div>
      </Card>

      {consolidado.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                const tudoAberto = collapsedClientes.size === 0 && collapsedUnidades.size === 0;
                if (tudoAberto) {
                  setCollapsedClientes(new Set(consolidado.map((c) => c.cliente)));
                  setCollapsedUnidades(new Set(consolidado.flatMap((c) => c.unidades.map((u) => `${c.cliente}::${u.unidade}`))));
                } else {
                  setCollapsedClientes(new Set()); setCollapsedUnidades(new Set());
                }
              }}
            >
              {collapsedClientes.size === 0 && collapsedUnidades.size === 0 ? (
                <><ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />Recolher tudo</>
              ) : (
                <><ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />Expandir tudo</>
              )}
            </Button>
          </div>
          <Card className="overflow-hidden">
            {consolidado.map((c) => {
              const clienteAberto = !collapsedClientes.has(c.cliente);
              return (
                <div key={c.cliente} className="border-b last:border-b-0">
                  <button
                    type="button" className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left"
                    aria-expanded={clienteAberto} onClick={() => toggleSet(setCollapsedClientes, c.cliente)}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      {clienteAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <Building2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{c.cliente}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold">{fmtMoney(c.total)}</span>
                  </button>
                  {clienteAberto && c.unidades.map((u) => {
                    const unidadeKey = `${c.cliente}::${u.unidade}`;
                    const unidadeAberta = !collapsedUnidades.has(unidadeKey);
                    return (
                      <div key={unidadeKey}>
                        <button
                          type="button" className="flex w-full items-center justify-between gap-2 border-t bg-sky-50/60 px-4 py-2.5 pl-9 text-left"
                          aria-expanded={unidadeAberta} onClick={() => toggleSet(setCollapsedUnidades, unidadeKey)}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-medium text-sky-950">
                            {unidadeAberta ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            <Ship className="h-4 w-4 shrink-0 text-sky-700" /><span className="truncate">{u.unidade}</span>
                            {u.bsps.some((b) => b.bsp !== "Não informado") && (
                              <span className="text-xs font-normal text-muted-foreground">({u.bsps.filter((b) => b.bsp !== "Não informado").length} BSP)</span>
                            )}
                          </span>
                          <span className="shrink-0 text-sm font-medium">{fmtMoney(u.total)}</span>
                        </button>
                        {unidadeAberta && u.bsps.map((b) => {
                          if (b.bsp === "Não informado") {
                            return (
                              <div key={`${unidadeKey}::sem-bsp`} className="divide-y border-t bg-emerald-50/40 pl-16">
                                {b.itens.map((p) => (
                                  <div
                                    key={p.id} role="button" tabIndex={0} title="Clique para editar esta passagem"
                                    className="flex cursor-pointer flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs hover:bg-emerald-100/60"
                                    onClick={() => { setEditing(p); setDialogOpen(true); }}
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate font-medium">{p.nome_usuario}</p>
                                      <p className="text-muted-foreground">{p.origem ?? "—"} → {p.destino ?? "—"} · {fmt(p.data_ida)}{p.data_volta ? ` – ${fmt(p.data_volta)}` : ""}{p.motivo ? ` · ${p.motivo}` : ""}</p>
                                    </div>
                                    <span className="shrink-0 font-semibold">{fmtMoney(p.valor)}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          const bspKey = `${unidadeKey}::${b.bsp}`;
                          const bspAberto = expandedBsps.has(bspKey);
                          return (
                            <div key={bspKey}>
                              <button
                                type="button" className="flex w-full items-center justify-between gap-2 border-t bg-white px-4 py-2.5 pl-16 text-left"
                                aria-expanded={bspAberto} onClick={() => toggleSet(setExpandedBsps, bspKey)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {bspAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                  <Layers3 className="h-4 w-4 shrink-0 text-sky-600" /><span className="truncate">{b.bsp}</span>
                                  <span className="text-xs font-normal text-muted-foreground">({b.itens.length})</span>
                                </span>
                                <span className="shrink-0 text-sm">{fmtMoney(b.total)}</span>
                              </button>
                              {bspAberto && (
                                <div className="divide-y border-t bg-emerald-50/40 pl-20">
                                  {b.itens.map((p) => (
                                    <div
                                      key={p.id} role="button" tabIndex={0} title="Clique para editar esta passagem"
                                      className="flex cursor-pointer flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs hover:bg-emerald-100/60"
                                      onClick={() => { setEditing(p); setDialogOpen(true); }}
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">{p.nome_usuario}</p>
                                        <p className="text-muted-foreground">{p.origem ?? "—"} → {p.destino ?? "—"} · {fmt(p.data_ida)}{p.data_volta ? ` – ${fmt(p.data_volta)}` : ""}{p.motivo ? ` · ${p.motivo}` : ""}</p>
                                      </div>
                                      <span className="shrink-0 font-semibold">{fmtMoney(p.valor)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Unidade" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Nome do usuário" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Companhia" column="companhia" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Origem → Destino" column="origemDestino" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Ida" column="ida" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Volta" column="volta" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Tipo" column="tipo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Valor" column="valor" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Motivo" column="motivo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead>Etapa</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.length === 0 ? (
              <EmptyStateRow colSpan={13} icon={Plane} title="Nenhuma passagem encontrada" />
            ) : filtradas.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.unidade}</TableCell>
                <TableCell>{p.bsp}</TableCell>
                <TableCell>{p.nome_usuario}</TableCell>
                <TableCell>{p.companhia_aerea ?? "—"}</TableCell>
                <TableCell>{p.origem || p.destino ? `${p.origem ?? "—"} → ${p.destino ?? "—"}` : "—"}</TableCell>
                <TableCell>{fmt(p.data_ida)}</TableCell>
                <TableCell>{fmt(p.data_volta)}</TableCell>
                <TableCell>{p.tipo}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(p.valor)}</TableCell>
                <TableCell><Badge variant={STATUS_BADGE[p.status] ?? "secondary"}>{p.status}</Badge></TableCell>
                <TableCell>{p.motivo ?? "—"}</TableCell>
                <TableCell>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_FLUXO_COLOR[p.status_fluxo].bg} ${STATUS_FLUXO_COLOR[p.status_fluxo].text}`}>
                    {STATUS_FLUXO_LABEL[p.status_fluxo]}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerenciar solicitação" onClick={() => { setGerenciando(p); setGerenciarOpen(true); }}>
                      <ListChecks className="h-3.5 w-3.5" />
                    </Button>
                    {p.status === "Cancelada" && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7" title="Criar hospedagem vinculada"
                        onClick={() => criarHospedagemVinculada(p)}
                      >
                        <BedDouble className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir passagem?</AlertDialogTitle>
                          <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(p.id)}>
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
        </TabsContent>
      </Tabs>
      )}

      {!somenteRelatorioInternacional && (
      <PassagemDialog
        open={dialogOpen} onOpenChange={setDialogOpen} editing={editing}
        periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
      />
      )}
      {!somenteRelatorioInternacional && (
      <GerenciarFluxoDialog passagem={gerenciando} open={gerenciarOpen} onOpenChange={setGerenciarOpen} />
      )}
      {!somenteRelatorioInternacional && (
      <ImportCustosPassagensDialog open={importOpen} onOpenChange={setImportOpen} />
      )}
    </div>
  );
}
