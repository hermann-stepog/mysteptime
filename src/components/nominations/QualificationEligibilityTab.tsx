import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  GraduationCap,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QualificationUpdateCard } from "./QualificationUpdateCard";
import {
  OPERATION_TYPE_LABEL,
  type CourseEligibilityStatus,
  type EligibilityEvaluation,
  type EligibilityStatus,
  type OperationType,
  type QualificationEligibilitySelection,
  type WorkerEligibility,
} from "@/lib/qualification-eligibility/domain";
import {
  fetchQualificationFilterCatalog,
  fetchQualificationSyncState,
  type QualificationFilterOption,
} from "@/lib/qualification-eligibility/repository";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<EligibilityStatus, string> = {
  fit: "Apto",
  "fit-with-warnings": "Apto com alertas",
  unfit: "Não apto",
};

const COURSE_STATUS_LABEL: Record<CourseEligibilityStatus, string> = {
  valid: "Válido",
  "expires-during-period": "Vence durante o período",
  expired: "Vencido",
  missing: "Não possui",
  permanent: "Sem vencimento",
};

const OPERATION_TYPES = Object.keys(OPERATION_TYPE_LABEL) as OperationType[];

export function QualificationEligibilityTab() {
  const [unitId, setUnitId] = useState("");
  const [jobCategoryId, setJobCategoryId] = useState("");
  const [operationType, setOperationType] = useState<OperationType | "">("");
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState(todayLocal());
  const [selectedWorker, setSelectedWorker] = useState<WorkerEligibility | null>(null);

  const catalogQuery = useQuery({
    queryKey: ["qualification-eligibility", "filter-catalog"],
    queryFn: () => fetchQualificationFilterCatalog(supabase),
  });
  const syncStateQuery = useQuery({
    queryKey: ["qualification-eligibility", "sync-state"],
    queryFn: () => fetchQualificationSyncState(supabase),
  });
  const catalog = catalogQuery.data;
  const invalidPeriod = Boolean(startDate && endDate && startDate > endDate);
  const selection = useMemo<QualificationEligibilitySelection | null>(() => {
    if (!unitId || !jobCategoryId || !operationType || !startDate || !endDate || invalidPeriod) {
      return null;
    }
    return { operationalUnitId: unitId, jobCategoryId, operationType, startDate, endDate };
  }, [endDate, invalidPeriod, jobCategoryId, operationType, startDate, unitId]);

  const evaluationQuery = useQuery({
    queryKey: ["qualification-eligibility", "evaluation", selection],
    queryFn: ({ signal }) => requestEligibilityEvaluation(selection!, signal),
    enabled: Boolean(selection),
    staleTime: 5 * 60_000,
  });
  const evaluation = evaluationQuery.data ?? null;
  const aptWorkers = useMemo(
    () => evaluation?.workers.filter((worker) => worker.status !== "unfit") ?? [],
    [evaluation],
  );
  const unfitWorkers = useMemo(
    () => evaluation?.workers.filter((worker) => worker.status === "unfit") ?? [],
    [evaluation],
  );
  const fitWithoutWarnings = aptWorkers.filter((worker) => worker.status === "fit").length;
  const fitWithWarnings = aptWorkers.length - fitWithoutWarnings;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]">
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <GraduationCap className="h-5 w-5" />
              Aptidão por cliente e categoria
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Consulte quem pode atender à solicitação durante todo o período. As funções de cada
              categoria e as matrizes corretas são combinadas automaticamente.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <SearchableFilterSelect
              label="Cliente / unidade"
              placeholder="Selecione a unidade"
              searchPlaceholder="Buscar unidade..."
              value={unitId}
              options={catalog?.operationalUnits ?? []}
              disabled={catalogQuery.isLoading}
              onValueChange={setUnitId}
            />
            <SearchableFilterSelect
              label="Categoria da função"
              placeholder="Selecione a categoria"
              searchPlaceholder="Buscar categoria..."
              value={jobCategoryId}
              options={catalog?.jobCategories ?? []}
              disabled={catalogQuery.isLoading}
              onValueChange={setJobCategoryId}
            />
            <div className="space-y-1.5">
              <Label>Tipo de atuação</Label>
              <Select
                value={operationType}
                onValueChange={(value) => setOperationType(value as OperationType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {OPERATION_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {OPERATION_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eligibility-start-date">Data inicial</Label>
              <Input
                id="eligibility-start-date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eligibility-end-date">Data final</Label>
              <Input
                id="eligibility-end-date"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Requisitos M/MO faltantes ou vencidos antes do início bloqueiam. Cursos que vencem
            durante o período geram alerta, mas mantêm o colaborador apto. Cursos realizados sem
            data de vencimento continuam válidos.
          </p>
          {invalidPeriod && (
            <p className="text-sm text-destructive">
              A data final deve ser igual ou posterior à data inicial.
            </p>
          )}
          {syncStateQuery.data && (
            <p className="text-xs text-muted-foreground">
              Última sincronização: {formatDateTime(syncStateQuery.data.last_success_at)} ·{" "}
              {syncStateQuery.data.worker_count} colaboradores · {syncStateQuery.data.option_count}{" "}
              opções dos dropdowns
            </p>
          )}
        </Card>
        <QualificationUpdateCard />
      </div>

      {catalogQuery.isLoading && <EligibilitySkeleton />}
      {catalogQuery.isError && (
        <ErrorCard message="Não foi possível carregar clientes e vagas. Aplique as migrações e atualize os dados do Drake." />
      )}
      {!catalogQuery.isLoading && catalog && catalog.operationalUnits.length === 0 && (
        <Card className="p-8 text-center">
          <GraduationCap className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <h3 className="font-medium">Base de qualificação ainda não atualizada</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use “Atualizar dados” para importar os dropdowns e vencimentos do Drake.
          </p>
        </Card>
      )}
      {catalog && catalog.operationalUnits.length > 0 && !selection && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Selecione cliente/unidade, categoria, tipo de atuação e período para consultar os
          colaboradores.
        </Card>
      )}
      {selection && evaluationQuery.isLoading && <EligibilitySkeleton />}
      {evaluationQuery.isError && (
        <ErrorCard
          message={
            evaluationQuery.error instanceof Error
              ? evaluationQuery.error.message
              : "Não foi possível calcular a aptidão para os filtros selecionados."
          }
        />
      )}

      {evaluation && !evaluationQuery.isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Aptos"
              value={aptWorkers.length}
              icon={CheckCircle2}
              tone="success"
            />
            <SummaryCard
              label="Sem alertas"
              value={fitWithoutWarnings}
              icon={CheckCircle2}
              tone="neutral"
            />
            <SummaryCard
              label="Com alertas"
              value={fitWithWarnings}
              icon={AlertTriangle}
              tone="warning"
            />
            <SummaryCard
              label="Não aptos"
              value={unfitWorkers.length}
              icon={XCircle}
              tone="danger"
            />
          </div>

          <RequirementCard evaluation={evaluation} />

          <Card className="overflow-hidden">
            <Tabs defaultValue="apt" className="w-full">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold">
                    Colaboradores da categoria {evaluation.context.jobCategoryName}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Período considerado de {formatDate(evaluation.startDate)} a{" "}
                    {formatDate(evaluation.endDate)}.
                  </p>
                </div>
                <TabsList className="grid w-full grid-cols-2 sm:w-72">
                  <TabsTrigger value="apt">Aptos ({aptWorkers.length})</TabsTrigger>
                  <TabsTrigger value="unfit">Não aptos ({unfitWorkers.length})</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="apt" className="m-0">
                <WorkerTable
                  workers={aptWorkers}
                  emptyMessage="Nenhum colaborador apto foi encontrado para esta solicitação."
                  onDetails={setSelectedWorker}
                />
              </TabsContent>
              <TabsContent value="unfit" className="m-0">
                <WorkerTable
                  workers={unfitWorkers}
                  emptyMessage="Nenhum colaborador ficou inapto para esta solicitação."
                  onDetails={setSelectedWorker}
                />
              </TabsContent>
            </Tabs>
          </Card>
        </>
      )}

      <WorkerDetailsDialog worker={selectedWorker} onClose={() => setSelectedWorker(null)} />
    </div>
  );
}

function SearchableFilterSelect({
  label,
  placeholder,
  searchPlaceholder,
  value,
  options,
  disabled,
  onValueChange,
}: {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  value: string;
  options: QualificationFilterOption[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between px-3 font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected?.name ?? placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>Nenhuma opção encontrada.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.name}
                    onSelect={() => {
                      onValueChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RequirementCard({ evaluation }: { evaluation: EligibilityEvaluation }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-4">
        <h3 className="font-semibold">Cursos considerados</h3>
        <p className="text-xs text-muted-foreground">
          {evaluation.requirements.length} requisitos encontrados em{" "}
          {evaluation.context.matrixNames.join(" + ")}.
        </p>
      </div>
      <ScrollArea className="h-72">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Curso / qualificação</TableHead>
              <TableHead>Exigência</TableHead>
              <TableHead>Origem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evaluation.requirements.map((requirement) => (
              <TableRow key={`${requirement.sourceMatrixName}-${requirement.qualificationId}`}>
                <TableCell className="font-medium">{requirement.qualificationName}</TableCell>
                <TableCell>
                  <Badge variant={requirement.mandatory ? "default" : "secondary"}>
                    {requirement.needTypeName}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {shortMatrixName(requirement.sourceMatrixName)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

function WorkerTable({
  workers,
  emptyMessage,
  onDetails,
}: {
  workers: WorkerEligibility[];
  emptyMessage: string;
  onDetails: (worker: WorkerEligibility) => void;
}) {
  if (workers.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Colaborador</TableHead>
          <TableHead>Matrícula</TableHead>
          <TableHead>Função</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Cursos válidos</TableHead>
          <TableHead>Próximo vencimento</TableHead>
          <TableHead>Pendências / alertas</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {workers.map((worker) => (
          <TableRow key={worker.worker.drakeWorkerId}>
            <TableCell>
              <p className="font-medium">{worker.worker.fullName}</p>
              <p className="text-xs text-muted-foreground">
                Atual: {worker.worker.currentOperationalUnitName || "Sem unidade"}
              </p>
            </TableCell>
            <TableCell>{worker.worker.registration}</TableCell>
            <TableCell className="max-w-56 text-sm">{worker.worker.jobName || "—"}</TableCell>
            <TableCell>
              <EligibilityBadge status={worker.status} />
            </TableCell>
            <TableCell>
              {worker.validCount}/{worker.courses.length}
            </TableCell>
            <TableCell>
              {worker.nextExpirationDate ? formatDate(worker.nextExpirationDate) : "—"}
            </TableCell>
            <TableCell className="max-w-sm text-xs">
              <WorkerAlertSummary worker={worker} />
            </TableCell>
            <TableCell>
              <Button variant="outline" size="sm" onClick={() => onDetails(worker)}>
                Detalhes
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{worker?.worker.fullName ?? "Detalhes da aptidão"}</DialogTitle>
        </DialogHeader>
        {worker && (
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="mb-4 flex items-center gap-2">
              <EligibilityBadge status={worker.status} />
              <span className="text-sm text-muted-foreground">
                Matrícula {worker.worker.registration} · Função {worker.worker.jobName || "—"}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curso</TableHead>
                  <TableHead>Exigência</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Realização</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worker.courses.map((course) => (
                  <TableRow key={`${course.sourceMatrixName}-${course.qualificationId}`}>
                    <TableCell className="font-medium">{course.courseName}</TableCell>
                    <TableCell>{course.mandatory ? "Mandatório" : "Recomendável"}</TableCell>
                    <TableCell>
                      <CourseStatusBadge status={course.status} />
                    </TableCell>
                    <TableCell>{course.issueDate ? formatDate(course.issueDate) : "—"}</TableCell>
                    <TableCell>
                      {course.expirationDate
                        ? formatDate(course.expirationDate)
                        : course.status === "permanent"
                          ? "Sem vencimento"
                          : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {shortMatrixName(course.sourceMatrixName)}
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
  const Icon =
    status === "valid" || status === "permanent"
      ? CheckCircle2
      : status === "expires-during-period"
        ? AlertTriangle
        : XCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        (status === "valid" || status === "permanent") && "text-emerald-700",
        status === "expires-during-period" && "text-amber-700",
        (status === "expired" || status === "missing") && "text-red-700",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {COURSE_STATUS_LABEL[status]}
    </span>
  );
}

function WorkerAlertSummary({ worker }: { worker: WorkerEligibility }) {
  const periodWarnings = worker.courses.filter(
    (course) => course.status === "expires-during-period",
  );
  const otherPending = worker.courses.filter(
    (course) => course.status === "expired" || course.status === "missing",
  );
  if (periodWarnings.length === 0 && otherPending.length === 0) return <>Nenhuma</>;

  return (
    <div className="space-y-1">
      {periodWarnings.length > 0 && (
        <p className="flex items-start gap-1 font-medium text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Vence no período: {courseSummary(periodWarnings, true)}</span>
        </p>
      )}
      {otherPending.length > 0 && (
        <p className={worker.status === "unfit" ? "text-red-700" : "text-amber-700"}>
          Pendências: {courseSummary(otherPending)}
        </p>
      )}
    </div>
  );
}

function courseSummary(courses: WorkerEligibility["courses"], includeExpiration = false): string {
  const names = courses
    .slice(0, 3)
    .map((course) =>
      includeExpiration && course.expirationDate
        ? `${course.courseName} (${formatDate(course.expirationDate)})`
        : course.courseName,
    );
  return `${names.join(", ")}${courses.length > names.length ? ` +${courses.length - names.length}` : ""}`;
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

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
      {message}
    </Card>
  );
}

async function requestEligibilityEvaluation(
  selection: QualificationEligibilitySelection,
  signal: AbortSignal,
): Promise<EligibilityEvaluation> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sua sessão no aplicativo expirou. Entre novamente.");

  const response = await fetch("/api/integrations/drake/qualification-eligibility", {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(selection),
  });
  const payload = (await response.json().catch(() => null)) as
    | EligibilityEvaluation
    | { message?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload && "message" in payload && payload.message
        ? payload.message
        : "Não foi possível consultar a aptidão no Drake.",
    );
  }
  return payload as EligibilityEvaluation;
}

function shortMatrixName(value: string): string {
  return value.replace(/^STEP\s*-\s*/i, "");
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
