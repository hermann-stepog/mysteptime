import { useMemo, useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { CLIENTES } from "@/lib/clientes";
import {
  fetchCostStats,
  fetchTransportLocais,
  saveCostSimulation,
  updateCostSimulation,
  type CostSimulationRow,
} from "@/lib/api/costSimulator.functions";
import { useAuth } from "@/hooks/useAuth";
import { Save } from "lucide-react";
import {
  montarResultado,
  cidadesERotas,
  REGIMES_ROTACAO,
  type EntradasSimulacao,
  type AjustesSimulacao,
  type CostSimulatorUnitStats,
  ajustesPadrao,
  hojeISO,
  type EquipeLinha,
  type EquipeSimples,
  type ViagemLinha,
  type TrajetoTerra,
  type RegimeTipo,
} from "@/lib/costSimulator";
import { ResultadoPanel } from "@/components/costSimulator/ResultadoPanel";
import { exportarSimulacaoPdf } from "@/lib/costSimulatorPdf";
import { TIPO_LABEL, formatBRL } from "@/components/costSimulator/formatacao";

interface ItemHistorico {
  id: string;
  horario: string;
  nome: string;
  tipo: string;
  cliente: string | null;
  pessoas: number;
  total: number;
}

// Três tipos de simulação (pedido dela, 2026-10-02, depois de ver um e-mail real de pedido de
// cotação que não era nem Embarque nem Viagem Executiva): cada um tem sua própria seção de
// entradas, mas compartilham Cliente/Ajustes/Resultado.
//
// Custos históricos (stats) vêm da RPC só quando clica em Calcular; ajustes (método, reajuste,
// markup, overrides) recalculam o resultado localmente sem nova chamada ao banco.

type TipoSimulacao = "embarque" | "viagem_executiva" | "servico_terra";

const VIAGEM_VAZIA: ViagemLinha = {
  descricao: "",
  qtd: 1,
  origem: "",
  destino: "",
  somenteIda: false,
  usaHotel: true,
  noitesHotel: 1,
  usaTransporteLocal: true,
  qtdTransporteLocal: 2,
};
const EQUIPE_EMBARQUE_VAZIA: EquipeLinha[] = [{ funcao: "", qtd: 1, cidadeOrigem: "" }];
const EQUIPE_TERRA_VAZIA: EquipeSimples[] = [{ funcao: "", qtd: 1 }];
const TRAJETOS_TERRA_VAZIO: TrajetoTerra[] = [{ origem: "", destino: "", qtd: 4 }];

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
  const [ajustes, setAjustes] = useState<AjustesSimulacao>(carregado?.ajustes ?? ajustesPadrao);
  const [stats, setStats] = useState<CostSimulatorUnitStats | null>(
    carregado?.snapshotCustos ?? null,
  );
  const [historico, setHistorico] = useState<ItemHistorico[]>([]);

  // ── Embarque ──
  const [cidadeEmbarque, setCidadeEmbarque] = useState(emb?.cidadeEmbarque ?? "");
  const [equipe, setEquipe] = useState<EquipeLinha[]>(emb?.equipe ?? EQUIPE_EMBARQUE_VAZIA);
  const [regimeTipo, setRegimeTipo] = useState<RegimeTipo>(emb?.regime.tipo ?? "14x14");
  const [duracaoValor, setDuracaoValor] = useState(emb?.duracao.valor ?? 90);

  // ── Viagem Executiva ──
  const [viagens, setViagens] = useState<ViagemLinha[]>(via?.viagens ?? [VIAGEM_VAZIA]);

  // ── Serviço em Terra ──
  const [local, setLocal] = useState(ter?.local ?? "");
  const [equipeTerra, setEquipeTerra] = useState<EquipeSimples[]>(
    ter?.equipe ?? EQUIPE_TERRA_VAZIA,
  );
  const [duracaoDiasTerra, setDuracaoDiasTerra] = useState(ter?.duracaoDias ?? 9);
  const [usaAcomodacao, setUsaAcomodacao] = useState(ter?.usaAcomodacao ?? true);
  const [usaAlimentacao, setUsaAlimentacao] = useState(ter?.usaAlimentacao ?? true);
  const [trajetosTerra, setTrajetosTerra] = useState<TrajetoTerra[]>(
    ter?.trajetos ?? TRAJETOS_TERRA_VAZIO,
  );
  const [usaLavanderia, setUsaLavanderia] = useState(ter?.usaLavanderia ?? false);
  const [lavanderiaValorDiario, setLavanderiaValorDiario] = useState(
    ter?.lavanderiaValorDiario ?? 0,
  );

  const entradas: EntradasSimulacao = useMemo(() => {
    const comuns = { nomeCenario, cliente, unidade, bsp, observacoes };
    if (tipo === "embarque") {
      return {
        ...comuns,
        tipo: "embarque",
        cidadeEmbarque,
        equipe,
        regime: {
          tipo: regimeTipo,
          diasEmbarcado: regimeTipo === "custom" ? 14 : REGIMES_ROTACAO[regimeTipo].diasEmbarcado,
          diasFolga: regimeTipo === "custom" ? 14 : REGIMES_ROTACAO[regimeTipo].diasFolga,
        },
        dataInicio: hojeISO(),
        duracao: { valor: duracaoValor, unidade: "dias" },
        mobDesmob: false,
      };
    }
    if (tipo === "servico_terra") {
      return {
        ...comuns,
        tipo: "servico_terra",
        local,
        equipe: equipeTerra,
        duracaoDias: duracaoDiasTerra,
        usaAcomodacao,
        usaAlimentacao,
        trajetos: trajetosTerra,
        usaLavanderia,
        lavanderiaValorDiario,
      };
    }
    return { ...comuns, tipo: "viagem_executiva", viagens };
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
    duracaoValor,
    viagens,
    local,
    equipeTerra,
    duracaoDiasTerra,
    usaAcomodacao,
    usaAlimentacao,
    trajetosTerra,
    usaLavanderia,
    lavanderiaValorDiario,
  ]);

  const calcular = useMutation({
    mutationFn: async () => {
      const { cidades, rotas, trajetos } = cidadesERotas(entradas);
      const novoStats = await fetchCostStats({
        periodoInicio: ajustes.periodoReferencia.inicio,
        periodoFim: ajustes.periodoReferencia.fim,
        cidades,
        rotas,
        trajetos,
        bsp: entradas.bsp,
        hotelIds: ajustes.filtros.hotelIds,
        tipoTransporte: ajustes.filtros.tipoTransporte,
      });
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
        metodoCalculo: ajustes.metodoCalculo,
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
                <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} />
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
                duracaoValor={duracaoValor}
                setDuracaoValor={setDuracaoValor}
              />
            )}
            {tipo === "viagem_executiva" && (
              <ViagemExecutivaForm viagens={viagens} setViagens={setViagens} />
            )}
            {tipo === "servico_terra" && (
              <ServicoTerraForm
                local={local}
                setLocal={setLocal}
                equipe={equipeTerra}
                setEquipe={setEquipeTerra}
                duracaoDias={duracaoDiasTerra}
                setDuracaoDias={setDuracaoDiasTerra}
                usaAcomodacao={usaAcomodacao}
                setUsaAcomodacao={setUsaAcomodacao}
                usaAlimentacao={usaAlimentacao}
                setUsaAlimentacao={setUsaAlimentacao}
                trajetos={trajetosTerra}
                locais={locaisTransporte.data ?? []}
                setTrajetos={setTrajetosTerra}
                usaLavanderia={usaLavanderia}
                setUsaLavanderia={setUsaLavanderia}
                lavanderiaValorDiario={lavanderiaValorDiario}
                setLavanderiaValorDiario={setLavanderiaValorDiario}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => calcular.mutate()} disabled={calcular.isPending}>
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
            {!stats && (
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

function EmbarqueForm({
  cidadeEmbarque,
  setCidadeEmbarque,
  equipe,
  setEquipe,
  regimeTipo,
  setRegimeTipo,
  duracaoValor,
  setDuracaoValor,
}: {
  cidadeEmbarque: string;
  setCidadeEmbarque: (v: string) => void;
  equipe: EquipeLinha[];
  setEquipe: (v: EquipeLinha[] | ((e: EquipeLinha[]) => EquipeLinha[])) => void;
  regimeTipo: RegimeTipo;
  setRegimeTipo: (v: RegimeTipo) => void;
  duracaoValor: number;
  setDuracaoValor: (v: number) => void;
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
    </>
  );
}

function ViagemExecutivaForm({
  viagens,
  setViagens,
}: {
  viagens: ViagemLinha[];
  setViagens: (v: ViagemLinha[] | ((v: ViagemLinha[]) => ViagemLinha[])) => void;
}) {
  function addViagem() {
    setViagens((v) => [
      ...v,
      {
        descricao: "",
        qtd: 1,
        origem: "",
        destino: "",
        somenteIda: false,
        usaHotel: true,
        noitesHotel: 1,
        usaTransporteLocal: true,
        qtdTransporteLocal: 2,
      },
    ]);
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
      {viagens.map((v, i) => (
        <div key={i} className="border rounded-md p-2 space-y-2">
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
              placeholder="Qtd"
              value={v.qtd}
              onChange={(e) => updateViagem(i, { qtd: Number(e.target.value) || 0 })}
            />
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
            />{" "}
            Somente ida
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.usaHotel}
                onChange={(e) => updateViagem(i, { usaHotel: e.target.checked })}
              />{" "}
              Hotel
            </label>
            <Input
              type="number"
              min={0}
              className="w-24"
              placeholder="Noites"
              value={v.noitesHotel}
              onChange={(e) => updateViagem(i, { noitesHotel: Number(e.target.value) || 0 })}
              disabled={!v.usaHotel}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.usaTransporteLocal}
                onChange={(e) => updateViagem(i, { usaTransporteLocal: e.target.checked })}
              />{" "}
              Transporte local
            </label>
            <Input
              type="number"
              min={0}
              className="w-24"
              placeholder="Viagens"
              value={v.qtdTransporteLocal}
              onChange={(e) => updateViagem(i, { qtdTransporteLocal: Number(e.target.value) || 0 })}
              disabled={!v.usaTransporteLocal}
            />
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
  usaAcomodacao,
  setUsaAcomodacao,
  usaAlimentacao,
  setUsaAlimentacao,
  trajetos,
  setTrajetos,
  locais,
  usaLavanderia,
  setUsaLavanderia,
  lavanderiaValorDiario,
  setLavanderiaValorDiario,
}: {
  local: string;
  setLocal: (v: string) => void;
  equipe: EquipeSimples[];
  setEquipe: (v: EquipeSimples[] | ((e: EquipeSimples[]) => EquipeSimples[])) => void;
  duracaoDias: number;
  setDuracaoDias: (v: number) => void;
  usaAcomodacao: boolean;
  setUsaAcomodacao: (v: boolean) => void;
  usaAlimentacao: boolean;
  setUsaAlimentacao: (v: boolean) => void;
  trajetos: TrajetoTerra[];
  locais: string[];
  setTrajetos: (v: TrajetoTerra[] | ((t: TrajetoTerra[]) => TrajetoTerra[])) => void;
  usaLavanderia: boolean;
  setUsaLavanderia: (v: boolean) => void;
  lavanderiaValorDiario: number;
  setLavanderiaValorDiario: (v: number) => void;
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={usaAcomodacao}
          onChange={(e) => setUsaAcomodacao(e.target.checked)}
        />{" "}
        Acomodação
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={usaAlimentacao}
          onChange={(e) => setUsaAlimentacao(e.target.checked)}
        />{" "}
        Alimentação (histórico de Reembolsos)
      </label>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Transporte por trajeto (custo do histórico)</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setTrajetos((ts) => [...ts, { origem: "", destino: "", qtd: 4 }])}
          >
            <Plus className="h-4 w-4 mr-1" /> Trajeto
          </Button>
        </div>
        {trajetos.map((t, i) => (
          <div key={i} className="grid grid-cols-[2fr_2fr_1fr_auto] gap-2 items-end">
            <Input
              list="locais-transporte"
              placeholder="Origem (ex. Aeroporto)"
              value={t.origem}
              onChange={(e) =>
                setTrajetos((ts) =>
                  ts.map((x, idx) => (idx === i ? { ...x, origem: e.target.value } : x)),
                )
              }
            />
            <Input
              list="locais-transporte"
              placeholder="Destino (ex. Pousada)"
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
              placeholder="Viagens"
              value={t.qtd}
              onChange={(e) =>
                setTrajetos((ts) =>
                  ts.map((x, idx) => (idx === i ? { ...x, qtd: Number(e.target.value) || 0 } : x)),
                )
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
        ))}
        <datalist id="locais-transporte">
          {locais.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={usaLavanderia}
            onChange={(e) => setUsaLavanderia(e.target.checked)}
          />{" "}
          Lavanderia
        </label>
        <Input
          type="number"
          min={0}
          step="0.01"
          className="w-32"
          placeholder="Valor único (R$)"
          value={lavanderiaValorDiario}
          onChange={(e) => setLavanderiaValorDiario(Number(e.target.value) || 0)}
          disabled={!usaLavanderia}
        />
      </div>
    </>
  );
}
