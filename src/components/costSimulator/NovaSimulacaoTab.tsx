import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Plus, Trash2, ChevronsUpDown, Save } from "lucide-react";
import { CLIENTES, clienteDaUnidade } from "@/lib/clientes";
import {
  fetchCostStats,
  fetchTransportLocais,
  fetchHoteisRegiao,
  fetchTrajetosConhecidos,
  type HotelRegiao,
  type TrajetoConhecido,
  saveCostSimulation,
  updateCostSimulation,
  type CostSimulationRow,
} from "@/lib/api/costSimulator.functions";
import { useAuth } from "@/hooks/useAuth";
import {
  montarResultado,
  montarPedidoBase,
  REGIMES_ROTACAO,
  type EntradasSimulacao,
  type EntradasEmbarque,
  type EntradasViagemExecutiva,
  type EntradasServicoTerra,
  type AjustesSimulacao,
  type CostSimulatorBase,
  type PeriodoReferenciaTipo,
  type Referencia,
  ajustesPadrao,
  periodoReferenciaParaDatas,
  type EquipeLinha,
  type EquipeSimples,
  type ViagemLinha,
  type TrajetoTerra,
  type RegimeTipo,
} from "@/lib/costSimulator";
import { ResultadoPanel } from "@/components/costSimulator/ResultadoPanel";
import { exportarSimulacaoPdf } from "@/lib/costSimulatorPdf";
import { TIPO_LABEL, formatBRL } from "@/components/costSimulator/formatacao";
import { cn, matchesNameSearch } from "@/lib/utils";

interface ItemHistorico {
  id: string;
  horario: string;
  nome: string;
  tipo: string;
  cliente: string | null;
  pessoas: number;
  total: number;
}

type TipoSimulacao = "embarque" | "viagem_executiva" | "servico_terra";

const VIAGEM_VAZIA: ViagemLinha = {
  descricao: "",
  qtd: 1,
  incluirPassagem: false,
  origem: "",
  destino: "",
  somenteIda: false,
  incluirHospedagem: false,
  noitesHotel: 1,
  incluirAlimentacao: false,
  diasAlimentacao: null,
  incluirUber: false,
  trajetosUber: [],
  incluirTransporteExecutivo: false,
  trajetosExecutivo: [],
};
const EQUIPE_EMBARQUE_VAZIA: EquipeLinha[] = [{ funcao: "", qtd: 1, cidadeOrigem: "" }];
const EQUIPE_TERRA_VAZIA: EquipeSimples[] = [{ funcao: "", qtd: 1 }];

interface NovaSimulacaoTabProps {
  carregado: CostSimulationRow | null;
  onSalvo: (row: CostSimulationRow) => void;
}

export function NovaSimulacaoTab({ carregado, onSalvo }: NovaSimulacaoTabProps) {
  const e = carregado?.entradas;
  const emb = e?.tipo === "embarque" ? e : null;
  const via = e?.tipo === "viagem_executiva" ? e : null;
  const ter = e?.tipo === "servico_terra" ? e : null;

  const [tipo, setTipo] = useState<TipoSimulacao>(e?.tipo ?? "embarque");
  const [nomeCenario, setNomeCenario] = useState(carregado?.nomeCenario ?? "");
  const [cliente, setCliente] = useState(carregado?.cliente ?? "");
  const [unidade, setUnidade] = useState(carregado?.unidade ?? "");
  const [bsp, setBsp] = useState(carregado?.bsp ?? "");
  const [observacoes, setObservacoes] = useState(carregado?.observacoes ?? "");
  const [ajustes, setAjustes] = useState<AjustesSimulacao>(carregado?.ajustes ?? ajustesPadrao());
  const [stats, setStats] = useState<CostSimulatorBase | null>(carregado?.snapshotCustos ?? null);
  const [historico, setHistorico] = useState<ItemHistorico[]>([]);

  // ── Embarque ──
  const [cidadeEmbarque, setCidadeEmbarque] = useState(emb?.cidadeEmbarque ?? "");
  const [equipe, setEquipe] = useState<EquipeLinha[]>(emb?.equipe ?? EQUIPE_EMBARQUE_VAZIA);
  const [regimeTipo, setRegimeTipo] = useState<RegimeTipo>(emb?.regime.tipo ?? "14x14");
  const [regimeCustomEmbarcado, setRegimeCustomEmbarcado] = useState(
    emb?.regime.tipo === "custom" ? emb.regime.diasEmbarcado : 14,
  );
  const [regimeCustomFolga, setRegimeCustomFolga] = useState(
    emb?.regime.tipo === "custom" ? emb.regime.diasFolga : 14,
  );
  const [duracaoValor, setDuracaoValor] = useState(emb?.duracao.valor ?? 90);
  const [mobDesmob, setMobDesmob] = useState(emb?.mobDesmob ?? false);
  const [noitesPreEmbarque, setNoitesPreEmbarque] = useState(emb?.noitesPreEmbarque ?? 1);
  const [diasAlimentacaoPorTroca, setDiasAlimentacaoPorTroca] = useState<number | null>(
    emb?.diasAlimentacaoPorTroca ?? null,
  );
  const [trajetosTransporteTerrestre, setTrajetosTransporteTerrestre] = useState<TrajetoTerra[]>(
    emb?.trajetosTransporteTerrestre ?? [{ origem: "", destino: "", qtd: 2 }],
  );
  const [incluirEmb, setIncluirEmb] = useState<EntradasEmbarque["incluir"]>(
    emb?.incluir ?? {
      passagem: false,
      hospedagem: false,
      alimentacao: false,
      transporteTerrestre: false,
      uber: false,
      transporteExecutivo: false,
    },
  );

  // ── Viagem Executiva ──
  const [viagens, setViagens] = useState<ViagemLinha[]>(via?.viagens ?? [VIAGEM_VAZIA]);

  // ── Serviço em Terra ──
  const [local, setLocal] = useState(ter?.local ?? "");
  const [equipeTerra, setEquipeTerra] = useState<EquipeSimples[]>(
    ter?.equipe ?? EQUIPE_TERRA_VAZIA,
  );
  const [duracaoDiasTerra, setDuracaoDiasTerra] = useState(ter?.duracaoDias ?? 9);
  const [lavanderiaDias, setLavanderiaDias] = useState<number | null>(ter?.lavanderiaDias ?? null);
  const [incluirTerra, setIncluirTerra] = useState<EntradasServicoTerra["incluir"]>(
    ter?.incluir ?? {
      hospedagem: false,
      alimentacao: false,
      lavanderia: false,
      uber: false,
      transporteExecutivo: false,
    },
  );

  // Trajetos de Uber/Transporte executivo — compartilhados entre Embarque e Serviço em Terra
  // (Viagem Executiva tem o seu próprio, por linha de viagem).
  const [trajetosUber, setTrajetosUber] = useState<TrajetoTerra[]>(
    (emb ?? ter)?.trajetos ?? [{ origem: "", destino: "", qtd: 1 }],
  );
  const [trajetosExecutivos, setTrajetosExecutivos] = useState<TrajetoTerra[]>(
    (emb ?? ter)?.trajetosExecutivos ?? [{ origem: "", destino: "", qtd: 1 }],
  );

  const entradas: EntradasSimulacao = useMemo(() => {
    const comuns = { nomeCenario, cliente, unidade, bsp, observacoes };
    if (tipo === "embarque") {
      const entrada: EntradasEmbarque = {
        ...comuns,
        tipo: "embarque",
        incluir: incluirEmb,
        cidadeEmbarque,
        equipe,
        regime: {
          tipo: regimeTipo,
          diasEmbarcado:
            regimeTipo === "custom"
              ? regimeCustomEmbarcado
              : REGIMES_ROTACAO[regimeTipo].diasEmbarcado,
          diasFolga:
            regimeTipo === "custom" ? regimeCustomFolga : REGIMES_ROTACAO[regimeTipo].diasFolga,
        },
        duracao: { valor: duracaoValor, unidade: "dias" },
        mobDesmob,
        noitesPreEmbarque,
        diasAlimentacaoPorTroca,
        trajetosTransporteTerrestre,
        trajetos: trajetosUber,
        trajetosExecutivos,
      };
      return entrada;
    }
    if (tipo === "servico_terra") {
      const entrada: EntradasServicoTerra = {
        ...comuns,
        tipo: "servico_terra",
        incluir: incluirTerra,
        local,
        equipe: equipeTerra,
        duracaoDias: duracaoDiasTerra,
        lavanderiaDias,
        trajetos: trajetosUber,
        trajetosExecutivos,
      };
      return entrada;
    }
    const entrada: EntradasViagemExecutiva = { ...comuns, tipo: "viagem_executiva", viagens };
    return entrada;
  }, [
    tipo,
    nomeCenario,
    cliente,
    unidade,
    bsp,
    observacoes,
    cidadeEmbarque,
    equipe,
    regimeTipo,
    regimeCustomEmbarcado,
    regimeCustomFolga,
    duracaoValor,
    mobDesmob,
    noitesPreEmbarque,
    diasAlimentacaoPorTroca,
    trajetosTransporteTerrestre,
    incluirEmb,
    viagens,
    local,
    equipeTerra,
    duracaoDiasTerra,
    lavanderiaDias,
    incluirTerra,
    trajetosUber,
    trajetosExecutivos,
  ]);

  // Pelo menos uma categoria ativa com o mínimo de campos preenchidos, em qualquer um dos tipos
  // — não é preciso Cliente/Unidade/BSP/Observações/Nome do cenário pra calcular.
  const temAlgoPraCalcular = useMemo(
    () => montarPedidoBase(entradas).categorias.length > 0,
    [entradas],
  );

  const calcular = useMutation({
    mutationFn: async () => {
      const novoStats = await fetchCostStats(entradas, ajustes);
      return { novoStats, entradasCalculadas: entradas, ajustesCalculados: ajustes };
    },
    onSuccess: ({ novoStats, entradasCalculadas, ajustesCalculados }) => {
      setStats(novoStats);
      const res = montarResultado(entradasCalculadas, ajustesCalculados, novoStats);
      setHistorico((h) => [
        {
          id: `${Date.now()}-${h.length}`,
          horario: new Date().toLocaleTimeString("pt-BR"),
          nome: entradasCalculadas.nomeCenario.trim() || "Sem nome",
          tipo: TIPO_LABEL[entradasCalculadas.tipo],
          cliente: entradasCalculadas.cliente || null,
          pessoas: res.totalPessoas,
          total: res.total,
        },
        ...h,
      ]);
    },
  });

  // Recalcula sozinho 800ms depois de qualquer mudança nas entradas que afete o pedido à RPC
  // (cidades/rotas/trajetos/categorias ativas) — não precisa clicar em Calcular toda vez.
  const chavePedido = useMemo(() => JSON.stringify(montarPedidoBase(entradas)), [entradas]);
  const primeiraBusca = useRef(true);
  useEffect(() => {
    if (primeiraBusca.current) {
      primeiraBusca.current = false;
      return;
    }
    if (!temAlgoPraCalcular) return;
    const timer = setTimeout(() => calcular.mutate(), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chavePedido, ajustes.periodoReferencia.inicio, ajustes.periodoReferencia.fim]);

  const resultado = useMemo(
    () => (stats ? montarResultado(entradas, ajustes, stats) : null),
    [entradas, ajustes, stats],
  );

  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const locaisTransporte = useQuery({
    queryKey: ["cost-simulator-transport-locais"],
    queryFn: fetchTransportLocais,
    staleTime: 5 * 60_000,
  });
  const cidadeBaseHoteis = (
    tipo === "servico_terra" ? local : tipo === "embarque" ? cidadeEmbarque : ""
  ).trim();
  const hoteisRegiao = useQuery({
    queryKey: ["cost-simulator-hoteis-regiao", cidadeBaseHoteis],
    queryFn: () => fetchHoteisRegiao(cidadeBaseHoteis),
    enabled: cidadeBaseHoteis.length > 0,
    staleTime: 5 * 60_000,
  });
  const hotelAcomodacao = ajustes.filtros.hotelIds?.[0] ?? "";
  function setHotelAcomodacao(id: string) {
    setAjustes((a) => ({ ...a, filtros: { ...a.filtros, hotelIds: id ? [id] : undefined } }));
  }
  const sugestoesTrajeto = useMemo(
    () =>
      Array.from(
        new Set([
          ...(locaisTransporte.data ?? []),
          ...(hoteisRegiao.data ?? []).map((h) => h.nome),
        ]),
      ).sort(),
    [locaisTransporte.data, hoteisRegiao.data],
  );

  const salvar = useMutation({
    mutationFn: async (modo: "novo" | "atualizar") => {
      if (!stats || !resultado) throw new Error("Calcule a simulação antes de salvar.");
      const input = {
        nomeCenario: nomeCenario.trim(),
        cliente: cliente || null,
        unidade: unidade || null,
        bsp: bsp || null,
        observacoes: observacoes || null,
        periodoReferenciaInicio: ajustes.periodoReferencia.inicio,
        periodoReferenciaFim: ajustes.periodoReferencia.fim,
        metodoCalculo: ajustes.referencia,
        entradas,
        ajustes,
        snapshotCustos: stats,
        resultado,
        createdByName: profile?.full_name ?? profile?.email ?? null,
      };
      if (modo === "atualizar" && carregado) return updateCostSimulation(carregado.id, input);
      return saveCostSimulation(input);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["cost-simulations"] });
      onSalvo(row);
    },
  });

  function setOverride(chave: string, valor: number | null) {
    setAjustes((a) => {
      const overrides = { ...a.overrides };
      if (valor === null) delete overrides[chave];
      else overrides[chave] = valor;
      return { ...a, overrides };
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 items-start">
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Tipo de simulação</Label>
              <select
                className="w-full border rounded-md h-9 px-2 text-sm"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoSimulacao)}
              >
                <option value="embarque">Embarque (equipe rotativa)</option>
                <option value="viagem_executiva">Viagem Executiva</option>
                <option value="servico_terra">Serviço em Terra</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Nome do cenário</Label>
              <Input value={nomeCenario} onChange={(e) => setNomeCenario(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={cliente} onValueChange={setCliente}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CLIENTES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Input
                  value={unidade}
                  onChange={(e) => {
                    setUnidade(e.target.value);
                    const clienteDaUnidadeDigitada = clienteDaUnidade(e.target.value);
                    if (clienteDaUnidadeDigitada) setCliente(clienteDaUnidadeDigitada);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>BSP</Label>
                <Input
                  value={bsp}
                  onChange={(e) => setBsp(e.target.value)}
                  placeholder="Usado no filtro de Alimentação"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <textarea
                className="w-full border rounded-md px-2 py-1.5 text-sm min-h-[60px]"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>

            {tipo === "embarque" && (
              <EmbarqueForm
                cidadeEmbarque={cidadeEmbarque}
                setCidadeEmbarque={setCidadeEmbarque}
                equipe={equipe}
                setEquipe={setEquipe}
                regimeTipo={regimeTipo}
                setRegimeTipo={setRegimeTipo}
                regimeCustomEmbarcado={regimeCustomEmbarcado}
                setRegimeCustomEmbarcado={setRegimeCustomEmbarcado}
                regimeCustomFolga={regimeCustomFolga}
                setRegimeCustomFolga={setRegimeCustomFolga}
                duracaoValor={duracaoValor}
                setDuracaoValor={setDuracaoValor}
                mobDesmob={mobDesmob}
                setMobDesmob={setMobDesmob}
                noitesPreEmbarque={noitesPreEmbarque}
                setNoitesPreEmbarque={setNoitesPreEmbarque}
                diasAlimentacaoPorTroca={diasAlimentacaoPorTroca}
                setDiasAlimentacaoPorTroca={setDiasAlimentacaoPorTroca}
                incluir={incluirEmb}
                setIncluir={setIncluirEmb}
                hoteisAcomodacao={hoteisRegiao.data ?? []}
                hotelAcomodacao={hotelAcomodacao}
                setHotelAcomodacao={setHotelAcomodacao}
                trajetosTransporteTerrestre={trajetosTransporteTerrestre}
                setTrajetosTransporteTerrestre={setTrajetosTransporteTerrestre}
                trajetosUber={trajetosUber}
                setTrajetosUber={setTrajetosUber}
                trajetosExecutivos={trajetosExecutivos}
                setTrajetosExecutivos={setTrajetosExecutivos}
                locais={sugestoesTrajeto}
              />
            )}
            {tipo === "viagem_executiva" && (
              <ViagemExecutivaForm
                viagens={viagens}
                setViagens={setViagens}
                locais={sugestoesTrajeto}
              />
            )}
            {tipo === "servico_terra" && (
              <ServicoTerraForm
                local={local}
                setLocal={setLocal}
                equipe={equipeTerra}
                setEquipe={setEquipeTerra}
                duracaoDias={duracaoDiasTerra}
                setDuracaoDias={setDuracaoDiasTerra}
                incluir={incluirTerra}
                setIncluir={setIncluirTerra}
                hoteisAcomodacao={hoteisRegiao.data ?? []}
                hotelAcomodacao={hotelAcomodacao}
                setHotelAcomodacao={setHotelAcomodacao}
                trajetosUber={trajetosUber}
                setTrajetosUber={setTrajetosUber}
                trajetosExecutivos={trajetosExecutivos}
                setTrajetosExecutivos={setTrajetosExecutivos}
                locais={sugestoesTrajeto}
                lavanderiaDias={lavanderiaDias}
                setLavanderiaDias={setLavanderiaDias}
              />
            )}

            <AjustesPanel ajustes={ajustes} setAjustes={setAjustes} />

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => calcular.mutate()}
                disabled={calcular.isPending || !temAlgoPraCalcular}
              >
                {calcular.isPending ? "Buscando custos..." : "Calcular"}
              </Button>
              {carregado && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => salvar.mutate("atualizar")}
                  disabled={salvar.isPending || !stats || !nomeCenario.trim()}
                >
                  <Save className="h-4 w-4 mr-1" /> Atualizar cenário
                </Button>
              )}
              <Button
                type="button"
                variant={carregado ? "outline" : "default"}
                onClick={() => salvar.mutate("novo")}
                disabled={salvar.isPending || !stats || !nomeCenario.trim()}
              >
                <Save className="h-4 w-4 mr-1" />{" "}
                {carregado ? "Salvar como novo" : "Salvar cenário"}
              </Button>
            </div>
            {!temAlgoPraCalcular && (
              <p className="text-xs text-muted-foreground">
                Ative pelo menos uma categoria e preencha o mínimo pra poder calcular.
              </p>
            )}
            {temAlgoPraCalcular && !stats && (
              <p className="text-xs text-muted-foreground">
                Calcule antes de salvar. Sem nome do cenário, o salvamento fica bloqueado.
              </p>
            )}
            {calcular.isError && (
              <p className="text-sm text-destructive">{(calcular.error as Error).message}</p>
            )}
            {salvar.isError && (
              <p className="text-sm text-destructive">{(salvar.error as Error).message}</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <ResultadoPanel
            resultado={resultado}
            overrides={ajustes.overrides}
            onChangeOverride={setOverride}
            onExportarPdf={async (graficos) => {
              if (!resultado) return;
              await exportarSimulacaoPdf({
                nomeCenario: nomeCenario.trim(),
                entradas,
                ajustes,
                resultado,
                geradoPor: profile?.full_name ?? profile?.email ?? null,
                graficos,
              });
            }}
          />
        </div>
      </div>

      {historico.length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="font-medium">Histórico desta sessão</h2>
          <ul className="divide-y text-sm">
            {historico.map((h) => (
              <li key={h.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-muted-foreground mr-2">{h.horario}</span>
                  <span className="font-medium">{h.nome}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {h.tipo}
                    {h.cliente ? ` · ${h.cliente}` : ""} · {h.pessoas} pessoa(s)
                  </span>
                </span>
                <span className="font-semibold">{formatBRL(h.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Ajustes: período de referência, qual estatística usar, reajuste/contingência/markup ──────
function AjustesPanel({
  ajustes,
  setAjustes,
}: {
  ajustes: AjustesSimulacao;
  setAjustes: (v: AjustesSimulacao | ((a: AjustesSimulacao) => AjustesSimulacao)) => void;
}) {
  function setPeriodoTipo(tipoPeriodo: PeriodoReferenciaTipo) {
    setAjustes((a) => ({
      ...a,
      periodoReferencia: { tipo: tipoPeriodo, ...periodoReferenciaParaDatas(tipoPeriodo) },
    }));
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Ajustes</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Base de custos</Label>
          <select
            className="w-full border rounded-md h-9 px-2 text-sm"
            value={ajustes.periodoReferencia.tipo}
            onChange={(e) => setPeriodoTipo(e.target.value as PeriodoReferenciaTipo)}
          >
            <option value="3">Últimos 3 meses</option>
            <option value="6">Últimos 6 meses</option>
            <option value="12">Últimos 12 meses</option>
            <option value="todo">Todo o histórico</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Referência</Label>
          <select
            className="w-full border rounded-md h-9 px-2 text-sm"
            value={ajustes.referencia}
            onChange={(e) =>
              setAjustes((a) => ({ ...a, referencia: e.target.value as Referencia }))
            }
          >
            <option value="mediana">Mediana</option>
            <option value="media">Média</option>
            <option value="ultimo">Último valor</option>
            <option value="conservador">Conservador (p75)</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Reajuste (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={ajustes.reajustePercent}
            onChange={(e) =>
              setAjustes((a) => ({ ...a, reajustePercent: Number(e.target.value) || 0 }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Contingência (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={ajustes.contingenciaPercent}
            onChange={(e) =>
              setAjustes((a) => ({ ...a, contingenciaPercent: Number(e.target.value) || 0 }))
            }
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ajustes.markup.aplicar}
          onChange={(e) =>
            setAjustes((a) => ({ ...a, markup: { ...a.markup, aplicar: e.target.checked } }))
          }
        />
        Aplicar markup
      </label>
      {ajustes.markup.aplicar && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <select
              className="w-full border rounded-md h-9 px-2 text-sm"
              value={ajustes.markup.tipo}
              onChange={(e) =>
                setAjustes((a) => ({
                  ...a,
                  markup: {
                    ...a.markup,
                    tipo: e.target.value as AjustesSimulacao["markup"]["tipo"],
                  },
                }))
              }
            >
              <option value="simples">Simples</option>
              <option value="por_dentro">Por dentro</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lucro (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={ajustes.markup.percentualLucro}
              onChange={(e) =>
                setAjustes((a) => ({
                  ...a,
                  markup: { ...a.markup, percentualLucro: Number(e.target.value) || 0 },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Imposto (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={ajustes.markup.percentualImposto}
              onChange={(e) =>
                setAjustes((a) => ({
                  ...a,
                  markup: { ...a.markup, percentualImposto: Number(e.target.value) || 0 },
                }))
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CategoriaCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function EmbarqueForm({
  cidadeEmbarque,
  setCidadeEmbarque,
  equipe,
  setEquipe,
  regimeTipo,
  setRegimeTipo,
  regimeCustomEmbarcado,
  setRegimeCustomEmbarcado,
  regimeCustomFolga,
  setRegimeCustomFolga,
  duracaoValor,
  setDuracaoValor,
  mobDesmob,
  setMobDesmob,
  noitesPreEmbarque,
  setNoitesPreEmbarque,
  diasAlimentacaoPorTroca,
  setDiasAlimentacaoPorTroca,
  incluir,
  setIncluir,
  hoteisAcomodacao,
  hotelAcomodacao,
  setHotelAcomodacao,
  trajetosTransporteTerrestre,
  setTrajetosTransporteTerrestre,
  trajetosUber,
  setTrajetosUber,
  trajetosExecutivos,
  setTrajetosExecutivos,
  locais,
}: {
  cidadeEmbarque: string;
  setCidadeEmbarque: (v: string) => void;
  equipe: EquipeLinha[];
  setEquipe: (v: EquipeLinha[] | ((e: EquipeLinha[]) => EquipeLinha[])) => void;
  regimeTipo: RegimeTipo;
  setRegimeTipo: (v: RegimeTipo) => void;
  regimeCustomEmbarcado: number;
  setRegimeCustomEmbarcado: (v: number) => void;
  regimeCustomFolga: number;
  setRegimeCustomFolga: (v: number) => void;
  duracaoValor: number;
  setDuracaoValor: (v: number) => void;
  mobDesmob: boolean;
  setMobDesmob: (v: boolean) => void;
  noitesPreEmbarque: number;
  setNoitesPreEmbarque: (v: number) => void;
  diasAlimentacaoPorTroca: number | null;
  setDiasAlimentacaoPorTroca: (v: number | null) => void;
  incluir: EntradasEmbarque["incluir"];
  setIncluir: (
    v:
      | EntradasEmbarque["incluir"]
      | ((i: EntradasEmbarque["incluir"]) => EntradasEmbarque["incluir"]),
  ) => void;
  hoteisAcomodacao: HotelRegiao[];
  hotelAcomodacao: string;
  setHotelAcomodacao: (v: string) => void;
  trajetosTransporteTerrestre: TrajetoTerra[];
  setTrajetosTransporteTerrestre: (
    v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[]),
  ) => void;
  trajetosUber: TrajetoTerra[];
  setTrajetosUber: (v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[])) => void;
  trajetosExecutivos: TrajetoTerra[];
  setTrajetosExecutivos: (v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[])) => void;
  locais: string[];
}) {
  function addLinha() {
    setEquipe((e) => [...e, { funcao: "", qtd: 1, cidadeOrigem: "" }]);
  }
  function removeLinha(i: number) {
    setEquipe((e) => e.filter((_, idx) => idx !== i));
  }
  function updateLinha(i: number, patch: Partial<EquipeLinha>) {
    setEquipe((e) => e.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function marcar(chave: keyof EntradasEmbarque["incluir"], v: boolean) {
    setIncluir((i) => ({ ...i, [chave]: v }));
  }

  return (
    <>
      <div className="space-y-2">
        <Label>Cidade de embarque (base)</Label>
        <Input value={cidadeEmbarque} onChange={(e) => setCidadeEmbarque(e.target.value)} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Equipe</Label>
          <Button type="button" size="sm" variant="outline" onClick={addLinha}>
            <Plus className="h-4 w-4 mr-1" /> Linha
          </Button>
        </div>
        {equipe.map((linha, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_2fr_auto] gap-2 items-end">
            <Input
              placeholder="Função"
              value={linha.funcao}
              onChange={(e) => updateLinha(i, { funcao: e.target.value })}
            />
            <Input
              type="number"
              min={1}
              placeholder="Qtd"
              value={linha.qtd}
              onChange={(e) => updateLinha(i, { qtd: Number(e.target.value) || 0 })}
            />
            <Input
              placeholder="Cidade de origem"
              value={linha.cidadeOrigem}
              onChange={(e) => updateLinha(i, { cidadeOrigem: e.target.value })}
            />
            <Button type="button" size="icon" variant="ghost" onClick={() => removeLinha(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label>Regime</Label>
          <select
            className="w-full border rounded-md h-9 px-2 text-sm"
            value={regimeTipo}
            onChange={(e) => setRegimeTipo(e.target.value as RegimeTipo)}
          >
            <option value="14x14">14x14</option>
            <option value="21x21">21x21</option>
            <option value="28x28">28x28</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Duração (dias)</Label>
          <Input
            type="number"
            value={duracaoValor}
            onChange={(e) => setDuracaoValor(Number(e.target.value) || 0)}
          />
        </div>
      </div>
      {regimeTipo === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label>Dias embarcado</Label>
            <Input
              type="number"
              min={1}
              value={regimeCustomEmbarcado}
              onChange={(e) => setRegimeCustomEmbarcado(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-2">
            <Label>Dias de folga</Label>
            <Input
              type="number"
              min={1}
              value={regimeCustomFolga}
              onChange={(e) => setRegimeCustomFolga(Number(e.target.value) || 1)}
            />
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mobDesmob}
          onChange={(e) => setMobDesmob(e.target.checked)}
        />
        Mobilização/desmobilização (+1 ida no início, +1 volta no fim)
      </label>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.passagem}
          onChange={(v) => marcar("passagem", v)}
          label="Passagem Aérea"
        />
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.hospedagem}
          onChange={(v) => marcar("hospedagem", v)}
          label="Hospedagem"
        />
        {incluir.hospedagem && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Noites de pré-embarque por troca</Label>
              <Input
                type="number"
                min={0}
                value={noitesPreEmbarque}
                onChange={(e) => setNoitesPreEmbarque(Number(e.target.value) || 0)}
              />
            </div>
            <SeletorHotel
              hoteis={hoteisAcomodacao}
              valor={hotelAcomodacao}
              onChange={setHotelAcomodacao}
            />
          </>
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.alimentacao}
          onChange={(v) => marcar("alimentacao", v)}
          label="Alimentação"
        />
        {incluir.alimentacao && (
          <div className="space-y-1">
            <Label className="text-xs">Dias em terra por troca</Label>
            <Input
              type="number"
              min={0}
              placeholder={`Padrão: ${noitesPreEmbarque + 1}`}
              value={diasAlimentacaoPorTroca ?? ""}
              onChange={(e) =>
                setDiasAlimentacaoPorTroca(
                  e.target.value === "" ? null : Number(e.target.value) || 0,
                )
              }
            />
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.transporteTerrestre}
          onChange={(v) => marcar("transporteTerrestre", v)}
          label="Transporte terrestre"
        />
        {incluir.transporteTerrestre && (
          <TrajetosEditor
            trajetos={trajetosTransporteTerrestre}
            setTrajetos={setTrajetosTransporteTerrestre}
            locais={locais}
            tipoHistorico="terrestre"
            qtdLabel="Viagens por troca"
          />
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.uber}
          onChange={(v) => marcar("uber", v)}
          label="Uber"
        />
        {incluir.uber && (
          <TrajetosEditor
            trajetos={trajetosUber}
            setTrajetos={setTrajetosUber}
            locais={locais}
            tipoHistorico="uber"
          />
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.transporteExecutivo}
          onChange={(v) => marcar("transporteExecutivo", v)}
          label="Transporte executivo (Future)"
        />
        {incluir.transporteExecutivo && (
          <TrajetosEditor
            trajetos={trajetosExecutivos}
            setTrajetos={setTrajetosExecutivos}
            locais={locais}
            tipoHistorico="future"
          />
        )}
      </div>
    </>
  );
}

function ViagemExecutivaForm({
  viagens,
  setViagens,
  locais,
}: {
  viagens: ViagemLinha[];
  setViagens: (v: ViagemLinha[] | ((v: ViagemLinha[]) => ViagemLinha[])) => void;
  locais: string[];
}) {
  function addViagem() {
    setViagens((v) => [...v, { ...VIAGEM_VAZIA }]);
  }
  function removeViagem(i: number) {
    setViagens((v) => v.filter((_, idx) => idx !== i));
  }
  function updateViagem(i: number, patch: Partial<ViagemLinha>) {
    setViagens((v) => v.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Viagens</Label>
        <Button type="button" size="sm" variant="outline" onClick={addViagem}>
          <Plus className="h-4 w-4 mr-1" /> Viagem
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Cada viagem pode ter qualquer combinação de categorias — uma viagem só com Passagem, ou só
        com Uber, é válida.
      </p>
      {viagens.map((v, i) => (
        <div key={i} className="border rounded-md p-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Viagem {i + 1}</span>
            <Button type="button" size="icon" variant="ghost" onClick={() => removeViagem(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Descrição/pessoa"
              value={v.descricao}
              onChange={(e) => updateViagem(i, { descricao: e.target.value })}
            />
            <Input
              type="number"
              min={1}
              placeholder="Qtd pessoas"
              value={v.qtd}
              onChange={(e) => updateViagem(i, { qtd: Number(e.target.value) || 0 })}
            />
          </div>

          <div className="space-y-1 rounded-md border p-2">
            <CategoriaCheckbox
              checked={v.incluirPassagem}
              onChange={(c) => updateViagem(i, { incluirPassagem: c })}
              label="Passagem Aérea"
            />
            {v.incluirPassagem && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Origem"
                    value={v.origem}
                    onChange={(e) => updateViagem(i, { origem: e.target.value })}
                  />
                  <Input
                    placeholder="Destino"
                    value={v.destino}
                    onChange={(e) => updateViagem(i, { destino: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={v.somenteIda}
                    onChange={(e) => updateViagem(i, { somenteIda: e.target.checked })}
                  />
                  Somente ida
                </label>
              </>
            )}
          </div>

          <div className="space-y-1 rounded-md border p-2">
            <CategoriaCheckbox
              checked={v.incluirHospedagem}
              onChange={(c) => updateViagem(i, { incluirHospedagem: c })}
              label="Hotel"
            />
            {v.incluirHospedagem && (
              <Input
                type="number"
                min={0}
                className="w-24"
                placeholder="Noites"
                value={v.noitesHotel}
                onChange={(e) => updateViagem(i, { noitesHotel: Number(e.target.value) || 0 })}
              />
            )}
          </div>

          <div className="space-y-1 rounded-md border p-2">
            <CategoriaCheckbox
              checked={v.incluirAlimentacao}
              onChange={(c) => updateViagem(i, { incluirAlimentacao: c })}
              label="Alimentação"
            />
            {v.incluirAlimentacao && (
              <Input
                type="number"
                min={0}
                className="w-24"
                placeholder={`Padrão: ${Math.max(1, v.noitesHotel || 1)}`}
                value={v.diasAlimentacao ?? ""}
                onChange={(e) =>
                  updateViagem(i, {
                    diasAlimentacao: e.target.value === "" ? null : Number(e.target.value) || 0,
                  })
                }
              />
            )}
          </div>

          <div className="space-y-1 rounded-md border p-2">
            <CategoriaCheckbox
              checked={v.incluirUber}
              onChange={(c) => updateViagem(i, { incluirUber: c })}
              label="Uber"
            />
            {v.incluirUber && (
              <TrajetosEditor
                trajetos={v.trajetosUber}
                setTrajetos={(novo) =>
                  updateViagem(i, {
                    trajetosUber: typeof novo === "function" ? novo(v.trajetosUber) : novo,
                  })
                }
                locais={locais}
                tipoHistorico="uber"
              />
            )}
          </div>

          <div className="space-y-1 rounded-md border p-2">
            <CategoriaCheckbox
              checked={v.incluirTransporteExecutivo}
              onChange={(c) => updateViagem(i, { incluirTransporteExecutivo: c })}
              label="Transporte executivo (Future)"
            />
            {v.incluirTransporteExecutivo && (
              <TrajetosEditor
                trajetos={v.trajetosExecutivo}
                setTrajetos={(novo) =>
                  updateViagem(i, {
                    trajetosExecutivo:
                      typeof novo === "function" ? novo(v.trajetosExecutivo) : novo,
                  })
                }
                locais={locais}
                tipoHistorico="future"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ServicoTerraForm({
  local,
  setLocal,
  equipe,
  setEquipe,
  duracaoDias,
  setDuracaoDias,
  incluir,
  setIncluir,
  hoteisAcomodacao,
  hotelAcomodacao,
  setHotelAcomodacao,
  trajetosUber,
  setTrajetosUber,
  trajetosExecutivos,
  setTrajetosExecutivos,
  locais,
  lavanderiaDias,
  setLavanderiaDias,
}: {
  local: string;
  setLocal: (v: string) => void;
  equipe: EquipeSimples[];
  setEquipe: (v: EquipeSimples[] | ((e: EquipeSimples[]) => EquipeSimples[])) => void;
  duracaoDias: number;
  setDuracaoDias: (v: number) => void;
  incluir: EntradasServicoTerra["incluir"];
  setIncluir: (
    v:
      | EntradasServicoTerra["incluir"]
      | ((i: EntradasServicoTerra["incluir"]) => EntradasServicoTerra["incluir"]),
  ) => void;
  trajetosExecutivos: TrajetoTerra[];
  setTrajetosExecutivos: (v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[])) => void;
  trajetosUber: TrajetoTerra[];
  locais: string[];
  setTrajetosUber: (v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[])) => void;
  lavanderiaDias: number | null;
  setLavanderiaDias: (v: number | null) => void;
  hoteisAcomodacao: HotelRegiao[];
  hotelAcomodacao: string;
  setHotelAcomodacao: (v: string) => void;
}) {
  function addLinha() {
    setEquipe((e) => [...e, { funcao: "", qtd: 1 }]);
  }
  function removeLinha(i: number) {
    setEquipe((e) => e.filter((_, idx) => idx !== i));
  }
  function updateLinha(i: number, patch: Partial<EquipeSimples>) {
    setEquipe((e) => e.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function marcar(chave: keyof EntradasServicoTerra["incluir"], v: boolean) {
    setIncluir((i) => ({ ...i, [chave]: v }));
  }

  return (
    <>
      <div className="space-y-2">
        <Label>Local (ex.: ARM SBM Duque de Caxias)</Label>
        <Input value={local} onChange={(e) => setLocal(e.target.value)} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Equipe</Label>
          <Button type="button" size="sm" variant="outline" onClick={addLinha}>
            <Plus className="h-4 w-4 mr-1" /> Linha
          </Button>
        </div>
        {equipe.map((linha, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
            <Input
              placeholder="Função"
              value={linha.funcao}
              onChange={(e) => updateLinha(i, { funcao: e.target.value })}
            />
            <Input
              type="number"
              min={1}
              placeholder="Qtd"
              value={linha.qtd}
              onChange={(e) => updateLinha(i, { qtd: Number(e.target.value) || 0 })}
            />
            <Button type="button" size="icon" variant="ghost" onClick={() => removeLinha(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>Duração (dias)</Label>
        <Input
          type="number"
          value={duracaoDias}
          onChange={(e) => setDuracaoDias(Number(e.target.value) || 0)}
        />
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.hospedagem}
          onChange={(v) => marcar("hospedagem", v)}
          label="Hospedagem"
        />
        {incluir.hospedagem && (
          <SeletorHotel
            hoteis={hoteisAcomodacao}
            valor={hotelAcomodacao}
            onChange={setHotelAcomodacao}
          />
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.alimentacao}
          onChange={(v) => marcar("alimentacao", v)}
          label="Alimentação"
        />
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.uber}
          onChange={(v) => marcar("uber", v)}
          label="Uber"
        />
        {incluir.uber && (
          <TrajetosEditor
            trajetos={trajetosUber}
            setTrajetos={setTrajetosUber}
            locais={locais}
            tipoHistorico="uber"
          />
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.transporteExecutivo}
          onChange={(v) => marcar("transporteExecutivo", v)}
          label="Transporte executivo (Future)"
        />
        {incluir.transporteExecutivo && (
          <TrajetosEditor
            trajetos={trajetosExecutivos}
            setTrajetos={setTrajetosExecutivos}
            locais={locais}
            tipoHistorico="future"
          />
        )}
      </div>

      <div className="space-y-2 rounded-md border p-2">
        <CategoriaCheckbox
          checked={incluir.lavanderia}
          onChange={(v) => marcar("lavanderia", v)}
          label="Lavanderia"
        />
        {incluir.lavanderia && (
          <div className="space-y-1">
            <Label className="text-xs">Nº de dias</Label>
            <Input
              type="number"
              min={0}
              placeholder={`Padrão: ${duracaoDias}`}
              value={lavanderiaDias ?? ""}
              onChange={(e) =>
                setLavanderiaDias(e.target.value === "" ? null : Number(e.target.value) || 0)
              }
            />
          </div>
        )}
      </div>
    </>
  );
}

// ── Editor de trajetos: lista de origem/destino + qtd, com combobox pesquisável dos trajetos
// já vistos no histórico (mostrando n/mediana) — digitar texto livre continua funcionando. ──
function TrajetosEditor({
  trajetos,
  setTrajetos,
  locais,
  tipoHistorico,
  qtdLabel = "Carros na ida",
}: {
  trajetos: TrajetoTerra[];
  setTrajetos: (v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[])) => void;
  locais: string[];
  tipoHistorico: "uber" | "future" | "terrestre";
  qtdLabel?: string;
}) {
  const conhecidos = useQuery({
    queryKey: ["cost-simulator-trajetos-conhecidos", tipoHistorico],
    queryFn: () => fetchTrajetosConhecidos(tipoHistorico),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Trajetos</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setTrajetos((ts) => [...ts, { origem: "", destino: "", qtd: 1 }])}
        >
          <Plus className="h-4 w-4 mr-1" /> Trajeto
        </Button>
      </div>
      {trajetos.map((t, i) => (
        <div key={i} className="space-y-1 rounded border p-2">
          <div className="flex items-center justify-between gap-2">
            <TrajetoConhecidoCombobox
              trajetos={conhecidos.data ?? []}
              onSelect={(origem, destino) =>
                setTrajetos((ts) => ts.map((x, idx) => (idx === i ? { ...x, origem, destino } : x)))
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setTrajetos((ts) => ts.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-[2fr_2fr_1fr] gap-2 items-end">
            <Input
              list="locais-transporte"
              placeholder="Origem"
              value={t.origem}
              onChange={(e) =>
                setTrajetos((ts) =>
                  ts.map((x, idx) => (idx === i ? { ...x, origem: e.target.value } : x)),
                )
              }
            />
            <Input
              list="locais-transporte"
              placeholder="Destino"
              value={t.destino}
              onChange={(e) =>
                setTrajetos((ts) =>
                  ts.map((x, idx) => (idx === i ? { ...x, destino: e.target.value } : x)),
                )
              }
            />
            <Input
              type="number"
              min={0}
              placeholder={qtdLabel}
              value={t.qtd}
              onChange={(e) =>
                setTrajetos((ts) =>
                  ts.map((x, idx) => (idx === i ? { ...x, qtd: Number(e.target.value) || 0 } : x)),
                )
              }
            />
          </div>
        </div>
      ))}
      <datalist id="locais-transporte">
        {locais.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </div>
  );
}

function TrajetoConhecidoCombobox({
  trajetos,
  onSelect,
}: {
  trajetos: TrajetoConhecido[];
  onSelect: (origem: string, destino: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size="sm"
          className="h-7 justify-between text-xs font-normal"
        >
          Buscar trajeto conhecido...
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 pointer-events-auto" align="start">
        <Command filter={(v, search) => (matchesNameSearch(v, search) ? 1 : 0)}>
          <CommandInput placeholder="Buscar por cidade..." />
          <CommandList
            className={cn(trajetos.length <= 6 ? "max-h-none overflow-visible" : undefined)}
          >
            <CommandEmpty>Nenhum trajeto encontrado no histórico.</CommandEmpty>
            <CommandGroup>
              {trajetos.map((t, i) => (
                <CommandItem
                  key={`${t.origem}|${t.destino}|${i}`}
                  value={`${t.origem} ${t.destino}`}
                  onSelect={() => {
                    onSelect(t.origem, t.destino);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">
                    {t.origem} → {t.destino}{" "}
                    <span className="text-muted-foreground">
                      · {t.n} lançamento(s) · {formatBRL(t.mediana)}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SeletorHotel({
  hoteis,
  valor,
  onChange,
}: {
  hoteis: HotelRegiao[];
  valor: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Hotel (todos os da cidade, se não escolher)</Label>
      <select
        className="w-full border rounded-md h-9 px-2 text-sm"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={hoteis.length === 0}
      >
        <option value="">
          {hoteis.length === 0
            ? "Informe a cidade para listar os hotéis"
            : "Todos os hotéis da cidade"}
        </option>
        {hoteis.map((h) => (
          <option key={h.id} value={h.id}>
            {h.nome}
            {h.cidade ? ` (${h.cidade})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
