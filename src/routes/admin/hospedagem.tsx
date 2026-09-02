import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { matchesNameSearch } from "@/lib/utils";
// hoteis_fornecedores/hospedagens ainda não estão nos tipos gerados (types.ts não é
// regerado automaticamente neste projeto — ver mesmo padrão em nominations.tsx); cast local
// para não bloquear o build.
const supabase: any = supabaseTyped;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyStateRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { NomeUsuarioField, NomeUsuarioMultiField, BspMultiField, MotivoField, useRateioComplementar, usePessoasAdicionais } from "@/components/LogisticaFormFields";
import { Check, ChevronsUpDown, ChevronsDownUp, Plus, Pencil, Trash2, BedDouble, Hotel, Upload, Building2, Ship, Layers3, ChevronDown, ChevronRight } from "lucide-react";
import { clienteDaUnidade } from "@/lib/clientes";
import {
  parsePlanilhaCustos, parseCustoBRL, parseDataBR, parseUnidadeBsp, splitNomes,
  parseBooleanoSN, parseBooleanoSimNao, parseCheckOutDeObservacao, diasEntre, type LinhaCustoBruta,
} from "@/lib/importCustos";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { pageTitle } from "@/lib/pageTitle";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import {
  computeDiarias, computeValorTotal, localizacaoHotel,
  type HotelFornecedor, type Hospedagem,
} from "@/lib/hospedagem";

interface HospedagemSearch {
  prefillUnidade?: string;
  prefillBsp?: string;
  prefillNome?: string;
  prefillMotivo?: string;
}

export const Route = createFileRoute("/admin/hospedagem")({
  head: () => pageTitle("Hospedagem"),
  component: HospedagemPage,
  validateSearch: (s: Record<string, unknown>): HospedagemSearch => ({
    prefillUnidade: typeof s.prefillUnidade === "string" ? s.prefillUnidade : undefined,
    prefillBsp: typeof s.prefillBsp === "string" ? s.prefillBsp : undefined,
    prefillNome: typeof s.prefillNome === "string" ? s.prefillNome : undefined,
    prefillMotivo: typeof s.prefillMotivo === "string" ? s.prefillMotivo : undefined,
  }),
});

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function useHoteisQuery() {
  return useQuery<HotelFornecedor[]>({
    queryKey: ["hoteis-fornecedores"],
    queryFn: () => selectAllPages<HotelFornecedor>((from, to) =>
      supabase.from("hoteis_fornecedores").select("*").order("nome").range(from, to),
    ),
  });
}

function useHospedagensQuery() {
  return useQuery<Hospedagem[]>({
    queryKey: ["hospedagens"],
    queryFn: () => selectAllPages<Hospedagem>((from, to) =>
      supabase.from("hospedagens").select("*").order("check_in", { ascending: false }).order("id").range(from, to),
    ),
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

function useColaboradoresQuery() {
  return useQuery<{ id: string; nome: string }[]>({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: () => selectAllPages<{ id: string; nome: string }>((from, to) =>
      supabase.from("hist_novo_colaboradores").select("id, nome").order("nome").range(from, to),
    ),
  });
}

// ─── Combobox: Hotel (com cadastro rápido) ─────────────────────────────────
function HotelCombobox({ hoteis, value, onChange }: {
  hoteis: HotelFornecedor[]; value: string; onChange: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ nome: "", cidade: "", estado: "" });
  const selected = hoteis.find((h) => h.id === value);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("hoteis_fornecedores").insert({
        nome: nf.nome.trim(), cidade: nf.cidade.trim(), estado: nf.estado.trim().toUpperCase(),
      }).select("*").single();
      if (error) throw error;
      return data as HotelFornecedor;
    },
    onSuccess: (h: HotelFornecedor) => {
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success("Hotel cadastrado");
      setNf({ nome: "", cidade: "", estado: "" });
      setNewOpen(false);
      onChange(h.id);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate">{selected ? selected.nome : "Selecionar hotel"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar hotel..." />
            <CommandList>
              <CommandEmpty>Nenhum hotel encontrado.</CommandEmpty>
              <CommandGroup>
                {hoteis.map((h) => (
                  <CommandItem key={h.id} value={`${h.nome} ${h.cidade}`} onSelect={() => { onChange(h.id); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === h.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{h.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{localizacaoHotel(h)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setOpen(false); setNewOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />Cadastrar novo hotel
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo hotel</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs">Nome</Label><Input value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} /></div>
            <div><Label className="text-xs">Cidade</Label><Input value={nf.cidade} onChange={(e) => setNf({ ...nf, cidade: e.target.value })} /></div>
            <div><Label className="text-xs">Estado (UF)</Label><Input maxLength={2} value={nf.estado} onChange={(e) => setNf({ ...nf, estado: e.target.value.toUpperCase() })} /></div>
          </div>
          <DialogFooter>
            <Button disabled={!nf.nome.trim() || !nf.cidade.trim() || !nf.estado.trim()} loading={create.isPending} onClick={() => create.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const FORM_VAZIO = {
  unidade: "", bsp: "", nomeUsuario: "", hotelId: "", checkIn: "", checkOut: "",
  valorDiaria: "", motivo: "", observacoes: "",
  nf: "", fornecedor: "", cobrado: false, statusLancamento: "", faturado: false,
  usuarioFaturamento: "", dataFaturamento: "",
};

// ─── Dialog: Nova hospedagem / Editar ───────────────────────────────────────
function HospedagemDialog({ open, onOpenChange, editing, prefill, hoteis, periodosE, colaboradores, unidadeOptions }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: Hospedagem | null;
  prefill?: Partial<typeof FORM_VAZIO> | null;
  hoteis: HotelFornecedor[]; periodosE: HistNovoPeriodo[]; colaboradores: { id: string; nome: string }[];
  unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(FORM_VAZIO);
  const [bound, setBound] = useState<string | null>(null);
  const diariasAtual = f.checkIn && f.checkOut ? computeDiarias(f.checkIn, f.checkOut) : 0;
  const valorTotal = computeValorTotal(diariasAtual, Number(f.valorDiaria) || 0);
  const rateio = useRateioComplementar(valorTotal);
  const pessoas = usePessoasAdicionais();

  if (open && editing && bound !== editing.id) {
    setF({
      unidade: editing.unidade, bsp: editing.bsp, nomeUsuario: editing.nome_usuario, hotelId: editing.hotel_id,
      checkIn: editing.check_in, checkOut: editing.check_out, valorDiaria: String(editing.valor_diaria),
      motivo: editing.motivo ?? "", observacoes: editing.observacoes ?? "",
      nf: editing.nf ?? "", fornecedor: editing.fornecedor ?? "", cobrado: editing.cobrado ?? false,
      statusLancamento: editing.status_lancamento ?? "", faturado: editing.faturado ?? false,
      usuarioFaturamento: editing.usuario_faturamento ?? "", dataFaturamento: editing.data_faturamento ?? "",
    });
    // Reconstrói o percentual a partir do valor já gravado (o que fica salvo é sempre o
    // valor calculado, o percentual é só conveniência de preenchimento — ver useRateioComplementar).
    const totalEditado = editing.valor_total || 0;
    if (editing.bsp_2 && editing.valor_2 && totalEditado > 0) {
      rateio.setAtivo(true); rateio.setBsp2(editing.bsp_2); rateio.setPercentual2(String(Math.round((editing.valor_2 / totalEditado) * 10000) / 100));
    }
    if (editing.bsp_3 && editing.valor_3 && totalEditado > 0) {
      rateio.setAtivo(true); rateio.setBsp3(editing.bsp_3); rateio.setPercentual3(String(Math.round((editing.valor_3 / totalEditado) * 10000) / 100));
    }
    setBound(editing.id);
  }
  // Vem preenchido quando aberto a partir de outro módulo (ex.: Passagens Aéreas, ao marcar
  // uma passagem como Cancelada) — só unidade/bsp/nome/motivo, o resto (hotel/datas/valor)
  // continua em branco pra digitação normal.
  if (open && !editing && bound !== "novo") { setF({ ...FORM_VAZIO, ...prefill }); rateio.reset(); pessoas.reset(); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, f.unidade || "all"), [periodosE, f.unidade]);
  const hotelSelecionado = hoteis.find((h) => h.id === f.hotelId);
  const diarias = diariasAtual;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.unidade) throw new Error("Selecione a unidade.");
      if (!f.bsp) throw new Error("Selecione o BSP.");
      if (!f.nomeUsuario.trim()) throw new Error("Informe o nome de quem vai usar a hospedagem.");
      if (!f.hotelId) throw new Error("Selecione o hotel.");
      if (!f.checkIn || !f.checkOut) throw new Error("Informe check-in e check-out.");
      if (diarias <= 0) throw new Error("Check-out precisa ser depois do check-in.");
      const payload = {
        unidade: f.unidade, bsp: f.bsp, nome_usuario: f.nomeUsuario.trim(), hotel_id: f.hotelId,
        check_in: f.checkIn, check_out: f.checkOut, diarias, valor_diaria: Number(f.valorDiaria) || 0,
        valor_total: valorTotal, motivo: f.motivo.trim() || null, observacoes: f.observacoes.trim() || null,
        bsp_2: rateio.ativo && rateio.bsp2.trim() ? rateio.bsp2.trim() : null,
        bsp_3: rateio.ativo && rateio.bsp3.trim() ? rateio.bsp3.trim() : null,
        valor_2: rateio.ativo && rateio.bsp2.trim() ? rateio.valor2 : null,
        valor_3: rateio.ativo && rateio.bsp3.trim() ? rateio.valor3 : null,
        nf: f.nf.trim() || null, fornecedor: f.fornecedor.trim() || null, cobrado: f.cobrado,
        status_lancamento: f.statusLancamento.trim() || null, faturado: f.faturado,
        usuario_faturamento: f.usuarioFaturamento.trim() || null, data_faturamento: f.dataFaturamento || null,
      };
      if (editing) {
        const { error } = await supabase.from("hospedagens").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        // Um lançamento por pessoa: o principal + cada colaborador adicional (com unidade/BSP
        // próprios quando informados, senão herdando os do formulário).
        const linhas = [payload, ...pessoas.validas.map((p) => ({
          ...payload,
          nome_usuario: p.nome.trim(),
          unidade: p.unidade || payload.unidade,
          bsp: p.bsp || payload.bsp,
        }))];
        const { error } = await supabase.from("hospedagens").insert(linhas);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hospedagens"] });
      notify.success(editing ? "Hospedagem atualizada" : `${1 + pessoas.validas.length} hospedagem(ns) lançada(s)`);
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{editing ? "Editar hospedagem" : "Nova hospedagem"}</DialogTitle></DialogHeader>
        <div className="-mr-2 grid gap-3 overflow-y-auto pr-2">
          <NomeUsuarioMultiField
            value={f.nomeUsuario} onChange={(v) => setF({ ...f, nomeUsuario: v })}
            colaboradores={colaboradores} extras={pessoas} permiteAdicionar={!editing}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Unidade</Label>
              <Select value={f.unidade} onValueChange={(v) => setF({ ...f, unidade: v, bsp: "" })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <BspMultiField
              value={f.bsp} onChange={(v) => setF({ ...f, bsp: v })}
              options={bspOptions} disabled={!f.unidade} rateio={rateio}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Hotel</Label>
              <HotelCombobox hoteis={hoteis} value={f.hotelId} onChange={(id) => setF({ ...f, hotelId: id })} />
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input disabled value={localizacaoHotel(hotelSelecionado)} className="bg-muted" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Check-in</Label>
              <Input type="date" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Check-out</Label>
              <Input type="date" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Diárias</Label>
              <Input disabled value={diarias} className="bg-muted" />
            </div>
            <div>
              <Label className="text-xs">Valor da diária</Label>
              <Input type="number" step="0.01" min="0" value={f.valorDiaria} onChange={(e) => setF({ ...f, valorDiaria: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Valor total</Label>
              <Input disabled value={fmtMoney(valorTotal)} className="bg-muted" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Motivo</Label>
            <MotivoField value={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} />
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Fornecedor</Label><Input value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} /></div>
            <div><Label className="text-xs">NF</Label><Input value={f.nf} onChange={(e) => setF({ ...f, nf: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Status Lanç.</Label><Input value={f.statusLancamento} onChange={(e) => setF({ ...f, statusLancamento: e.target.value })} placeholder="Ex.: Definitivo" /></div>
            <div className="flex items-end gap-2 pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.cobrado} onChange={(e) => setF({ ...f, cobrado: e.target.checked })} />
                Cobrado do cliente
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-end gap-2 pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.faturado} onChange={(e) => setF({ ...f, faturado: e.target.checked })} />
                Faturado
              </label>
            </div>
            <div><Label className="text-xs">Usuário Faturamento</Label><Input value={f.usuarioFaturamento} onChange={(e) => setF({ ...f, usuarioFaturamento: e.target.value })} /></div>
            <div><Label className="text-xs">Data Faturamento</Label><Input type="date" value={f.dataFaturamento} onChange={(e) => setF({ ...f, dataFaturamento: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => salvar.mutate()} loading={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Importação da planilha de custos histórica (aba "Hospedagem") ────────────────────────
// Uma linha da planilha vira UMA LINHA POR PESSOA (diferente de Transporte) — decisão da
// usuária, pra cada pessoa ficar rastreável individualmente na lista.
interface ParsedHospedagemRow {
  payload: Omit<Record<string, unknown>, "hotel_id"> | null;
  fornecedorNome: string;
  erro: string | null;
  nome: string; data: string; custo: number | null;
}

function buildHospedagemRows(l: LinhaCustoBruta): ParsedHospedagemRow[] {
  const checkIn = parseDataBR(l.data);
  const custo = parseCustoBRL(l.custo);
  const nomes = splitNomes(l.funcionario);
  const fornecedorNome = l.fornecedor.trim() || "Fornecedor não informado";
  if (!checkIn) return [{ payload: null, fornecedorNome, erro: "Data inválida", nome: l.funcionario, data: l.data, custo }];
  if (custo == null) return [{ payload: null, fornecedorNome, erro: "Custo inválido", nome: l.funcionario, data: l.data, custo }];
  if (nomes.length === 0) return [{ payload: null, fornecedorNome, erro: "Sem nome de colaborador", nome: "", data: l.data, custo }];

  const { unidade, bsp } = parseUnidadeBsp(l.projeto);
  const checkOut = parseCheckOutDeObservacao(l.observacao, checkIn) ?? checkIn;
  const diarias = diasEntre(checkIn, checkOut);
  const observacoes = [l.tipoApontamento, l.observacao].filter(Boolean).join(" — ") || null;

  return nomes.map((nome) => ({
    payload: {
      unidade, bsp: bsp || "Não informado", nome_usuario: nome,
      check_in: checkIn, check_out: checkOut, diarias,
      valor_diaria: Math.round((custo / diarias) * 100) / 100, valor_total: custo,
      motivo: l.motivo.trim() || null, observacoes,
      nf: l.nf.trim() || null, fornecedor: l.fornecedor.trim() || null, cobrado: parseBooleanoSN(l.cobrado),
      status_lancamento: l.statusLancamento.trim() || null, faturado: parseBooleanoSimNao(l.faturado),
      usuario_faturamento: l.usuarioFaturamento.trim() || null, data_faturamento: parseDataBR(l.dataFaturamento),
    },
    fornecedorNome, erro: null, nome, data: l.data, custo,
  }));
}

function ImportCustosHospedagemDialog({ open, onOpenChange, hoteis }: {
  open: boolean; onOpenChange: (o: boolean) => void; hoteis: HotelFornecedor[];
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedHospedagemRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const linhas = parsePlanilhaCustos(buf, "Hospedagem");
    if (linhas.length === 0) { notify.error('Nenhuma linha encontrada na aba "Hospedagem" da planilha.'); return; }
    setPreview(linhas.flatMap((l) => buildHospedagemRows(l)));
  };

  const validas = preview?.filter((p) => !p.erro && p.payload) ?? [];
  const invalidas = preview?.filter((p) => p.erro) ?? [];
  const fornecedoresNovos = useMemo(() => {
    const existentes = new Set(hoteis.map((h) => h.nome.trim().toUpperCase()));
    return Array.from(new Set(validas.map((p) => p.fornecedorNome))).filter((n) => !existentes.has(n.trim().toUpperCase()));
  }, [validas, hoteis]);

  const importar = useMutation({
    mutationFn: async () => {
      // 1) Garante um hoteis_fornecedores pra cada Fornecedor visto (cria os que faltam) —
      // hotel_id é obrigatório em hospedagens, não dá pra deixar em branco.
      const { data: hoteisAtuais, error: he } = await supabase.from("hoteis_fornecedores").select("id, nome");
      if (he) throw he;
      const hotelIdByNome = new Map<string, string>((hoteisAtuais ?? []).map((h: any) => [h.nome.trim().toUpperCase(), h.id]));
      const faltando = Array.from(new Set(validas.map((p) => p.fornecedorNome)))
        .filter((n) => !hotelIdByNome.has(n.trim().toUpperCase()));
      if (faltando.length) {
        const { data: criados, error: ce } = await supabase.from("hoteis_fornecedores")
          .insert(faltando.map((nome) => ({ nome, cidade: "Não informado", estado: "NA" })))
          .select("id, nome");
        if (ce) throw ce;
        (criados ?? []).forEach((h: any) => hotelIdByNome.set(h.nome.trim().toUpperCase(), h.id));
      }

      // 2) Insere as hospedagens em lotes, já com o hotel_id resolvido.
      const BATCH = 500;
      for (let i = 0; i < validas.length; i += BATCH) {
        const lote = validas.slice(i, i + BATCH).map((p) => ({
          ...p.payload,
          hotel_id: hotelIdByNome.get(p.fornecedorNome.trim().toUpperCase()),
        }));
        const { error } = await supabase.from("hospedagens").insert(lote);
        if (error) throw error;
        setProgress({ done: Math.min(i + BATCH, validas.length), total: validas.length });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hospedagens"] });
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success(`${validas.length} hospedagem(ns) importada(s).`);
      setPreview(null); setProgress(null); onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importar.isPending) { onOpenChange(o); if (!o) { setPreview(null); setProgress(null); } } }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar planilha de custos — Hospedagem</DialogTitle></DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecione o arquivo "Relatorio_Custos_Stepup..." — os dados da aba "Hospedagem" viram lançamentos novos (uma linha por pessoa).
            </p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Plus className="mr-2 h-4 w-4" />Escolher arquivo</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="p-3"><p className="text-xs text-muted-foreground">Linhas geradas</p><p className="text-xl font-semibold">{preview.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Válidas</p><p className="text-xl font-semibold text-success">{validas.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Com erro</p><p className="text-xl font-semibold text-destructive">{invalidas.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Custo total</p><p className="text-xl font-semibold">{fmtMoney(validas.reduce((a, p) => a + (p.custo ?? 0), 0))}</p></Card>
            </div>
            {fornecedoresNovos.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="mb-1 font-medium text-warning-foreground">{fornecedoresNovos.length} fornecedor(es) novo(s) serão cadastrados em Hotéis (sem cidade/estado — edite depois se precisar)</p>
                <p className="text-muted-foreground">{fornecedoresNovos.join(", ")}</p>
              </div>
            )}
            {invalidas.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {invalidas.length} linha(s) não serão importadas — revise a planilha se o número parecer alto.
              </div>
            )}
            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Data</TableHead><TableHead>Nome</TableHead><TableHead>Fornecedor</TableHead><TableHead>Custo</TableHead><TableHead>Situação</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 200).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{p.data}</TableCell>
                      <TableCell className="text-xs">{p.nome}</TableCell>
                      <TableCell className="text-xs">{p.fornecedorNome}</TableCell>
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
              <Button variant="outline" onClick={() => setPreview(null)} disabled={importar.isPending}>Escolher outro arquivo</Button>
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

// ─── Aba Lançamentos ────────────────────────────────────────────────────────
type HospedagensSortColumn =
  | "unidade" | "bsp" | "nome_usuario" | "hotel" | "check_in" | "check_out" | "diarias" | "valor_diaria" | "valor_total" | "motivo";

function LancamentosTab({ hoteis, hospedagens, periodosE, colaboradores, unidadeOptions, prefill, onPrefillConsumed }: {
  hoteis: HotelFornecedor[]; hospedagens: Hospedagem[]; periodosE: HistNovoPeriodo[];
  colaboradores: { id: string; nome: string }[]; unidadeOptions: string[];
  prefill?: Partial<typeof FORM_VAZIO> | null; onPrefillConsumed?: () => void;
}) {
  const qc = useQueryClient();
  // Nasce sempre no mês atual até hoje (recalculado a cada carregamento da tela, não fica
  // preso na data de quando o código rodou) — assim que ela mudar manualmente, o período
  // escolhido fica fixo pra consulta, sem voltar sozinho.
  const [periodoDe, setPeriodoDe] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [periodoAte, setPeriodoAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [filterHotel, setFilterHotel] = useState("all");
  const [filterMotivo, setFilterMotivo] = useState("all");
  const [filterNome, setFilterNome] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Hospedagem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { sortColumn, sortDirection, toggleSort } = useTableSort<HospedagensSortColumn>();

  useEffect(() => {
    if (prefill) { setEditing(null); setDialogOpen(true); onPrefillConsumed?.(); }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const hotelById = useMemo(() => new Map(hoteis.map((h) => [h.id, h])), [hoteis]);
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, filterUnidade), [periodosE, filterUnidade]);

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hospedagens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hospedagens"] });
      notify.success("Hospedagem excluída");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const filtradas = useMemo(() => hospedagens.filter((h) =>
    // Sobreposição de período — basta a estadia cruzar algum dia do intervalo filtrado.
    (!periodoDe || h.check_out >= periodoDe) &&
    (!periodoAte || h.check_in <= periodoAte) &&
    (filterUnidade === "all" || h.unidade === filterUnidade) &&
    (filterBsp === "all" || h.bsp === filterBsp) &&
    (filterHotel === "all" || h.hotel_id === filterHotel) &&
    (filterMotivo === "all" || (h.motivo ?? "") === filterMotivo) &&
    (!filterNome || matchesNameSearch(h.nome_usuario, filterNome)),
  ).sort((a, b) => {
    // Sem coluna escolhida, mantém a ordem que já vem da consulta (check-in desc, mais recente
    // primeiro — ver useHospedagensQuery).
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "unidade":
        return dir * a.unidade.localeCompare(b.unidade);
      case "bsp":
        return dir * a.bsp.localeCompare(b.bsp);
      case "nome_usuario":
        return dir * a.nome_usuario.localeCompare(b.nome_usuario);
      case "hotel":
        return dir * (hotelById.get(a.hotel_id)?.nome ?? "").localeCompare(hotelById.get(b.hotel_id)?.nome ?? "");
      case "check_in":
        return dir * a.check_in.localeCompare(b.check_in);
      case "check_out":
        return dir * a.check_out.localeCompare(b.check_out);
      case "diarias":
        return dir * (a.diarias - b.diarias);
      case "valor_diaria":
        return dir * (a.valor_diaria - b.valor_diaria);
      case "valor_total":
        return dir * (a.valor_total - b.valor_total);
      case "motivo":
        return dir * (a.motivo ?? "").localeCompare(b.motivo ?? "");
      default:
        return 0;
    }
  }), [hospedagens, periodoDe, periodoAte, filterUnidade, filterBsp, filterHotel, filterMotivo, filterNome, sortColumn, sortDirection, hotelById]);

  // Cascata Cliente → Unidade → BSP → lançamentos — mesmo formato em árvore da aba Equipes
  // Embarcadas / Simulação em Nomeações (chevron pra expandir, total no cabeçalho de cada
  // nível). Hospedagem não tem campo Cliente próprio — usa o mesmo vínculo Unidade→Cliente já
  // confirmado pela operação (clienteDaUnidade, src/lib/clientes.ts), igual à cascata de Nomeações.
  const consolidado = useMemo(() => {
    const porCliente = new Map<string, Map<string, Map<string, Hospedagem[]>>>();
    filtradas.forEach((h) => {
      // Sem BSP, "unidade" é na verdade um setor interno da empresa (Comercial, RH, SGI...),
      // não uma operação offshore — nesse caso o próprio setor vira o rótulo do topo da árvore,
      // em vez de cair genérico em "Base" (reservado pra BSP de verdade cujo vínculo com
      // cliente ainda não foi confirmado).
      const cliente = clienteDaUnidade(h.unidade) ?? (h.bsp?.trim() ? "Base" : h.unidade);
      if (!porCliente.has(cliente)) porCliente.set(cliente, new Map());
      const porUnidade = porCliente.get(cliente)!;
      if (!porUnidade.has(h.unidade)) porUnidade.set(h.unidade, new Map());
      const porBsp = porUnidade.get(h.unidade)!;
      if (!porBsp.has(h.bsp)) porBsp.set(h.bsp, []);
      porBsp.get(h.bsp)!.push(h);
    });
    return Array.from(porCliente.entries())
      .map(([cliente, porUnidade]) => {
        const unidades = Array.from(porUnidade.entries())
          .map(([unidade, porBsp]) => {
            const bsps = Array.from(porBsp.entries())
              .map(([bsp, itens]) => ({
                bsp,
                total: itens.reduce((a, h) => a + h.valor_total, 0),
                itens: [...itens].sort((a, b) => b.check_in.localeCompare(a.check_in)),
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

  const motivosVistos = useMemo(
    () => Array.from(new Set(hospedagens.map((h) => h.motivo).filter((m): m is string => !!m))).sort(),
    [hospedagens],
  );

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - de</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - até</Label>
            <Input type="date" className="h-8 w-36 text-xs" min={periodoDe || undefined} value={periodoAte} onChange={(e) => setPeriodoAte(e.target.value)} />
          </div>
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
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Hotel</Label>
            <Select value={filterHotel} onValueChange={setFilterHotel}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {hoteis.map((h) => <SelectItem key={h.id} value={h.id} className="text-xs">{h.nome}</SelectItem>)}
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
          <div className="space-y-0.5 w-52">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Nome do usuário</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" />Importar planilha de custos
            </Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Nova hospedagem
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
                        // Setor interno (Comercial, RH, SGI...) não tem BSP de verdade — pula o
                        // nível de BSP na árvore, os lançamentos aparecem direto sob a unidade.
                        if (b.bsp === "Não informado") {
                          return (
                            <div key={`${unidadeKey}::sem-bsp`} className="divide-y border-t bg-emerald-50/40 pl-16">
                              {b.itens.map((h) => {
                                const hotel = hotelById.get(h.hotel_id);
                                return (
                                  <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs">
                                    <div className="min-w-0">
                                      <p className="truncate font-medium">{h.nome_usuario}</p>
                                      <p className="text-muted-foreground">{hotel?.nome ?? "—"} · {fmt(h.check_in)} – {fmt(h.check_out)} · {h.diarias}d{h.motivo ? ` · ${h.motivo}` : ""}</p>
                                    </div>
                                    <span className="shrink-0 font-semibold">{fmtMoney(h.valor_total)}</span>
                                  </div>
                                );
                              })}
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
                                {b.itens.map((h) => {
                                  const hotel = hotelById.get(h.hotel_id);
                                  return (
                                    <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">{h.nome_usuario}</p>
                                        <p className="text-muted-foreground">{hotel?.nome ?? "—"} · {fmt(h.check_in)} – {fmt(h.check_out)} · {h.diarias}d{h.motivo ? ` · ${h.motivo}` : ""}</p>
                                      </div>
                                      <span className="shrink-0 font-semibold">{fmtMoney(h.valor_total)}</span>
                                    </div>
                                  );
                                })}
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
              <SortableHead label="Nome do usuário" column="nome_usuario" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Hotel" column="hotel" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Check-in" column="check_in" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Check-out" column="check_out" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Diárias" column="diarias" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Valor diária" column="valor_diaria" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Valor total" column="valor_total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Motivo" column="motivo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.length === 0 ? (
              <EmptyStateRow colSpan={11} icon={BedDouble} title="Nenhuma hospedagem encontrada" />
            ) : filtradas.map((h) => {
              const hotel = hotelById.get(h.hotel_id);
              return (
                <TableRow key={h.id}>
                  <TableCell>{h.unidade}</TableCell>
                  <TableCell>{h.bsp}</TableCell>
                  <TableCell>{h.nome_usuario}</TableCell>
                  <TableCell>{hotel ? `${hotel.nome} — ${localizacaoHotel(hotel)}` : "—"}</TableCell>
                  <TableCell>{fmt(h.check_in)}</TableCell>
                  <TableCell>{fmt(h.check_out)}</TableCell>
                  <TableCell className="text-right">{h.diarias}</TableCell>
                  <TableCell className="text-right">{fmtMoney(h.valor_diaria)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(h.valor_total)}</TableCell>
                  <TableCell>{h.motivo ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(h); setDialogOpen(true); }}>
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
                            <AlertDialogTitle>Excluir hospedagem?</AlertDialogTitle>
                            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(h.id)}>
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <HospedagemDialog
        open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} prefill={editing ? null : prefill}
        hoteis={hoteis} periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
      />
      <ImportCustosHospedagemDialog open={importOpen} onOpenChange={setImportOpen} hoteis={hoteis} />
    </div>
  );
}

// ─── Aba Hotéis (CRUD) ──────────────────────────────────────────────────────
type HoteisSortColumn = "nome" | "cidade" | "estado";

function HoteisTab({ hoteis }: { hoteis: HotelFornecedor[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<HotelFornecedor | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ nome: "", cidade: "", estado: "", endereco: "", telefone: "" });
  const [bound, setBound] = useState<string | null>(null);
  const { sortColumn, sortDirection, toggleSort } = useTableSort<HoteisSortColumn>();

  if (editing && bound !== editing.id) {
    setF({ nome: editing.nome, cidade: editing.cidade, estado: editing.estado, endereco: editing.endereco ?? "", telefone: editing.telefone ?? "" });
    setBound(editing.id);
  }
  if (creating && bound !== "novo") { setF({ nome: "", cidade: "", estado: "", endereco: "", telefone: "" }); setBound("novo"); }

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = {
        nome: f.nome.trim(), cidade: f.cidade.trim(), estado: f.estado.trim().toUpperCase(),
        endereco: f.endereco.trim() || null, telefone: f.telefone.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("hoteis_fornecedores").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hoteis_fornecedores").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success(editing ? "Hotel atualizado" : "Hotel cadastrado");
      setEditing(null); setCreating(false); setBound(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hoteis_fornecedores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success("Hotel excluído");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const dialogOpen = editing !== null || creating;
  const closeDialog = () => { setEditing(null); setCreating(false); setBound(null); };

  const ordenados = useMemo(() => [...hoteis].sort((a, b) => {
    // Sem coluna escolhida, mantém a ordem que já vem da consulta (nome asc — ver useHoteisQuery).
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "nome":
        return dir * a.nome.localeCompare(b.nome);
      case "cidade":
        return dir * a.cidade.localeCompare(b.cidade);
      case "estado":
        return dir * a.estado.localeCompare(b.estado);
      default:
        return 0;
    }
  }), [hoteis, sortColumn, sortDirection]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" />Novo hotel
        </Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Nome" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Cidade" column="cidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Estado" column="estado" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead>Endereço</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenados.length === 0 ? (
              <EmptyStateRow colSpan={6} icon={Hotel} title="Nenhum hotel cadastrado" />
            ) : ordenados.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.nome}</TableCell>
                <TableCell>{h.cidade}</TableCell>
                <TableCell>{h.estado}</TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">{h.endereco ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{h.telefone ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(h)}>
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
                          <AlertDialogTitle>Excluir hotel?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Hospedagens já lançadas com esse hotel não podem ser excluídas junto — se houver alguma vinculada, a exclusão vai falhar.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(h.id)}>
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

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar hotel" : "Novo hotel"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs">Nome</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
            <div><Label className="text-xs">Cidade</Label><Input value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} /></div>
            <div><Label className="text-xs">Estado (UF)</Label><Input maxLength={2} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value.toUpperCase() })} /></div>
            <div><Label className="text-xs">Endereço</Label><Input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} /></div>
            <div><Label className="text-xs">Telefone</Label><Input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button disabled={!f.nome.trim() || !f.cidade.trim() || !f.estado.trim()} loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Página principal ───────────────────────────────────────────────────────
function HospedagemPage() {
  const { data: hoteis = [], isLoading: l1 } = useHoteisQuery();
  const { data: hospedagens = [], isLoading: l2 } = useHospedagensQuery();
  const { data: periodos = [], isLoading: l3 } = usePeriodosEQuery();
  const { data: colaboradores = [], isLoading: l4 } = useColaboradoresQuery();

  // Vem preenchido quando outro módulo (ex.: Passagens Aéreas, ao marcar uma passagem como
  // Cancelada) navega pra cá pedindo pra abrir o formulário já com unidade/bsp/nome/motivo.
  const search = useSearch({ from: "/admin/hospedagem" });
  const navigate = useNavigate();
  const prefill = useMemo(() => {
    if (!search.prefillUnidade && !search.prefillBsp && !search.prefillNome && !search.prefillMotivo) return null;
    return {
      unidade: search.prefillUnidade ?? "", bsp: search.prefillBsp ?? "",
      nomeUsuario: search.prefillNome ?? "", motivo: search.prefillMotivo ?? "",
    };
  }, [search]);
  const limparPrefill = () => navigate({ to: "/admin/hospedagem", search: {} });

  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);
  const unidadeOptions = useMemo(() => {
    // "Outros" sempre por último — não é unidade real, é só o catch-all pra quem não se encaixa
    // em nenhuma das operacionais, então não faz sentido ordenar alfabeticamente junto.
    const nomeadas = Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort();
    return [...nomeadas, "Outros"];
  }, [periodos]);

  if (l1 || l2 || l3 || l4) {
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
                <TableHead>Hotel</TableHead><TableHead>Check-in</TableHead><TableHead>Check-out</TableHead>
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
        <BedDouble className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Hospedagem</h1>
      </div>

      <Tabs defaultValue="lancamentos">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="hoteis">Hotéis</TabsTrigger>
        </TabsList>
        <TabsContent value="lancamentos" className="mt-4">
          <LancamentosTab
            hoteis={hoteis} hospedagens={hospedagens} periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
            prefill={prefill} onPrefillConsumed={limparPrefill}
          />
        </TabsContent>
        <TabsContent value="hoteis" className="mt-4">
          <HoteisTab hoteis={hoteis} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
