import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/notify";
import { usePlanejamentoEmbarqueQuery, type PlanejamentoEmbarqueRow } from "@/components/histograma/PlanejamentoEmbarqueTab";
import { fmtDateHeadcount, StringMultiCombobox } from "@/components/histograma/HistogramaOffshoreNovo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { Search, X, ShieldCheck, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const fmt = (d: string | null) => (d ? fmtDateHeadcount(d) : "—");

// "Efetivo Offshore" — pedido dela: o RH enxerga a mesma lista/colunas (status e datas, exceto
// Férias) e os mesmos filtros do Planejamento de Embarque, mas só pode mexer no bloqueio +
// justificativa (nunca no resto da linha, que continua exclusivo da Logística). O bloqueio
// marcado aqui aparece de volta na aba de Planejamento de Embarque como um flag piscando em
// vermelho — ver rh_bloqueado/rh_bloqueio_justificativa em PlanejamentoEmbarqueTab.tsx.
export function EfetivoOffshoreTab() {
  const { data: registros = [], isLoading } = usePlanejamentoEmbarqueQuery();

  // Mesmo padrão de filtro (rascunho + aplicado no "Buscar") já usado em Planejamento de
  // Embarque — filtros independentes desta aba, não compartilham estado com aquela tela.
  const [colaboradorInput, setColaboradorInput] = useState<string[]>([]);
  const [unidadeInput, setUnidadeInput] = useState<string[]>([]);
  const [bspInput, setBspInput] = useState<string[]>([]);
  const [funcaoInput, setFuncaoInput] = useState<string[]>([]);
  const [statusInput, setStatusInput] = useState<string[]>([]);
  const [filterColaborador, setFilterColaborador] = useState<string[]>([]);
  const [filterUnidade, setFilterUnidade] = useState<string[]>([]);
  const [filterBsp, setFilterBsp] = useState<string[]>([]);
  const [filterFuncao, setFilterFuncao] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);

  const aplicarFiltro = () => {
    setFilterColaborador(colaboradorInput);
    setFilterUnidade(unidadeInput);
    setFilterBsp(bspInput);
    setFilterFuncao(funcaoInput);
    setFilterStatus(statusInput);
  };
  const limparFiltros = () => {
    setColaboradorInput([]); setUnidadeInput([]); setBspInput([]); setFuncaoInput([]); setStatusInput([]);
    setFilterColaborador([]); setFilterUnidade([]); setFilterBsp([]); setFilterFuncao([]); setFilterStatus([]);
  };

  const nomesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.nome))).sort(), [registros]);
  const unidadesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.unidade).filter((v): v is string => !!v))).sort(), [registros]);
  const bspExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.bsp).filter((v): v is string => !!v))).sort(), [registros]);
  const funcoesExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.funcao).filter((v): v is string => !!v))).sort(), [registros]);
  const statusExistentes = useMemo(() => Array.from(new Set(registros.map((r) => r.status).filter((v): v is string => !!v))).sort(), [registros]);

  const filtrados = useMemo(() => {
    return registros
      .filter((r) => filterColaborador.length === 0 || filterColaborador.includes(r.nome))
      .filter((r) => filterUnidade.length === 0 || (r.unidade != null && filterUnidade.includes(r.unidade)))
      .filter((r) => filterBsp.length === 0 || (r.bsp != null && filterBsp.includes(r.bsp)))
      .filter((r) => filterFuncao.length === 0 || (r.funcao != null && filterFuncao.includes(r.funcao)))
      .filter((r) => filterStatus.length === 0 || (r.status != null && filterStatus.includes(r.status)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [registros, filterColaborador, filterUnidade, filterBsp, filterFuncao, filterStatus]);

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-9 w-64" />
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: 8 }).map((_, i) => <TableHead key={i}><Skeleton className="h-4 w-16" /></TableHead>)}
            </TableRow>
          </TableHeader>
        </Table>
      </Card>
    );
  }

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
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
            <StringMultiCombobox options={statusExistentes} value={statusInput} onChange={setStatusInput} placeholder="Todos" searchPlaceholder="Buscar status..." emptyLabel="Nenhum status encontrado." />
          </div>
          <Button size="sm" className="h-8" onClick={aplicarFiltro}><Search className="mr-1.5 h-3.5 w-3.5" />Buscar</Button>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={limparFiltros}><X className="mr-1.5 h-3.5 w-3.5" />Limpar filtros</Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        {filtrados.length === 0 ? (
          <EmptyState icon={Search} title="Nenhum colaborador encontrado" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>BSP</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Embarque</TableHead>
                <TableHead>Desembarque</TableHead>
                <TableHead>Início Folga</TableHead>
                <TableHead>Fim Folga</TableHead>
                <TableHead className="w-40">Disponibilidade</TableHead>
                <TableHead className="w-64">Justificativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((r) => <LinhaEfetivo key={r.id} registro={r} />)}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function LinhaEfetivo({ registro }: { registro: PlanejamentoEmbarqueRow }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [justificativaDraft, setJustificativaDraft] = useState(registro.rh_bloqueio_justificativa ?? "");

  const setBloqueio = useMutation({
    mutationFn: async ({ bloqueado, justificativa }: { bloqueado: boolean; justificativa: string | null }) => {
      const { error } = await supabase.rpc("rh_set_bloqueio_planejamento", {
        p_id: registro.id,
        p_bloqueado: bloqueado,
        p_justificativa: justificativa,
        p_marcado_por: profile?.full_name ?? profile?.email ?? "RH",
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
      if (!variables.bloqueado) setJustificativaDraft("");
      notify.success("Atualizado.");
    },
    onError: (e: any) => notify.error(e.message || "Erro ao atualizar."),
  });

  return (
    <TableRow>
      <TableCell className="font-medium">{registro.nome}</TableCell>
      <TableCell>{registro.unidade ?? "—"}</TableCell>
      <TableCell>{registro.bsp ?? "—"}</TableCell>
      <TableCell>{registro.funcao ?? "—"}</TableCell>
      <TableCell>{registro.status ?? "—"}</TableCell>
      <TableCell>{fmt(registro.embarque)}</TableCell>
      <TableCell>{fmt(registro.desembarque)}</TableCell>
      <TableCell>{fmt(registro.folga_inicio)}</TableCell>
      <TableCell>{fmt(registro.folga_fim)}</TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Button
            type="button" size="sm" variant={!registro.rh_bloqueado ? "default" : "outline"}
            className={!registro.rh_bloqueado ? "h-7 bg-emerald-600 text-xs hover:bg-emerald-700" : "h-7 text-xs"}
            loading={setBloqueio.isPending && setBloqueio.variables?.bloqueado === false}
            onClick={() => setBloqueio.mutate({ bloqueado: false, justificativa: null })}
          >
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />Disponível
          </Button>
          <Button
            type="button" size="sm" variant={registro.rh_bloqueado ? "destructive" : "outline"}
            className="h-7 text-xs"
            loading={setBloqueio.isPending && setBloqueio.variables?.bloqueado === true}
            onClick={() => setBloqueio.mutate({ bloqueado: true, justificativa: justificativaDraft })}
          >
            <ShieldAlert className="mr-1 h-3.5 w-3.5" />Bloqueado
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <Input
          className="h-8 text-xs" placeholder="Motivo do bloqueio"
          value={justificativaDraft}
          onChange={(e) => setJustificativaDraft(e.target.value)}
          onBlur={() => {
            // Só grava direto no blur se já estiver bloqueado (edição do motivo já registrado)
            // — escrever a justificativa antes de clicar "Bloqueado" fica só no rascunho local,
            // usado quando o botão for clicado.
            if (registro.rh_bloqueado && justificativaDraft !== (registro.rh_bloqueio_justificativa ?? "")) {
              setBloqueio.mutate({ bloqueado: true, justificativa: justificativaDraft });
            }
          }}
        />
      </TableCell>
    </TableRow>
  );
}
