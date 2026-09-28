import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/notify";
import { usePlanejamentoEmbarqueQuery, type PlanejamentoEmbarqueRow } from "@/components/histograma/PlanejamentoEmbarqueTab";
import { fmtDateHeadcount } from "@/components/histograma/HistogramaOffshoreNovo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { Search, ShieldCheck, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const fmt = (d: string | null) => (d ? fmtDateHeadcount(d) : "—");

// "Efetivo Offshore" — pedido dela: o RH enxerga a mesma lista/colunas (status e todas as
// datas) do Planejamento de Embarque, mas só pode mexer no bloqueio + justificativa (nunca no
// resto da linha, que continua exclusivo da Logística). O bloqueio marcado aqui aparece de
// volta na aba de Planejamento de Embarque como um flag piscando em vermelho — ver
// rh_bloqueado/rh_bloqueio_justificativa em PlanejamentoEmbarqueTab.tsx.
export function EfetivoOffshoreTab() {
  const { data: registros = [], isLoading } = usePlanejamentoEmbarqueQuery();
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = termo ? registros.filter((r) => r.nome.toLowerCase().includes(termo)) : registros;
    return [...base].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [registros, busca]);

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
      <div className="relative w-72">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Buscar por nome..." value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

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
                <TableHead>Início Férias</TableHead>
                <TableHead>Fim Férias</TableHead>
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
  const [editandoBloqueio, setEditandoBloqueio] = useState(false);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planejamento-embarque"] });
      notify.success("Atualizado.");
      setEditandoBloqueio(false);
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
      <TableCell>{fmt(registro.ferias_inicio)}</TableCell>
      <TableCell>{fmt(registro.ferias_fim)}</TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Button
            type="button" size="sm" variant={!registro.rh_bloqueado ? "default" : "outline"}
            className={!registro.rh_bloqueado ? "h-7 bg-emerald-600 text-xs hover:bg-emerald-700" : "h-7 text-xs"}
            loading={setBloqueio.isPending && setBloqueio.variables?.bloqueado === false}
            onClick={() => { setEditandoBloqueio(false); setBloqueio.mutate({ bloqueado: false, justificativa: null }); }}
          >
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />Disponível
          </Button>
          <Button
            type="button" size="sm" variant={registro.rh_bloqueado ? "destructive" : "outline"}
            className="h-7 text-xs"
            onClick={() => { setJustificativaDraft(registro.rh_bloqueio_justificativa ?? ""); setEditandoBloqueio(true); }}
          >
            <ShieldAlert className="mr-1 h-3.5 w-3.5" />Bloqueado
          </Button>
        </div>
      </TableCell>
      <TableCell>
        {editandoBloqueio ? (
          <div className="space-y-1.5">
            <Textarea
              rows={2} className="text-xs" placeholder="Motivo do bloqueio"
              value={justificativaDraft} onChange={(e) => setJustificativaDraft(e.target.value)}
            />
            <div className="flex gap-1.5">
              <Button
                type="button" size="sm" variant="destructive" className="h-7 text-xs"
                loading={setBloqueio.isPending && setBloqueio.variables?.bloqueado === true}
                onClick={() => setBloqueio.mutate({ bloqueado: true, justificativa: justificativaDraft })}
              >
                Confirmar bloqueio
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditandoBloqueio(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{registro.rh_bloqueio_justificativa ?? "—"}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
