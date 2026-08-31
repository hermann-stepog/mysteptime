import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bm_mob_desmob_costs ainda não está no types.ts gerado — mesmo padrão das outras tabelas de BM.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { Plus, Trash2, Truck, Upload, Send, ChevronRight, ChevronDown, RefreshCw, BedDouble, Car, Percent, Undo2 } from "lucide-react";
import { type BmMobDesmobCost, type MobDesmobCategoria, type TipoMarkup } from "@/lib/bm";
import { listSmartsheetBms } from "@/lib/api/smartsheetBm.functions";

interface SmartsheetBm {
  rowId: string;
  bmNumber: string;
  poNumber: string | null;
  client: string | null;
  vessel: string | null;
  value: number | null;
  date: string | null;
}

function fmt(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}
function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── Markup opcional no "Aplicar ao BM" por cartão ────────────────────────────────────────
// Cálculo direto sobre o total do cartão (não por lançamento) — sem goal-seek, as duas
// fórmulas já isolam o valor final:
//   Simples:        valorFinal = valorBase * (1 + lucro/100)
//   Com imposto:     valorFinal = valorBase * (1 + lucro/100) / (1 - imposto/100)
function calcularValorComMarkup(valorBase: number, tipo: TipoMarkup, percentualLucro: number, percentualImposto: number): number {
  const bruto = valorBase * (1 + percentualLucro / 100);
  if (tipo === "simples") return round2(bruto);
  return round2(bruto / (1 - percentualImposto / 100));
}

interface MarkupResultado {
  incluiuMarkup: boolean;
  tipoMarkup: TipoMarkup | null;
  percentualLucro: number | null;
  percentualImposto: number | null;
  valorPendenteOriginal: number;
  valorMarkupCalculado: number;
  valorFinal: number;
}

// ── Import da planilha de custos (transporte / hotel) ────────────────────────
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string[]> = {
  nome: ["nome", "name", "colaborador", "passageiro", "hospede", "funcionario"],
  bsp: ["bsp", "projeto", "project", "bspnumber", "obra"],
  data: ["data", "date", "dia"],
  categoria: ["categoria", "tipo", "type", "servico", "category"],
  qtd: ["qtd", "quantidade", "qty", "quantity", "diarias"],
  valor: ["valor", "valorunitario", "value", "unitvalue", "preco", "unitprice", "vlrunit"],
  markup: ["markup", "taxa", "fee"],
  total: ["total", "totalcost", "valortotal", "custototal"],
  notes: ["notes", "obs", "observacao", "observacoes", "descricao", "description", "detalhe"],
  period_start: ["periodoinicio", "inicio", "checkin", "datainicio", "de", "periodstart"],
  period_end: ["periodofim", "fim", "checkout", "datafim", "ate", "periodend"],
};

function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = norm(String(h ?? ""));
    if (!n) return;
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (out[key] != null) continue;
      if (aliases.some((a) => n === a || n.startsWith(a) || a.startsWith(n))) out[key] = i;
    }
  });
  return out;
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function detectCategoria(...campos: (string | null | undefined)[]): MobDesmobCategoria {
  const txt = norm(campos.filter(Boolean).join(" "));
  if (/hotel|hospedag|pousada|diaria|acomodac|lodging|accommodation/.test(txt)) return "hotel";
  if (/transp|taxi|van|onibus|bus|carro|car|voo|aereo|flight|passagem|traslado|transfer|locacaoveiculo/.test(txt)) {
    return "transporte";
  }
  return "outros";
}

interface ParsedRow {
  nome: string; bsp: string; data: string; categoria: MobDesmobCategoria;
  qtd: number; valor: number; markup: number | null; total_cost: number;
  notes: string | null; period_start: string | null; period_end: string | null;
}

function parsePlanilha(buf: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const rows: ParsedRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    if (!matrix.length) continue;
    // acha a linha de cabeçalho (primeira que casa com pelo menos 2 colunas conhecidas)
    let headerIdx = -1;
    let cols: Record<string, number> = {};
    for (let i = 0; i < Math.min(matrix.length, 15); i++) {
      const c = mapHeaders((matrix[i] ?? []).map((x) => String(x ?? "")));
      if (Object.keys(c).length >= 2 && c.bsp != null) { headerIdx = i; cols = c; break; }
      if (Object.keys(c).length >= 3 && headerIdx === -1) { headerIdx = i; cols = c; }
    }
    if (headerIdx === -1) continue;

    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const r = matrix[i] ?? [];
      const get = (k: string) => (cols[k] != null ? r[cols[k]] : undefined);
      const nome = String(get("nome") ?? "").trim();
      const bsp = String(get("bsp") ?? "").trim();
      const notes = String(get("notes") ?? "").trim() || null;
      const data = toIsoDate(get("data")) ?? toIsoDate(get("period_start"));
      if (!bsp && !nome) continue;
      if (!data) continue;
      const qtd = num(get("qtd")) || 1;
      const valor = num(get("valor"));
      const markupRaw = get("markup");
      const markup = markupRaw === undefined || markupRaw === "" ? null : num(markupRaw);
      const totalCol = get("total");
      const total_cost = totalCol !== undefined && totalCol !== "" ? num(totalCol) : round2(qtd * valor + (markup ?? 0));
      if (!total_cost && !valor) continue;
      const categoria = detectCategoria(String(get("categoria") ?? ""), notes, sheetName);
      rows.push({
        nome: nome || "—",
        bsp: bsp || "SEM BSP",
        data,
        categoria,
        qtd,
        valor: valor || round2(total_cost / (qtd || 1)),
        markup,
        total_cost: round2(total_cost),
        notes,
        period_start: toIsoDate(get("period_start")),
        period_end: toIsoDate(get("period_end")),
      });
    }
  }
  return rows;
}

const CATEGORIA_LABEL: Record<MobDesmobCategoria, string> = {
  transporte: "Transporte", hotel: "Hotel", outros: "Outros",
};

// O campo "bsp" do lançamento já vem como "código,unidade" (ex.: "BEP 25-1315,PCH-1") — é
// assim que a planilha de custos importada guarda os dois juntos num campo só, sem coluna de
// unidade separada. Lançamento manual (sem vírgula) cai no grupo "Sem unidade".
function parseBspUnidade(bsp: string): { codigo: string; unidade: string } {
  const partes = (bsp ?? "").split(",");
  if (partes.length < 2) return { codigo: (bsp ?? "").trim(), unidade: "Sem unidade" };
  return { codigo: partes[0].trim(), unidade: partes.slice(1).join(",").trim() || "Sem unidade" };
}

// Pré-preenche a busca de BM do diálogo "Aplicar ao BM" com a unidade do BSP daquele cartão —
// a lista de BMs do Smartsheet (SmartsheetBm.vessel) já entra nesse mesmo filtro de busca, então
// isso já chega filtrado, sem precisar procurar na lista inteira. Sem unidade reconhecível
// (lançamento manual, sem vírgula), volta pra busca vazia — mostra tudo, como antes.
function buscaInicialParaBsp(bsp: string | null): string {
  if (!bsp) return "";
  const { unidade } = parseBspUnidade(bsp);
  return unidade === "Sem unidade" ? "" : unidade;
}

interface NovoCusto {
  nome: string; bsp: string; data: string; qtd: string; valor: string;
  markup: string; notes: string; categoria: MobDesmobCategoria;
}
const NOVO_CUSTO_VAZIO: NovoCusto = {
  nome: "", bsp: "", data: "", qtd: "1", valor: "", markup: "", notes: "", categoria: "transporte",
};

const TODOS = "__todos__";

interface MobDesmobTabProps {
  // Contexto vindo do assistente "Gerar BM" (aba irmã) — quando existe, o lançamento manual já
  // abre com o BSP preenchido e o diálogo "Aplicar ao BM" oferece o BM em geração como alvo.
  bmEmGeracao?: { bsp: string; bmNumber: string } | null;
  onAplicadoNoBmEmGeracao?: () => void;
}

export function MobDesmobTab({ bmEmGeracao = null, onAplicadoNoBmEmGeracao }: MobDesmobTabProps = {}) {

  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [novo, setNovo] = useState<NovoCusto>(NOVO_CUSTO_VAZIO);
  const [lancamentoAberto, setLancamentoAberto] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [aplicarBsp, setAplicarBsp] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [bmSelecionado, setBmSelecionado] = useState<SmartsheetBm | null>(null);
  // Filtro por período (data do lançamento) — só afeta a visualização/aplicação em lote.
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  // Filtro por Unidade/BSP — só entra em ação a partir da 3ª letra digitada, pra não filtrar
  // tudo fora com 1-2 caracteres ainda incompletos.
  const [filtroUnidade, setFiltroUnidade] = useState("");
  const [filtroBsp, setFiltroBsp] = useState("");
  // Seleção individual de lançamentos pendentes (ids) — "Aplicar ao BM" de um BSP aplica só
  // os marcados aqui; se nada estiver marcado naquele BSP, cai no comportamento antigo
  // (aplica todos os pendentes do grupo).
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // Etapa de confirmação de markup — só existe no fluxo por cartão ("Aplicar ao BM"), nunca
  // no "Aplicar tudo ao BM" do topo. markupBsp aberto = modal "Incluir Markup?" visível;
  // markupResultado é o que foi decidido lá, consumido depois no diálogo de escolha do BM.
  const [markupBsp, setMarkupBsp] = useState<string | null>(null);
  const [markupStep, setMarkupStep] = useState<"ask" | "form">("ask");
  const [markupTipo, setMarkupTipo] = useState<TipoMarkup>("simples");
  const [markupLucro, setMarkupLucro] = useState("15");
  const [markupImposto, setMarkupImposto] = useState("13");
  const [markupResultado, setMarkupResultado] = useState<MarkupResultado | null>(null);

  // Alvo "BM em geração": entrada sintética (não vem do Smartsheet) pra aplicar direto no BM
  // que o assistente está montando na aba ao lado.
  const bmEmGeracaoOption: SmartsheetBm | null = bmEmGeracao?.bmNumber?.trim()
    ? { rowId: "__em_geracao__", bmNumber: bmEmGeracao.bmNumber.trim(), poNumber: null, client: null, vessel: null, value: null, date: null }
    : null;

  // Chegou pela ação "Adicionar custo" do assistente: já abre o lançamento manual com o BSP
  // preenchido, pra ela só completar nome/valor.
  const contextoAplicadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bmEmGeracao?.bsp) return;
    const chave = `${bmEmGeracao.bsp}::${bmEmGeracao.bmNumber}`;
    if (contextoAplicadoRef.current === chave) return;
    contextoAplicadoRef.current = chave;
    setLancamentoAberto(true);
    setNovo((n) => ({ ...n, bsp: n.bsp || bmEmGeracao.bsp }));
  }, [bmEmGeracao]);

  // Ao abrir o diálogo de escolha do BM com um BM em geração conhecido, ele já vem marcado.
  useEffect(() => {
    if (aplicarBsp && bmEmGeracaoOption && !bmSelecionado) setBmSelecionado(bmEmGeracaoOption);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aplicarBsp]);

  function toggleSelecionado(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelecionadosGrupo(ids: string[], marcar: boolean) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => { if (marcar) next.add(id); else next.delete(id); });
      return next;
    });
  }


  const fetchBms = useServerFn(listSmartsheetBms);

  const { data: custos = [], isFetching } = useQuery({
    queryKey: ["bm-mob-desmob-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_mob_desmob_costs").select("*").order("bsp").order("data");
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c,
        qtd: Number(c.qtd) || 0,
        valor: Number(c.valor) || 0,
        markup: c.markup == null ? null : Number(c.markup),
        total_cost: Number(c.total_cost) || 0,
      })) as BmMobDesmobCost[];
    },
  });

  // Markups já aplicados por cartão (histórico) — só existe pro fluxo por BSP, nunca pro
  // "Aplicar tudo ao BM". Se a tabela ainda não existir no banco (migration não aplicada),
  // a query cai em erro e isso aqui vira [] silenciosamente — o resto da aba continua normal.
  const { data: markupsAplicados = [] } = useQuery({
    queryKey: ["bm-mob-desmob-markups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_mob_desmob_markups").select("bsp, incluiu_markup, valor_markup_calculado");
      if (error) throw error;
      return (data ?? []) as { bsp: string; incluiu_markup: boolean; valor_markup_calculado: number }[];
    },
  });

  // Agrupamento por BSP — cada BSP vira um cartão com seus custos de transporte e hotel.
  const custosFiltrados = useMemo(() => {
    const qUnidade = filtroUnidade.trim().length >= 3 ? norm(filtroUnidade) : "";
    const qBsp = filtroBsp.trim().length >= 3 ? norm(filtroBsp) : "";
    return custos.filter((c) => {
      if (dataDe && (c.data ?? "") < dataDe) return false;
      if (dataAte && (c.data ?? "") > dataAte) return false;
      if (qUnidade || qBsp) {
        const { codigo, unidade } = parseBspUnidade(c.bsp);
        if (qUnidade && !norm(unidade).includes(qUnidade)) return false;
        if (qBsp && !norm(codigo).includes(qBsp)) return false;
      }
      return true;
    });
  }, [custos, dataDe, dataAte, filtroUnidade, filtroBsp]);

  const grupos = useMemo(() => {
    const map = new Map<string, BmMobDesmobCost[]>();
    for (const c of custosFiltrados) {
      const arr = map.get(c.bsp) ?? [];
      arr.push(c);
      map.set(c.bsp, arr);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bsp, itens]) => {
        const soma = (f: (c: BmMobDesmobCost) => boolean) =>
          round2(itens.filter(f).reduce((a, c) => a + c.total_cost, 0));
        const pendentes = itens.filter((c) => !c.applied);
        const markupAplicado = round2(
          markupsAplicados
            .filter((m) => m.bsp === bsp && m.incluiu_markup)
            .reduce((a, m) => a + (Number(m.valor_markup_calculado) || 0), 0),
        );
        return {
          bsp,
          itens,
          markupAplicado,
          pendentes,
          transporte: soma((c) => c.categoria === "transporte"),
          hotel: soma((c) => c.categoria === "hotel"),
          outros: soma((c) => c.categoria === "outros"),
          total: soma(() => true),
          totalPendente: round2(pendentes.reduce((a, c) => a + c.total_cost, 0)),
          bmsAplicados: Array.from(new Set(itens.filter((c) => c.applied && c.applied_bm_number).map((c) => c.applied_bm_number!))),
        };
      });
  }, [custosFiltrados, markupsAplicados]);

  // Agrupa os cartões de BSP (acima) por Unidade — cada BSP só pertence a uma unidade
  // (ver parseBspUnidade), então isso é só reorganizar o que já existe, sem recalcular nada.
  const gruposPorUnidade = useMemo(() => {
    const map = new Map<string, typeof grupos>();
    for (const g of grupos) {
      const { unidade } = parseBspUnidade(g.bsp);
      const arr = map.get(unidade) ?? [];
      arr.push(g);
      map.set(unidade, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([unidade, gruposDaUnidade]) => ({
        unidade,
        grupos: gruposDaUnidade,
        total: round2(gruposDaUnidade.reduce((a, g) => a + g.total, 0)),
        totalPendente: round2(gruposDaUnidade.reduce((a, g) => a + g.totalPendente, 0)),
      }));
  }, [grupos]);

  const importar = useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer();
      const linhas = parsePlanilha(buf);
      if (!linhas.length) throw new Error("Nenhuma linha reconhecida na planilha. Verifique as colunas (Nome, BSP, Data, Categoria, Qtd, Valor, Total).");
      const batch = `${file.name} · ${new Date().toISOString()}`;

      // Reimportar uma planilha atualizada não pode ir empilhando lançamento em cima de
      // lançamento antigo pro mesmo BSP — troca (substitui) em vez de acumular. Só mexe no que
      // ainda está pendente: custo já aplicado a um BM virou parte de um BM gerado e não pode
      // sumir por baixo dele só porque uma planilha nova foi importada depois.
      const bspsNoArquivo = Array.from(new Set(linhas.map((l) => l.bsp)));
      const { data: substituidos, error: delErr } = await supabase
        .from("bm_mob_desmob_costs")
        .delete()
        .eq("applied", false)
        .in("bsp", bspsNoArquivo)
        .select("id");
      if (delErr) throw delErr;

      const { error } = await supabase.from("bm_mob_desmob_costs")
        .insert(linhas.map((l) => ({ ...l, import_batch: batch })));
      if (error) throw error;
      return { novos: linhas.length, substituidos: substituidos?.length ?? 0, bsps: bspsNoArquivo.length };
    },
    onSuccess: ({ novos, substituidos, bsps }) => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      notify.success(
        substituidos > 0
          ? `${novos} custo(s) importado(s) pra ${bsps} BSP(s) — ${substituidos} lançamento(s) pendente(s) anterior(es) substituído(s).`
          : `${novos} custo(s) importado(s) e distribuído(s) por BSP.`,
      );
    },
    onError: (e: any) => notify.error(e.message || "Erro ao importar planilha."),
  });

  const criarCusto = useMutation({
    mutationFn: async () => {
      if (!novo.nome.trim()) throw new Error("Informe o nome.");
      if (!novo.bsp.trim()) throw new Error("Informe o BSP.");
      if (!novo.data) throw new Error("Informe a data.");
      const qtd = Number(novo.qtd) || 0;
      const valor = Number(novo.valor) || 0;
      const markup = novo.markup.trim() ? Number(novo.markup) : null;
      const { error } = await supabase.from("bm_mob_desmob_costs").insert({
        nome: novo.nome.trim(), bsp: novo.bsp.trim(), data: novo.data, categoria: novo.categoria,
        qtd, valor, markup, total_cost: round2(qtd * valor + (markup ?? 0)), notes: novo.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      notify.success("Custo de Mob/Desmob lançado.");
      setNovo(NOVO_CUSTO_VAZIO);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao lançar custo."),
  });

  const excluirCusto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bm_mob_desmob_costs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      notify.success("Custo excluído.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao excluir custo."),
  });

  const { data: bms = [], isFetching: carregandoBms, refetch: recarregarBms } = useQuery<SmartsheetBm[]>({
    queryKey: ["smartsheet-bm-list"],
    queryFn: async () => (await fetchBms()) as SmartsheetBm[],
    enabled: !!aplicarBsp,
    staleTime: 5 * 60 * 1000,
  });

  const bmsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return bms;
    return bms.filter((b) => [b.bmNumber, b.poNumber, b.client, b.vessel].some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [bms, busca]);

  // Pré-preenche a busca com a unidade do BSP só depois que a lista de BMs carrega e ela
  // realmente encontra alguma coisa — a nomenclatura do Smartsheet às vezes não bate com a
  // unidade extraída do campo "bsp" (ver parseBspUnidade), e pré-preencher sem checar isso
  // travava a busca numa lista vazia, sem nenhum BM pra escolher e o "Aplicar" sempre
  // desabilitado. Sem correspondência nenhuma, a busca continua vazia — mostra a lista
  // inteira, como sempre foi antes desse atalho existir. Só tenta uma vez por abertura do
  // diálogo (tentativaRef), pra não "puxar de volta" o texto se ela limpar a busca na mão
  // depois de já ter carregado.
  const tentativaAutoBuscaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!aplicarBsp || aplicarBsp === TODOS) { tentativaAutoBuscaRef.current = null; return; }
    if (tentativaAutoBuscaRef.current === aplicarBsp || bms.length === 0) return;
    tentativaAutoBuscaRef.current = aplicarBsp;
    const candidata = buscaInicialParaBsp(aplicarBsp);
    if (!candidata) return;
    const q = candidata.toLowerCase();
    const bate = bms.some((b) => [b.bmNumber, b.poNumber, b.client, b.vessel].some((v) => String(v ?? "").toLowerCase().includes(q)));
    if (bate) setBusca(candidata);
  }, [aplicarBsp, bms]);

  // Pendentes de um BSP específico a considerar numa aplicação: se houver itens marcados
  // naquele BSP, só os marcados; sem marcação, cai no comportamento antigo (todos os
  // pendentes do grupo). Reaproveitado tanto pelo modal de markup quanto pelo de aplicar.
  function grupoParaBsp(bsp: string) {
    const g = grupos.find((g) => g.bsp === bsp);
    if (!g) return null;
    const marcadosDoGrupo = g.pendentes.filter((c) => selecionados.has(c.id));
    const usandoSelecao = marcadosDoGrupo.length > 0;
    const pendentes = usandoSelecao ? marcadosDoGrupo : g.pendentes;
    const soma = (f: (c: BmMobDesmobCost) => boolean) =>
      round2(pendentes.filter(f).reduce((a, c) => a + c.total_cost, 0));
    return {
      bsp: g.bsp,
      pendentes,
      transporte: soma((c) => c.categoria === "transporte"),
      hotel: soma((c) => c.categoria === "hotel"),
      totalPendente: round2(pendentes.reduce((a, c) => a + c.total_cost, 0)),
      usandoSelecao,
    };
  }

  // "__todos__" = aplicar em lote tudo o que está pendente no período filtrado (sem markup —
  // essa etapa é exclusiva do fluxo por cartão). Pra um BSP específico, reaproveita grupoParaBsp.
  const grupoAplicando = useMemo(() => {
    if (aplicarBsp === TODOS) {
      const pendentes = grupos.flatMap((g) => g.pendentes);
      const soma = (f: (c: BmMobDesmobCost) => boolean) =>
        round2(custosFiltrados.filter(f).reduce((a, c) => a + c.total_cost, 0));
      return {
        bsp: TODOS,
        pendentes,
        transporte: soma((c) => c.categoria === "transporte"),
        hotel: soma((c) => c.categoria === "hotel"),
        totalPendente: round2(pendentes.reduce((a, c) => a + c.total_cost, 0)),
        usandoSelecao: false,
      };
    }
    return aplicarBsp ? grupoParaBsp(aplicarBsp) : null;
  }, [grupos, custosFiltrados, aplicarBsp, selecionados]);

  const grupoMarkup = useMemo(() => (markupBsp ? grupoParaBsp(markupBsp) : null), [grupos, markupBsp, selecionados]);

  const valorMarkupPreview = useMemo(() => {
    if (!grupoMarkup) return null;
    const lucro = Number(markupLucro.replace(",", "."));
    const imposto = Number(markupImposto.replace(",", "."));
    if (!Number.isFinite(lucro) || lucro < 0) return null;
    if (markupTipo === "com_imposto" && (!Number.isFinite(imposto) || imposto < 0 || imposto >= 100)) return null;
    const valorFinal = calcularValorComMarkup(grupoMarkup.totalPendente, markupTipo, lucro, imposto);
    return { valorBase: grupoMarkup.totalPendente, valorFinal, valorMarkup: round2(valorFinal - grupoMarkup.totalPendente), lucro, imposto };
  }, [grupoMarkup, markupTipo, markupLucro, markupImposto]);

  const aplicar = useMutation({
    mutationFn: async () => {
      if (!grupoAplicando) throw new Error("Selecione um BSP.");
      if (!bmSelecionado) throw new Error("Selecione um BM.");
      if (!grupoAplicando.pendentes.length) throw new Error("Nenhum custo pendente neste BSP.");
      const { error } = await supabase.from("bm_mob_desmob_costs").update({
        applied: true,
        applied_bm_number: bmSelecionado.bmNumber,
        applied_at: new Date().toISOString(),
      }).in("id", grupoAplicando.pendentes.map((c) => c.id));
      if (error) throw error;

      // Registro do markup só existe no fluxo por cartão — nunca no "Aplicar tudo ao BM".
      if (aplicarBsp !== TODOS) {
        const incluiuMarkup = markupResultado?.incluiuMarkup ?? false;
        const valorPendenteOriginal = markupResultado?.valorPendenteOriginal ?? grupoAplicando.totalPendente;
        const { error: markupError } = await supabase.from("bm_mob_desmob_markups").insert({
          bsp: grupoAplicando.bsp,
          applied_bm_number: bmSelecionado.bmNumber,
          custo_ids: grupoAplicando.pendentes.map((c) => c.id),
          incluiu_markup: incluiuMarkup,
          tipo_markup: incluiuMarkup ? markupResultado?.tipoMarkup ?? null : null,
          percentual_lucro: incluiuMarkup ? markupResultado?.percentualLucro ?? null : null,
          percentual_imposto: incluiuMarkup ? markupResultado?.percentualImposto ?? null : null,
          valor_pendente_original: valorPendenteOriginal,
          valor_markup_calculado: incluiuMarkup ? markupResultado?.valorMarkupCalculado ?? 0 : 0,
          valor_final: incluiuMarkup ? markupResultado?.valorFinal ?? valorPendenteOriginal : valorPendenteOriginal,
        });
        if (markupError) throw markupError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-aplicados"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-markups"] });
      const n = grupoAplicando?.pendentes.length ?? 0;
      notify.success(
        aplicarBsp === TODOS
          ? `Custos pendentes aplicados ao BM ${bmSelecionado?.bmNumber}.`
          : grupoAplicando?.usandoSelecao
            ? `${n} custo(s) selecionado(s) de ${aplicarBsp} aplicados ao BM ${bmSelecionado?.bmNumber}.`
            : `Custos de ${aplicarBsp} aplicados ao BM ${bmSelecionado?.bmNumber}.`,
      );
      setSelecionados((prev) => {
        const next = new Set(prev);
        grupoAplicando?.pendentes.forEach((c) => next.delete(c.id));
        return next;
      });
      const eraBmEmGeracao = bmSelecionado?.rowId === "__em_geracao__";
      setAplicarBsp(null);
      setBmSelecionado(null);
      setMarkupResultado(null);
      // Aplicou no BM que está sendo montado — volta pro assistente, que recarrega os totais.
      if (eraBmEmGeracao) onAplicadoNoBmEmGeracao?.();
    },

    onError: (e: any) => notify.error(e.message || "Erro ao aplicar custos ao BM."),
  });

  const desfazerAplicacao = useMutation({
    mutationFn: async (bsp: string) => {
      const aplicados = custos
        .filter((c) => c.bsp === bsp && c.applied && c.applied_at)
        .sort((a, b) => (b.applied_at ?? "").localeCompare(a.applied_at ?? ""));
      const maisRecente = aplicados[0];
      if (!maisRecente?.applied_at) throw new Error("Nenhuma aplicação encontrada neste BSP.");

      const itensDaAplicacao = aplicados.filter((c) => c.applied_at === maisRecente.applied_at);
      const ids = itensDaAplicacao.map((c) => c.id);
      const bmNumber = maisRecente.applied_bm_number;

      const { error } = await supabase.from("bm_mob_desmob_costs").update({
        applied: false,
        applied_bm_number: null,
        applied_at: null,
      }).in("id", ids);
      if (error) throw error;

      if (bmNumber) {
        const { data: markups, error: markupsError } = await supabase
          .from("bm_mob_desmob_markups")
          .select("id, custo_ids")
          .eq("bsp", bsp)
          .eq("applied_bm_number", bmNumber);
        if (markupsError) throw markupsError;

        const idsSet = new Set(ids);
        const markupIds = (markups ?? [])
          .filter((m: { custo_ids: string[] }) => (m.custo_ids ?? []).some((id) => idsSet.has(id)))
          .map((m: { id: string }) => m.id);
        if (markupIds.length) {
          const { error: deleteMarkupError } = await supabase
            .from("bm_mob_desmob_markups").delete().in("id", markupIds);
          if (deleteMarkupError) throw deleteMarkupError;
        }
      }

      return { quantidade: ids.length, bmNumber };
    },
    onSuccess: ({ quantidade, bmNumber }) => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-aplicados"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-markups"] });
      notify.success(`${quantidade} custo(s) removido(s) do BM ${bmNumber ?? "selecionado"}.`);
    },
    onError: (e: any) => notify.error(e.message || "Erro ao desfazer a aplicação."),
  });

  const totalPendenteFiltrado = round2(grupos.reduce((a, g) => a + g.totalPendente, 0));


  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Custos de Transporte e Hotel por período</h3>
            <p className="text-xs text-muted-foreground">
              Importe a planilha de custos — os lançamentos nascem distribuídos por BSP em cartões abaixo.
              Reimportar substitui os lançamentos ainda pendentes do(s) mesmo(s) BSP(s), sem duplicar;
              custo já aplicado a um BM não é tocado.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importar.mutate(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()} loading={importar.isPending}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />Importar planilha
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLancamentoAberto((v) => !v)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Lançar manual
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" className="h-8 w-[150px] text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" className="h-8 w-[150px] text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Unidade</Label>
            <Input
              className="h-8 w-[180px] text-xs" placeholder="Digite 3+ letras..."
              value={filtroUnidade} onChange={(e) => setFiltroUnidade(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">BSP</Label>
            <Input
              className="h-8 w-[180px] text-xs" placeholder="Digite 3+ letras..."
              value={filtroBsp} onChange={(e) => setFiltroBsp(e.target.value)}
            />
          </div>
          {(dataDe || dataAte || filtroUnidade || filtroBsp) && (
            <Button size="sm" variant="ghost" onClick={() => { setDataDe(""); setDataAte(""); setFiltroUnidade(""); setFiltroBsp(""); }}>Limpar</Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Pendente no período: <span className="font-semibold">{fmtMoney(totalPendenteFiltrado)}</span>
            </span>
            <Button size="sm" disabled={totalPendenteFiltrado <= 0}
              onClick={() => { setAplicarBsp(TODOS); setBmSelecionado(null); setBusca(""); setMarkupResultado(null); }}>
              <Send className="mr-1.5 h-3.5 w-3.5" />Aplicar tudo ao BM
            </Button>
          </div>
        </div>



        {lancamentoAberto && (
          <div className="mt-4 space-y-3 border-t pt-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Nome</Label>
                <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex: João da Silva" />
              </div>
              <div>
                <Label className="text-xs">BSP</Label>
                <Input value={novo.bsp} onChange={(e) => setNovo({ ...novo, bsp: e.target.value })} placeholder="Ex: 26-465" />
              </div>
              <div>
                <Label className="text-xs">Categoria</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={novo.categoria}
                  onChange={(e) => setNovo({ ...novo, categoria: e.target.value as MobDesmobCategoria })}
                >
                  <option value="transporte">Transporte</option>
                  <option value="hotel">Hotel</option>
                  <option value="outros">Outros</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Data</Label>
                <Input type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Qtd</Label>
                <Input type="number" value={novo.qtd} onChange={(e) => setNovo({ ...novo, qtd: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Valor unitário</Label>
                <Input type="number" step="0.01" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Markup (opcional)</Label>
                <Input type="number" step="0.01" value={novo.markup} onChange={(e) => setNovo({ ...novo, markup: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input value={novo.notes} onChange={(e) => setNovo({ ...novo, notes: e.target.value })} placeholder="Ex: Hotel for Cancelled Mobilization" />
              </div>
            </div>
            <Button size="sm" onClick={() => criarCusto.mutate()} loading={criarCusto.isPending}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Incluir
            </Button>
          </div>
        )}
      </Card>

      {grupos.length === 0 && !isFetching && (
        <Card className="p-8">
          <EmptyState icon={Truck} title="Nenhum custo de Mob/Desmob"
            description="Importe a planilha de transporte e hotel para gerar os cartões por BSP." />
        </Card>
      )}

      {gruposPorUnidade.map((u) => (
        <div key={u.unidade} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{u.unidade}</h3>
            <span className="text-xs text-muted-foreground">
              Total: <strong>{fmtMoney(u.total)}</strong>
              {u.totalPendente > 0 && <> · Pendente: <strong>{fmtMoney(u.totalPendente)}</strong></>}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {u.grupos.map((g) => {
          const aberto = !!abertos[g.bsp];
          return (
            <Card key={g.bsp} className="p-4 space-y-3 transition-colors hover:border-primary/40">
              {/* O cartão inteiro é clicável: abre/fecha o detalhamento dos lançamentos do BSP. */}
              <div
                role="button" tabIndex={0}
                aria-expanded={aberto}
                className="flex cursor-pointer items-start justify-between gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setAbertos((p) => ({ ...p, [g.bsp]: !aberto }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setAbertos((p) => ({ ...p, [g.bsp]: !aberto }));
                  }
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                    <h4 className="truncate text-sm font-semibold">BSP {g.bsp}</h4>
                    {g.bmsAplicados.map((b) => (
                      <Badge key={b} variant="secondary" className="text-[10px]">BM {b}</Badge>
                    ))}
                  </div>
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">
                    {g.itens.length} lançamento(s) · {aberto ? "clique para recolher" : "clique para ver o detalhe"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmtMoney(g.total)}</p>
                  {g.totalPendente > 0 && (
                    <p className="text-[11px] text-muted-foreground">Pendente: {fmtMoney(g.totalPendente)}</p>
                  )}
                  {g.markupAplicado > 0 && (
                    <p className="text-[11px] font-medium text-emerald-700">Markup aplicado: {fmtMoney(g.markupAplicado)}</p>
                  )}
                  {g.pendentes.some((c) => selecionados.has(c.id)) && (
                    <p className="text-[11px] font-medium text-primary">
                      {g.pendentes.filter((c) => selecionados.has(c.id)).length} selecionado(s)
                    </p>
                  )}
                </div>
              </div>

              <div
                className="grid cursor-pointer grid-cols-3 gap-2 text-xs"
                onClick={() => setAbertos((p) => ({ ...p, [g.bsp]: !aberto }))}
              >
                <div className="rounded-md border p-2">
                  <p className="flex items-center gap-1 text-muted-foreground"><Car className="h-3 w-3" />Transporte</p>
                  <p className="font-medium">{fmtMoney(g.transporte)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="flex items-center gap-1 text-muted-foreground"><BedDouble className="h-3 w-3" />Hotel</p>
                  <p className="font-medium">{fmtMoney(g.hotel)}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-muted-foreground">Outros</p>
                  <p className="font-medium">{fmtMoney(g.outros)}</p>
                </div>
              </div>

              {aberto && (
                <div className="hidden overflow-x-auto xl:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          {g.pendentes.length > 0 && (
                            <Checkbox
                              checked={
                                g.pendentes.every((c) => selecionados.has(c.id))
                                  ? true
                                  : g.pendentes.some((c) => selecionados.has(c.id))
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={(v) => toggleSelecionadosGrupo(g.pendentes.map((c) => c.id), !!v)}
                              title="Selecionar todos os pendentes deste BSP"
                            />
                          )}
                        </TableHead>
                        <TableHead className="text-xs">Nome</TableHead>
                        <TableHead className="text-xs">Cat.</TableHead>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Qtd</TableHead>
                        <TableHead className="text-xs">Valor unit.</TableHead>
                        <TableHead className="text-xs">Markup</TableHead>
                        <TableHead className="text-xs">Total</TableHead>
                        <TableHead className="text-xs">Notes</TableHead>
                        <TableHead className="text-xs">BM</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.itens.map((c) => (
                        <TableRow key={c.id} className={c.applied ? "opacity-70" : undefined}>
                          <TableCell>
                            {!c.applied && (
                              <Checkbox
                                checked={selecionados.has(c.id)}
                                onCheckedChange={() => toggleSelecionado(c.id)}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-medium">{c.nome}</TableCell>
                          <TableCell className="text-xs">{CATEGORIA_LABEL[c.categoria] ?? c.categoria}</TableCell>
                          <TableCell className="text-xs">{fmt(c.data)}</TableCell>
                          <TableCell className="text-xs">{c.qtd}</TableCell>
                          <TableCell className="text-xs">{fmtMoney(c.valor)}</TableCell>
                          <TableCell className="text-xs">{c.markup == null ? "—" : fmtMoney(c.markup)}</TableCell>
                          <TableCell className="text-xs font-medium">{fmtMoney(c.total_cost)}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={c.notes ?? ""}>
                            {c.notes || "—"}
                          </TableCell>
                          <TableCell className="text-xs">{c.applied_bm_number ?? "—"}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Excluir" onClick={() => excluirCusto.mutate(c.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Abaixo de 1280px, 11 colunas fixas não cabem sem rolar — vira cartão por
                  lançamento, com os mesmos dados/ações (seleção, exclusão). */}
              {aberto && (
                <div className="space-y-2 xl:hidden">
                  {g.itens.map((c) => (
                    <Card key={c.id} className={cn("space-y-2 p-3", c.applied && "opacity-70")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          {!c.applied && (
                            <Checkbox
                              className="mt-0.5"
                              checked={selecionados.has(c.id)}
                              onCheckedChange={() => toggleSelecionado(c.id)}
                            />
                          )}
                          <div>
                            <p className="text-xs font-medium">{c.nome}</p>
                            <p className="text-[10px] text-muted-foreground">{CATEGORIA_LABEL[c.categoria] ?? c.categoria} · {fmt(c.data)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{fmtMoney(c.total_cost)}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Excluir" onClick={() => excluirCusto.mutate(c.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Qtd</p>
                          <p>{c.qtd}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Valor unit.</p>
                          <p>{fmtMoney(c.valor)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Markup</p>
                          <p>{c.markup == null ? "—" : fmtMoney(c.markup)}</p>
                        </div>
                      </div>
                      {c.notes && <p className="text-xs text-muted-foreground">Notes: {c.notes}</p>}
                      <p className="text-xs text-muted-foreground">BM: {c.applied_bm_number ?? "—"}</p>
                    </Card>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-1.5">
                {g.itens.some((c) => c.applied) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[10px]"
                    loading={desfazerAplicacao.isPending && desfazerAplicacao.variables === g.bsp}
                    disabled={desfazerAplicacao.isPending}
                    onClick={() => desfazerAplicacao.mutate(g.bsp)}
                  >
                    <Undo2 className="mr-1 h-3 w-3" />Desfazer ação
                  </Button>
                )}
                <Button size="sm" disabled={g.totalPendente <= 0}
                  onClick={() => {
                    setMarkupResultado(null);
                    setMarkupTipo("simples");
                    setMarkupLucro("15");
                    setMarkupImposto("13");
                    setMarkupStep("ask");
                    setMarkupBsp(g.bsp);
                  }}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {g.pendentes.some((c) => selecionados.has(c.id))
                    ? `Aplicar selecionados (${g.pendentes.filter((c) => selecionados.has(c.id)).length}) ao BM`
                    : "Aplicar ao BM"}
                </Button>
              </div>
            </Card>
          );
            })}
          </div>
        </div>
      ))}

      <Dialog open={!!markupBsp} onOpenChange={(o) => { if (!o) setMarkupBsp(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Incluir Markup?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-xs">
              <p>BSP <span className="font-medium">{markupBsp}</span></p>
              <p className="mt-1">
                Valor pendente {grupoMarkup?.usandoSelecao ? "selecionado" : "do cartão"}: <span className="font-semibold">{fmtMoney(grupoMarkup?.totalPendente ?? 0)}</span>
              </p>
            </div>

            {markupStep === "ask" ? (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm" variant="outline"
                  onClick={() => {
                    setMarkupResultado({
                      incluiuMarkup: false, tipoMarkup: null, percentualLucro: null, percentualImposto: null,
                      valorPendenteOriginal: grupoMarkup?.totalPendente ?? 0,
                      valorMarkupCalculado: 0,
                      valorFinal: grupoMarkup?.totalPendente ?? 0,
                    });
                    setAplicarBsp(markupBsp);
                    setBmSelecionado(null);
                    setBusca("");
                    setMarkupBsp(null);
                  }}
                >
                  Não
                </Button>
                <Button size="sm" onClick={() => setMarkupStep("form")}>Sim</Button>
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Tipo de Markup</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={markupTipo}
                    onChange={(e) => setMarkupTipo(e.target.value as TipoMarkup)}
                  >
                    <option value="simples">Simples (custo + %)</option>
                    <option value="com_imposto">Com imposto embutido</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Percentual de Lucro (%)</Label>
                    <Input type="number" step="0.01" value={markupLucro} onChange={(e) => setMarkupLucro(e.target.value)} />
                  </div>
                  {markupTipo === "com_imposto" && (
                    <div>
                      <Label className="text-xs">Percentual de Imposto (%)</Label>
                      <Input type="number" step="0.01" value={markupImposto} onChange={(e) => setMarkupImposto(e.target.value)} />
                    </div>
                  )}
                </div>

                {valorMarkupPreview && (
                  <div className="rounded-md border p-3 text-xs">
                    <p>Valor base: <span className="font-medium">{fmtMoney(valorMarkupPreview.valorBase)}</span></p>
                    <p>Markup: <span className="font-medium">{fmtMoney(valorMarkupPreview.valorMarkup)}</span></p>
                    <p className="mt-1 border-t pt-1">
                      Valor final: <span className="font-semibold">{fmtMoney(valorMarkupPreview.valorFinal)}</span>
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMarkupBsp(null)}>Cancelar</Button>
                  <Button
                    size="sm"
                    disabled={!valorMarkupPreview}
                    onClick={() => {
                      if (!valorMarkupPreview) return;
                      setMarkupResultado({
                        incluiuMarkup: true,
                        tipoMarkup: markupTipo,
                        percentualLucro: valorMarkupPreview.lucro,
                        percentualImposto: markupTipo === "com_imposto" ? valorMarkupPreview.imposto : null,
                        valorPendenteOriginal: valorMarkupPreview.valorBase,
                        valorMarkupCalculado: valorMarkupPreview.valorMarkup,
                        valorFinal: valorMarkupPreview.valorFinal,
                      });
                      setAplicarBsp(markupBsp);
                      setBmSelecionado(null);
                      setBusca("");
                      setMarkupBsp(null);
                    }}
                  >
                    <Percent className="mr-1.5 h-3.5 w-3.5" />Aplicar
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!aplicarBsp} onOpenChange={(o) => { if (!o) { setAplicarBsp(null); setBmSelecionado(null); setMarkupResultado(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {aplicarBsp === TODOS
                ? "Aplicar todos os custos pendentes do período ao BM"
                : grupoAplicando?.usandoSelecao
                  ? `Aplicar itens selecionados do BSP ${aplicarBsp} ao BM`
                  : `Aplicar custos do BSP ${aplicarBsp} ao BM`}
            </DialogTitle>

          </DialogHeader>
          <div className="space-y-3">
            {grupoAplicando?.usandoSelecao && (
              <p className="text-xs text-muted-foreground">
                Só os {grupoAplicando.pendentes.length} item(ns) marcado(s) na lista serão aplicados — os demais custos pendentes deste BSP continuam pendentes.
              </p>
            )}
            <div className="rounded-md border p-3 text-xs">
              <p>Transporte: <span className="font-medium">{fmtMoney(grupoAplicando?.transporte ?? 0)}</span></p>
              <p>Hotel: <span className="font-medium">{fmtMoney(grupoAplicando?.hotel ?? 0)}</span></p>
              <p className="mt-1 border-t pt-1">
                Total {grupoAplicando?.usandoSelecao ? "selecionado" : "pendente"}: <span className="font-semibold">{fmtMoney(markupResultado?.valorPendenteOriginal ?? grupoAplicando?.totalPendente ?? 0)}</span>
              </p>
              {markupResultado?.incluiuMarkup && (
                <p className="text-emerald-700">
                  Markup aplicado ({markupResultado.tipoMarkup === "simples" ? "Simples" : "Com imposto embutido"}
                  {" "}· {markupResultado.percentualLucro}% lucro{markupResultado.tipoMarkup === "com_imposto" ? ` + ${markupResultado.percentualImposto}% imposto` : ""}):
                  {" "}<span className="font-semibold">{fmtMoney(markupResultado.valorMarkupCalculado)}</span>
                </p>
              )}
              <p className={markupResultado?.incluiuMarkup ? "border-t pt-1" : undefined}>
                Total a enviar ao BM: <span className="font-semibold">{fmtMoney(markupResultado?.incluiuMarkup ? markupResultado.valorFinal : (grupoAplicando?.totalPendente ?? 0))}</span>
              </p>
            </div>
            {bmEmGeracaoOption && (
              <button
                type="button"
                onClick={() => setBmSelecionado(bmEmGeracaoOption)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border p-3 text-left text-xs transition-colors",
                  bmSelecionado?.rowId === bmEmGeracaoOption.rowId
                    ? "border-primary bg-primary/10"
                    : "hover:border-primary/50",
                )}
              >
                <span>
                  <span className="font-semibold">Aplicar no BM em geração — BM {bmEmGeracaoOption.bmNumber}</span>
                  <span className="block text-muted-foreground">
                    BM que está sendo montado agora na aba "Gerar BM"{bmEmGeracao?.bsp ? ` · BSP ${bmEmGeracao.bsp}` : ""}
                  </span>
                </span>
                {bmSelecionado?.rowId === bmEmGeracaoOption.rowId && <Badge variant="secondary" className="text-[10px]">Selecionado</Badge>}
              </button>
            )}
            <div className="flex items-center gap-2">
              <Input className="h-8 text-xs" placeholder="Buscar BM, PO, cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} />
              <Button size="sm" variant="outline" onClick={() => recarregarBms()} loading={carregandoBms}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">BM</TableHead>
                    <TableHead className="text-xs">PO</TableHead>
                    <TableHead className="text-xs">Cliente</TableHead>
                    <TableHead className="text-xs">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bmsFiltrados.map((b) => (
                    <TableRow key={b.rowId}
                      className={`cursor-pointer ${bmSelecionado?.rowId === b.rowId ? "bg-primary/10" : ""}`}
                      onClick={() => setBmSelecionado(b)}>
                      <TableCell className="text-xs font-medium">{b.bmNumber}</TableCell>
                      <TableCell className="text-xs">{b.poNumber ?? "—"}</TableCell>
                      <TableCell className="text-xs">{b.client ?? "—"}</TableCell>
                      <TableCell className="text-xs">{b.value != null ? fmtMoney(b.value) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setAplicarBsp(null); setMarkupResultado(null); }}>Cancelar</Button>
              <Button size="sm" disabled={!bmSelecionado} loading={aplicar.isPending} onClick={() => aplicar.mutate()}>
                <Send className="mr-1.5 h-3.5 w-3.5" />Aplicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
