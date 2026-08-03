import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, GraduationCap, Users, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DrakeUpdateCard } from "./DrakeUpdateCard";
import {
  evaluateQualificationEligibility,
  type CourseEligibilityStatus,
  type EligibilityStatus,
  type QualificationContext,
  type WorkerEligibility,
} from "@/lib/qualification-eligibility/domain";
import {
  fetchEligibilitySourceData,
  fetchQualificationContexts,
  fetchQualificationSyncState,
} from "@/lib/qualification-eligibility/repository";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<EligibilityStatus, string> = {
  fit: "Apto",
  "fit-with-warnings": "Apto com alertas",
  unfit: "Inapto",
};

const COURSE_STATUS_LABEL: Record<CourseEligibilityStatus, string> = {
  valid: "Válido",
  "expiring-soon": "Vence em breve",
  expired: "Vencido",
  missing: "Não possui",
};

export function QualificationEligibilityTab() {
  const [unit, setUnit] = useState("");
  const [job, setJob] = useState("");
  const [contextKey, setContextKey] = useState("");
  const [referenceDate, setReferenceDate] = useState(todayLocal());
  const [selectedWorker, setSelectedWorker] = useState<WorkerEligibility | null>(null);

  const contextsQuery = useQuery({
    queryKey: ["qualification-eligibility", "contexts"],
    queryFn: () => fetchQualificationContexts(supabase),
  });
  const syncStateQuery = useQuery({
    queryKey: ["qualification-eligibility", "sync-state"],
    queryFn: () => fetchQualificationSyncState(supabase),
  });
  const contexts = contextsQuery.data ?? [];
  const units = useMemo(
    () => uniqueSorted(contexts.map((context) => context.operationalUnitName)),
    [contexts],
  );
  const jobs = useMemo(
    () =>
      uniqueSorted(
        contexts
          .filter((context) => context.operationalUnitName === unit)
          .map((context) => context.jobName),
      ),
    [contexts, unit],
  );
  const availableContexts = useMemo(
    () =>
      contexts.filter((context) => context.operationalUnitName === unit && context.jobName === job),
    [contexts, job, unit],
  );
  const selectedContext = contexts.find((context) => context.contextKey === contextKey) ?? null;

  const sourceQuery = useQuery({
    queryKey: ["qualification-eligibility", "evaluation-source", contextKey],
    queryFn: () => fetchEligibilitySourceData(supabase, selectedContext!),
    enabled: Boolean(selectedContext),
  });
  const evaluation = useMemo(() => {
    if (!selectedContext || !sourceQuery.data) return null;
    return evaluateQualificationEligibility({
      context: selectedContext,
      referenceDate,
      ...sourceQuery.data,
    });
  }, [referenceDate, selectedContext, sourceQuery.data]);

  const summary = useMemo(() => {
    const workers = evaluation?.workers ?? [];
    return {
      fit: workers.filter((worker) => worker.status === "fit").length,
      warnings: workers.filter((worker) => worker.status === "fit-with-warnings").length,
      unfit: workers.filter((worker) => worker.status === "unfit").length,
      total: workers.length,
    };
  }, [evaluation]);

  const selectUnit = (value: string) => {
    setUnit(value);
    setJob("");
    setContextKey("");
  };
  const selectJob = (value: string) => {
    setJob(value);
    setContextKey("");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]">
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <GraduationCap className="h-5 w-5" />
              Aptidão por cursos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Selecione o cliente/unidade, a vaga e a matriz para comparar os requisitos com as
              validades de todos os colaboradores da mesma função.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Cliente / unidade</Label>
              <Select value={unit} onValueChange={selectUnit} disabled={contextsQuery.isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vaga / função</Label>
              <Select value={job} onValueChange={selectJob} disabled={!unit}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Matriz</Label>
              <Select value={contextKey} onValueChange={setContextKey} disabled={!job}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {availableContexts.map((context) => (
                    <SelectItem key={context.contextKey} value={context.contextKey}>
                      {matrixLabel(context)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eligibility-reference-date">Data da solicitação</Label>
              <Input
                id="eligibility-reference-date"
                type="date"
                value={referenceDate}
                onChange={(event) => setReferenceDate(event.target.value)}
              />
            </div>
          </div>

          {syncStateQuery.data && (
            <p className="text-xs text-muted-foreground">
              Última sincronização: {formatDateTime(syncStateQuery.data.last_success_at)} ·{" "}
              {syncStateQuery.data.worker_count} colaboradores ·{" "}
              {syncStateQuery.data.requirement_count} requisitos
            </p>
          )}
        </Card>
        <DrakeUpdateCard />
      </div>

      {contextsQuery.isLoading && <EligibilitySkeleton />}
      {contextsQuery.isError && (
        <Card className="border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Não foi possível carregar a base de aptidão. Confirme a aplicação da migração e tente
          atualizar os dados do Drake novamente.
        </Card>
      )}
      {!contextsQuery.isLoading && !contextsQuery.isError && contexts.length === 0 && (
        <Card className="p-8 text-center">
          <GraduationCap className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <h3 className="font-medium">Nenhum curso sincronizado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use “Atualizar dados” para importar matrizes, necessidades e vencimentos do Drake.
          </p>
        </Card>
      )}
      {contexts.length > 0 && !selectedContext && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Selecione cliente/unidade, vaga e matriz para consultar os colaboradores aptos.
        </Card>
      )}
      {selectedContext && sourceQuery.isLoading && <EligibilitySkeleton />}
      {sourceQuery.isError && (
        <Card className="border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Não foi possível calcular a aptidão para os filtros selecionados.
        </Card>
      )}

      {evaluation && !sourceQuery.isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Aptos" value={summary.fit} icon={CheckCircle2} tone="success" />
            <SummaryCard
              label="Aptos com alertas"
              value={summary.warnings}
              icon={AlertTriangle}
              tone="warning"
            />
            <SummaryCard label="Inaptos" value={summary.unfit} icon={XCircle} tone="danger" />
            <SummaryCard
              label="Candidatos avaliados"
              value={summary.total}
              icon={Users}
              tone="neutral"
            />
          </div>

          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="font-semibold">Cursos exigidos</h3>
              <p className="text-xs text-muted-foreground">
                {evaluation.requirements.length} qualificações encontradas em{" "}
                {evaluation.context.matrixName}. Somente requisitos mandatórios bloqueiam a aptidão.
              </p>
            </div>
            <ScrollArea className="max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Curso / qualificação</TableHead>
                    <TableHead>Tipo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluation.requirements.map((requirement) => (
                    <TableRow key={requirement.qualificationId}>
                      <TableCell className="font-medium">
                        {requirement.indicatedCourseName || requirement.qualificationName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={requirement.mandatory ? "default" : "secondary"}>
                          {requirement.needTypeName}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="font-semibold">Colaboradores da função</h3>
              <p className="text-xs text-muted-foreground">
                Validade considerada na data {formatDate(referenceDate)}.
              </p>
            </div>
            {evaluation.workers.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhum colaborador ativo foi encontrado para esta função.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Matrícula</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Válidos</TableHead>
                    <TableHead>Pendências</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluation.workers.map((worker) => (
                    <TableRow key={worker.worker.drakeWorkerId}>
                      <TableCell>
                        <p className="font-medium">{worker.worker.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          Atual: {worker.worker.currentOperationalUnitName || "Sem unidade"}
                        </p>
                      </TableCell>
                      <TableCell>{worker.worker.registration}</TableCell>
                      <TableCell>
                        <EligibilityBadge status={worker.status} />
                      </TableCell>
                      <TableCell>
                        {worker.validCount}/{worker.courses.length}
                      </TableCell>
                      <TableCell className="max-w-sm text-xs">{pendingSummary(worker)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedWorker(worker)}
                        >
                          Detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}

      <WorkerDetailsDialog worker={selectedWorker} onClose={() => setSelectedWorker(null)} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const colors = {
    success: "text-emerald-700 bg-emerald-50",
    warning: "text-amber-700 bg-amber-50",
    danger: "text-red-700 bg-red-50",
    neutral: "text-slate-700 bg-slate-50",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("rounded-full p-2", colors[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function EligibilityBadge({ status }: { status: EligibilityStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "fit" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        status === "fit-with-warnings" && "border-amber-200 bg-amber-50 text-amber-700",
        status === "unfit" && "border-red-200 bg-red-50 text-red-700",
      )}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function WorkerDetailsDialog({
  worker,
  onClose,
}: {
  worker: WorkerEligibility | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(worker)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{worker?.worker.fullName ?? "Detalhes da aptidão"}</DialogTitle>
        </DialogHeader>
        {worker && (
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="mb-4 flex items-center gap-2">
              <EligibilityBadge status={worker.status} />
              <span className="text-sm text-muted-foreground">
                Matrícula {worker.worker.registration}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curso</TableHead>
                  <TableHead>Exigência</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Validade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worker.courses.map((course) => (
                  <TableRow key={course.qualificationId}>
                    <TableCell className="font-medium">{course.courseName}</TableCell>
                    <TableCell>{course.mandatory ? "Mandatório" : "Recomendável"}</TableCell>
                    <TableCell>
                      <CourseStatusBadge status={course.status} />
                    </TableCell>
                    <TableCell>
                      {course.expirationDate ? formatDate(course.expirationDate) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CourseStatusBadge({ status }: { status: CourseEligibilityStatus }) {
  const Icon = status === "valid" ? CheckCircle2 : status === "expiring-soon" ? Clock3 : XCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        status === "valid" && "text-emerald-700",
        status === "expiring-soon" && "text-amber-700",
        (status === "expired" || status === "missing") && "text-red-700",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {COURSE_STATUS_LABEL[status]}
    </span>
  );
}

function pendingSummary(worker: WorkerEligibility): string {
  const pending = worker.courses.filter((course) => course.status !== "valid");
  if (pending.length === 0) return "Nenhuma";
  const names = pending.slice(0, 3).map((course) => course.courseName);
  return `${names.join(", ")}${pending.length > names.length ? ` +${pending.length - names.length}` : ""}`;
}

function EligibilitySkeleton() {
  return (
    <Card className="space-y-3 p-4">
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </Card>
  );
}

function matrixLabel(context: QualificationContext): string {
  return context.matrixName.replace(/^STEP\s*-\s*/i, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function todayLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
