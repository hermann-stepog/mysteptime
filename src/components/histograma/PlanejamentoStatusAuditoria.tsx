import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchHistogramCollaborators, fetchHistogramPeriods } from "@/lib/histograma/read-model";
import {
  todayStr, computeDayStatus, getComputedLabel, type ComputedStatus, type HistNovoPeriodo,
} from "@/lib/histogramaNovo";
import { isStatusEmbarcado, isStatusFolga, type PlanejamentoEmbarqueRow } from "@/components/histograma/PlanejamentoEmbarqueTab";
import { fetchLogisticSchedulingStatus } from "@/lib/api/planejamentoStatusAuditoria.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, ShieldAlert, Radar } from "lucide-react";

// Auditoria só-admin (pedido dela, 2026-10-02): compara o texto livre da coluna Status do
// Planejamento de Embarque com o status que o Drake calcula pra hoje (mesma lógica de
// computeDayStatus usada no resto do Histograma), pra ela conferir se a equipe está
// preenchendo certo. É um alerta pra revisão, não um veredito.
// Escopo restrito a só 3 casos (pedido dela, 2026-10-02, pra reduzir alarme falso): Embarcado,
// Folga e Férias. Qualquer outro status do Planejamento (Disponível, Na Base, Programado,
// Bloqueio RH/Temporário etc.) fica "Não comparável" — nunca é marcado pra revisão.
// Reaproveita o cache das mesmas queries ["hist-novo-colaboradores"]/["hist-novo-periodos"]
// que o Dashboard/Histograma já mantêm — não dispara uma segunda leitura se essas abas já
// foram abertas nesta sessão.
//
// "Checar ao vivo no Drake" (caso real: Adelmo Moreira Lopes, 2026-10-02): o status Drake acima
// vem só da Ficha Anual de Posição (grade F/E) já sincronizada, que pode estar desatualizada —
// o próprio Drake tem uma segunda fonte por colaborador (endpoint LogisticScheduling, o mesmo
// que alimenta a tela "Embarques e Desembarques") mais em tempo real. O botão consulta essa
// segunda fonte ao vivo (nada é gravado no banco) só pras linhas marcadas "Revisar", e promove
// pra "Confere (ao vivo)" quando ela confirma — ver src/lib/drake/logistic-scheduling-api.server.ts
// e src/lib/api/planejamentoStatusAuditoria.functions.ts.

function normalizeMatricula(m: string | null | undefined): string | null {
  const t = (m ?? "").trim();
  return t ? t.replace(/^0+(?=\d)/, "") : null;
}

type Situacao = "confere" | "confere_ao_vivo" | "divergente" | "sem_vinculo" | "nao_comparavel";

const DRAKE_ESPERADO: Partial<Record<string, ComputedStatus[]>> = {
  // Folga Indenizada (FI/FIH/FIF/FIC/FIT/FIE) conta como Embarcado no Drake (pedido dela,
  // 2026-10-02) — é um dia de embarque pago como folga, não deixa de ser embarque.
  embarcado: ["E", "DB", "DES", "DDN", "FI", "FIH", "FIF", "FIC", "FIT", "FIE"],
  // Também ok com Standby no Drake (pedido dela, 2026-10-02) — fim de uma folga registrada no
  // Drake às vezes já cai em Standby antes do Planejamento atualizar pro próximo status.
  folga: ["F", "FI", "FIH", "FIF", "FIC", "FIT", "FIE", "STB"],
  ferias: ["FE"],
};

type Bucket = keyof typeof DRAKE_ESPERADO;

// "Férias" não tem um isStatus* próprio em PlanejamentoEmbarqueTab.tsx — reconhece só o texto
// livre do Status, igual Embarcado/Folga. NÃO usa ferias_inicio/ferias_fim como critério: eram
// uma fonte de falso positivo (pedido dela, 2026-10-05 — um registro com essas datas vencidas/
// erradas sobrando no cadastro marcava "Revisar" mesmo quando o Status dizia outra coisa, ex.
// o caso do Luan: "Disponível" no Planejamento = "Standby" no Drake, são a mesma coisa).
function isStatusFerias(status: string | null): boolean {
  const s = (status ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s === "FERIAS";
}

function bucketDoStatusPlanejamento(status: string | null): Bucket | null {
  if (isStatusEmbarcado(status)) return "embarcado";
  if (isStatusFolga(status)) return "folga";
  if (isStatusFerias(status)) return "ferias";
  return null;
}

interface LinhaAuditoria {
  nome: string;
  matricula: string | null;
  statusPlanejamento: string | null;
  statusDrakeLabel: string | null;
  bucket: Bucket | null;
  situacao: Situacao;
}

export function PlanejamentoStatusAuditoria({ registros }: { registros: PlanejamentoEmbarqueRow[] }) {
  const [aberto, setAberto] = useState(false);
  const [somenteDivergentes, setSomenteDivergentes] = useState(true);

  const { data: colaboradores = [] } = useQuery({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: fetchHistogramCollaborators,
    enabled: aberto,
  });
  const { data: periodos = [] } = useQuery({
    queryKey: ["hist-novo-periodos"],
    queryFn: fetchHistogramPeriods,
    enabled: aberto,
  });

  const linhasBase = useMemo<LinhaAuditoria[]>(() => {
    if (!aberto) return [];
    const colaboradorPorMatricula = new Map(
      colaboradores.map((c) => [normalizeMatricula(c.matricula), c] as const).filter(([m]) => m !== null),
    );
    const periodosPorColaborador = new Map<string, HistNovoPeriodo[]>();
    periodos.forEach((p) => {
      if (!periodosPorColaborador.has(p.colaborador_id)) periodosPorColaborador.set(p.colaborador_id, []);
      periodosPorColaborador.get(p.colaborador_id)!.push(p);
    });
    const hoje = todayStr();

    return registros.map((r) => {
      const matricula = normalizeMatricula(r.matricula);
      const colaborador = matricula ? colaboradorPorMatricula.get(matricula) : undefined;
      if (!colaborador) {
        return { nome: r.nome, matricula: r.matricula, statusPlanejamento: r.status, statusDrakeLabel: null, bucket: null, situacao: "sem_vinculo" as Situacao };
      }
      const periodosDoColaborador = periodosPorColaborador.get(colaborador.id) ?? [];
      const drakeStatus = computeDayStatus(periodosDoColaborador, hoje).status;
      const bucket = bucketDoStatusPlanejamento(r.status);
      const situacao: Situacao = !bucket ? "nao_comparavel" : DRAKE_ESPERADO[bucket]!.includes(drakeStatus) ? "confere" : "divergente";
      return { nome: r.nome, matricula: r.matricula, statusPlanejamento: r.status, statusDrakeLabel: getComputedLabel({ status: drakeStatus }), bucket, situacao };
    });
  }, [aberto, registros, colaboradores, periodos]);

  const checarAoVivo = useMutation({
    mutationFn: async () => {
      const matriculas = linhasBase
        .filter((l) => l.situacao === "divergente" && l.matricula)
        .map((l) => l.matricula!);
      if (matriculas.length === 0) return {};
      return fetchLogisticSchedulingStatus({ data: { matriculas } });
    },
  });

  const linhas = useMemo<LinhaAuditoria[]>(() => {
    const aoVivo = checarAoVivo.data;
    if (!aoVivo) return linhasBase;
    return linhasBase.map((l) => {
      if (l.situacao !== "divergente" || !l.matricula || !l.bucket) return l;
      const statusVivo = aoVivo[l.matricula];
      if (!statusVivo) return l;
      const confirma = l.bucket === "embarcado" ? statusVivo === "embarcado" : statusVivo === "na_base";
      return confirma ? { ...l, situacao: "confere_ao_vivo" as Situacao } : l;
    });
  }, [linhasBase, checarAoVivo.data]);

  const divergentes = linhas.filter((l) => l.situacao === "divergente");
  const linhasExibidas = somenteDivergentes ? divergentes : linhas;
  const qtdParaChecar = linhasBase.filter((l) => l.situacao === "divergente" && l.matricula).length;

  return (
    <Card className="p-4">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setAberto((v) => !v)}>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          Auditoria: Status x Drake (só você vê)
          {aberto && divergentes.length > 0 && <Badge variant="destructive">{divergentes.length} divergência(s)</Badge>}
        </span>
        {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {!aberto && (
        <p className="mt-1 text-xs text-muted-foreground">
          Compara o Status digitado aqui com o que o Drake mostra pra hoje, pra você conferir se a equipe está preenchendo certo.
        </p>
      )}
      {aberto && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground max-w-xl">
              Só compara Embarcado, Folga e Férias — qualquer outro Status (Disponível, Na Base, Programado, Bloqueio etc.)
              fica fora da checagem. Trate como um alerta pra revisar, não como veredito.
            </p>
            <div className="flex items-center gap-2">
              {qtdParaChecar > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => checarAoVivo.mutate()} disabled={checarAoVivo.isPending}>
                  <Radar className="h-3.5 w-3.5 mr-1.5" />
                  {checarAoVivo.isPending ? "Checando no Drake..." : `Checar ${qtdParaChecar} ao vivo no Drake`}
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => setSomenteDivergentes((v) => !v)}>
                {somenteDivergentes ? "Mostrar todos" : "Mostrar só divergências"}
              </Button>
            </div>
          </div>
          {checarAoVivo.isError && (
            <p className="text-sm text-destructive">{(checarAoVivo.error as Error).message}</p>
          )}
          {linhasExibidas.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {somenteDivergentes ? "Nenhuma divergência encontrada." : "Nenhum registro."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Status (Planejamento)</TableHead>
                  <TableHead>Status (Drake hoje)</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhasExibidas.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{l.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{l.matricula ?? "—"}</TableCell>
                    <TableCell>{l.statusPlanejamento ?? "—"}</TableCell>
                    <TableCell>{l.statusDrakeLabel ?? "—"}</TableCell>
                    <TableCell>
                      {l.situacao === "confere" && <Badge variant="outline" className="border-emerald-300 text-emerald-700">Confere</Badge>}
                      {l.situacao === "confere_ao_vivo" && <Badge variant="outline" className="border-emerald-300 text-emerald-700">Confere (ao vivo)</Badge>}
                      {l.situacao === "divergente" && <Badge variant="destructive">Revisar</Badge>}
                      {l.situacao === "sem_vinculo" && <Badge variant="outline" className="text-muted-foreground">Sem vínculo Drake</Badge>}
                      {l.situacao === "nao_comparavel" && <Badge variant="outline" className="text-muted-foreground">Não comparável</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}
