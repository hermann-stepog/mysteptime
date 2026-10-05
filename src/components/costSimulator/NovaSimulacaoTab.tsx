import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { CLIENTES } from "@/lib/clientes";
import { fetchCostStats } from "@/lib/api/costSimulator.functions";
import {
  montarResultado,
  cidadesERotas,
  REGIMES_ROTACAO,
  type EntradasSimulacao,
  type AjustesSimulacao,
  type EquipeLinha,
  type EquipeSimples,
  type ViagemLinha,
  type ResultadoSimulacao,
  type RegimeTipo,
} from "@/lib/costSimulator";

// Etapa 2 do módulo (ver plano): formulário básico sem estilo, só pra provar que a RPC devolve
// o número agregado certo e que o motor de cálculo (src/lib/costSimulator.ts) bate com as
// entradas digitadas. O layout 2 colunas, os ajustes completos e os gráficos entram na Etapa 3.
//
// Três tipos de simulação (pedido dela, 2026-10-02, depois de ver um e-mail real de pedido de
// cotação que não era nem Embarque nem Viagem Executiva): cada um tem sua própria seção de
// entradas, mas compartilham Cliente/Ajustes/Resultado.

type TipoSimulacao = "embarque" | "viagem_executiva" | "servico_terra";

function mesesAtras(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function ajustesPadrao(): AjustesSimulacao {
  return {
    periodoReferencia: { tipo: "6", inicio: mesesAtras(6), fim: hoje() },
    metodoCalculo: "media",
    filtros: {},
    overrides: {},
    reajustePercent: 0,
    contingenciaPercent: 0,
    markup: { aplicar: false, tipo: "simples", percentualLucro: 0, percentualImposto: 0 },
  };
}

export function NovaSimulacaoTab() {
  const [tipo, setTipo] = useState<TipoSimulacao>("embarque");
  const [nomeCenario, setNomeCenario] = useState("");
  const [cliente, setCliente] = useState("");
  const [resultado, setResultado] = useState<ResultadoSimulacao | null>(null);

  // ── Embarque ──
  const [cidadeEmbarque, setCidadeEmbarque] = useState("");
  const [equipe, setEquipe] = useState<EquipeLinha[]>([{ funcao: "", qtd: 1, cidadeOrigem: "" }]);
  const [regimeTipo, setRegimeTipo] = useState<RegimeTipo>("14x14");
  const [duracaoValor, setDuracaoValor] = useState(90);
  const [mobDesmob, setMobDesmob] = useState(true);

  // ── Viagem Executiva ──
  const [viagens, setViagens] = useState<ViagemLinha[]>([
    { descricao: "", qtd: 1, origem: "", destino: "", somenteIda: false, usaHotel: true, noitesHotel: 1, usaTransporteLocal: true, qtdTransporteLocal: 2 },
  ]);

  // ── Serviço em Terra ──
  const [local, setLocal] = useState("");
  const [equipeTerra, setEquipeTerra] = useState<EquipeSimples[]>([{ funcao: "", qtd: 1 }]);
  const [duracaoDiasTerra, setDuracaoDiasTerra] = useState(9);
  const [usaAcomodacao, setUsaAcomodacao] = useState(true);
  const [usaAlimentacao, setUsaAlimentacao] = useState(true);
  const [usaTransporteLocal, setUsaTransporteLocal] = useState(true);
  const [qtdTransporteLocalPorDia, setQtdTransporteLocalPorDia] = useState(2);
  const [usaLavanderia, setUsaLavanderia] = useState(false);
  const [lavanderiaValorDiario, setLavanderiaValorDiario] = useState(0);

  const entradas: EntradasSimulacao = useMemo(() => {
    const comuns = { nomeCenario, cliente, unidade: "", bsp: "", observacoes: "" };
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
        dataInicio: hoje(),
        duracao: { valor: duracaoValor, unidade: "dias" },
        mobDesmob,
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
        usaTransporteLocal,
        qtdTransporteLocalPorDia,
        usaLavanderia,
        lavanderiaValorDiario,
      };
    }
    return { ...comuns, tipo: "viagem_executiva", viagens };
  }, [
    tipo, nomeCenario, cliente, cidadeEmbarque, equipe, regimeTipo, duracaoValor, mobDesmob, viagens,
    local, equipeTerra, duracaoDiasTerra, usaAcomodacao, usaAlimentacao, usaTransporteLocal, qtdTransporteLocalPorDia, usaLavanderia, lavanderiaValorDiario,
  ]);

  const calcular = useMutation({
    mutationFn: async () => {
      const ajustes = ajustesPadrao();
      const { cidades, rotas } = cidadesERotas(entradas);
      const stats = await fetchCostStats({
        periodoInicio: ajustes.periodoReferencia.inicio,
        periodoFim: ajustes.periodoReferencia.fim,
        cidades,
        rotas,
        bsp: entradas.bsp,
      });
      return montarResultado(entradas, ajustes, stats);
    },
    onSuccess: setResultado,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Tipo de simulação</Label>
          <select className="w-full border rounded-md h-9 px-2 text-sm" value={tipo} onChange={(e) => setTipo(e.target.value as TipoSimulacao)}>
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
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {tipo === "embarque" && (
          <EmbarqueForm
            cidadeEmbarque={cidadeEmbarque} setCidadeEmbarque={setCidadeEmbarque}
            equipe={equipe} setEquipe={setEquipe}
            regimeTipo={regimeTipo} setRegimeTipo={setRegimeTipo}
            duracaoValor={duracaoValor} setDuracaoValor={setDuracaoValor}
            mobDesmob={mobDesmob} setMobDesmob={setMobDesmob}
          />
        )}
        {tipo === "viagem_executiva" && <ViagemExecutivaForm viagens={viagens} setViagens={setViagens} />}
        {tipo === "servico_terra" && (
          <ServicoTerraForm
            local={local} setLocal={setLocal}
            equipe={equipeTerra} setEquipe={setEquipeTerra}
            duracaoDias={duracaoDiasTerra} setDuracaoDias={setDuracaoDiasTerra}
            usaAcomodacao={usaAcomodacao} setUsaAcomodacao={setUsaAcomodacao}
            usaAlimentacao={usaAlimentacao} setUsaAlimentacao={setUsaAlimentacao}
            usaTransporteLocal={usaTransporteLocal} setUsaTransporteLocal={setUsaTransporteLocal}
            qtdTransporteLocalPorDia={qtdTransporteLocalPorDia} setQtdTransporteLocalPorDia={setQtdTransporteLocalPorDia}
            usaLavanderia={usaLavanderia} setUsaLavanderia={setUsaLavanderia}
            lavanderiaValorDiario={lavanderiaValorDiario} setLavanderiaValorDiario={setLavanderiaValorDiario}
          />
        )}

        <Button type="button" onClick={() => calcular.mutate()} disabled={calcular.isPending}>
          {calcular.isPending ? "Calculando..." : "Calcular"}
        </Button>
        {calcular.isError && <p className="text-sm text-destructive">{(calcular.error as Error).message}</p>}
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="font-medium">Resultado</h2>
        {!resultado && <p className="text-sm text-muted-foreground">Preencha o formulário e clique em Calcular.</p>}
        {resultado && (
          <pre className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3 overflow-auto max-h-[70vh]">
            {JSON.stringify(resultado, null, 2)}
          </pre>
        )}
      </Card>
    </div>
  );
}

function EmbarqueForm({
  cidadeEmbarque, setCidadeEmbarque, equipe, setEquipe, regimeTipo, setRegimeTipo, duracaoValor, setDuracaoValor, mobDesmob, setMobDesmob,
}: {
  cidadeEmbarque: string; setCidadeEmbarque: (v: string) => void;
  equipe: EquipeLinha[]; setEquipe: (v: EquipeLinha[] | ((e: EquipeLinha[]) => EquipeLinha[])) => void;
  regimeTipo: RegimeTipo; setRegimeTipo: (v: RegimeTipo) => void;
  duracaoValor: number; setDuracaoValor: (v: number) => void;
  mobDesmob: boolean; setMobDesmob: (v: boolean) => void;
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
            <Input placeholder="Função" value={linha.funcao} onChange={(e) => updateLinha(i, { funcao: e.target.value })} />
            <Input type="number" min={1} placeholder="Qtd" value={linha.qtd} onChange={(e) => updateLinha(i, { qtd: Number(e.target.value) || 0 })} />
            <Input placeholder="Cidade de origem" value={linha.cidadeOrigem} onChange={(e) => updateLinha(i, { cidadeOrigem: e.target.value })} />
            <Button type="button" size="icon" variant="ghost" onClick={() => removeLinha(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label>Regime</Label>
          <select className="w-full border rounded-md h-9 px-2 text-sm" value={regimeTipo} onChange={(e) => setRegimeTipo(e.target.value as RegimeTipo)}>
            <option value="14x14">14x14</option>
            <option value="21x21">21x21</option>
            <option value="28x28">28x28</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Duração (dias)</Label>
          <Input type="number" value={duracaoValor} onChange={(e) => setDuracaoValor(Number(e.target.value) || 0)} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={mobDesmob} onChange={(e) => setMobDesmob(e.target.checked)} />
        Mob/Desmob (ida extra no início, volta extra no fim)
      </label>
    </>
  );
}

function ViagemExecutivaForm({ viagens, setViagens }: {
  viagens: ViagemLinha[]; setViagens: (v: ViagemLinha[] | ((v: ViagemLinha[]) => ViagemLinha[])) => void;
}) {
  function addViagem() {
    setViagens((v) => [...v, { descricao: "", qtd: 1, origem: "", destino: "", somenteIda: false, usaHotel: true, noitesHotel: 1, usaTransporteLocal: true, qtdTransporteLocal: 2 }]);
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
        <Button type="button" size="sm" variant="outline" onClick={addViagem}><Plus className="h-4 w-4 mr-1" /> Viagem</Button>
      </div>
      {viagens.map((v, i) => (
        <div key={i} className="border rounded-md p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Viagem {i + 1}</span>
            <Button type="button" size="icon" variant="ghost" onClick={() => removeViagem(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Descrição/pessoa" value={v.descricao} onChange={(e) => updateViagem(i, { descricao: e.target.value })} />
            <Input type="number" min={1} placeholder="Qtd" value={v.qtd} onChange={(e) => updateViagem(i, { qtd: Number(e.target.value) || 0 })} />
            <Input placeholder="Origem" value={v.origem} onChange={(e) => updateViagem(i, { origem: e.target.value })} />
            <Input placeholder="Destino" value={v.destino} onChange={(e) => updateViagem(i, { destino: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.somenteIda} onChange={(e) => updateViagem(i, { somenteIda: e.target.checked })} /> Somente ida
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.usaHotel} onChange={(e) => updateViagem(i, { usaHotel: e.target.checked })} /> Hotel
            </label>
            <Input type="number" min={0} className="w-24" placeholder="Noites" value={v.noitesHotel} onChange={(e) => updateViagem(i, { noitesHotel: Number(e.target.value) || 0 })} disabled={!v.usaHotel} />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.usaTransporteLocal} onChange={(e) => updateViagem(i, { usaTransporteLocal: e.target.checked })} /> Transporte local
            </label>
            <Input type="number" min={0} className="w-24" placeholder="Viagens" value={v.qtdTransporteLocal} onChange={(e) => updateViagem(i, { qtdTransporteLocal: Number(e.target.value) || 0 })} disabled={!v.usaTransporteLocal} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ServicoTerraForm({
  local, setLocal, equipe, setEquipe, duracaoDias, setDuracaoDias,
  usaAcomodacao, setUsaAcomodacao, usaAlimentacao, setUsaAlimentacao,
  usaTransporteLocal, setUsaTransporteLocal, qtdTransporteLocalPorDia, setQtdTransporteLocalPorDia,
  usaLavanderia, setUsaLavanderia, lavanderiaValorDiario, setLavanderiaValorDiario,
}: {
  local: string; setLocal: (v: string) => void;
  equipe: EquipeSimples[]; setEquipe: (v: EquipeSimples[] | ((e: EquipeSimples[]) => EquipeSimples[])) => void;
  duracaoDias: number; setDuracaoDias: (v: number) => void;
  usaAcomodacao: boolean; setUsaAcomodacao: (v: boolean) => void;
  usaAlimentacao: boolean; setUsaAlimentacao: (v: boolean) => void;
  usaTransporteLocal: boolean; setUsaTransporteLocal: (v: boolean) => void;
  qtdTransporteLocalPorDia: number; setQtdTransporteLocalPorDia: (v: number) => void;
  usaLavanderia: boolean; setUsaLavanderia: (v: boolean) => void;
  lavanderiaValorDiario: number; setLavanderiaValorDiario: (v: number) => void;
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
          <Button type="button" size="sm" variant="outline" onClick={addLinha}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
        </div>
        {equipe.map((linha, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
            <Input placeholder="Função" value={linha.funcao} onChange={(e) => updateLinha(i, { funcao: e.target.value })} />
            <Input type="number" min={1} placeholder="Qtd" value={linha.qtd} onChange={(e) => updateLinha(i, { qtd: Number(e.target.value) || 0 })} />
            <Button type="button" size="icon" variant="ghost" onClick={() => removeLinha(i)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>Duração (dias)</Label>
        <Input type="number" value={duracaoDias} onChange={(e) => setDuracaoDias(Number(e.target.value) || 0)} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={usaAcomodacao} onChange={(e) => setUsaAcomodacao(e.target.checked)} /> Acomodação
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={usaAlimentacao} onChange={(e) => setUsaAlimentacao(e.target.checked)} /> Alimentação (histórico de Reembolsos)
      </label>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usaTransporteLocal} onChange={(e) => setUsaTransporteLocal(e.target.checked)} /> Transporte exclusivo
        </label>
        <Input type="number" min={0} className="w-28" placeholder="Viagens/dia" value={qtdTransporteLocalPorDia} onChange={(e) => setQtdTransporteLocalPorDia(Number(e.target.value) || 0)} disabled={!usaTransporteLocal} />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usaLavanderia} onChange={(e) => setUsaLavanderia(e.target.checked)} /> Lavanderia
        </label>
        <Input type="number" min={0} step="0.01" className="w-32" placeholder="R$/pessoa/dia" value={lavanderiaValorDiario} onChange={(e) => setLavanderiaValorDiario(Number(e.target.value) || 0)} disabled={!usaLavanderia} />
      </div>
    </>
  );
}
