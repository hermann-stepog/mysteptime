import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { notify } from "@/lib/notify";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  DRAKE_REPORT_STATUS_LABEL,
  type DrakeProgressEvent,
  type DrakeReportStatus,
  type DrakeUpdateResult,
} from "@/lib/drake/update-types";
import { consumeDrakeNdjsonStream } from "@/lib/drake/ndjson-stream";
import { decodeAppAuthMessage } from "@/lib/supabase/app-auth-errors";
import { parseExcelDate } from "@/lib/histograma/drake-spreadsheet-parser";
import { selectAllPages } from "@/lib/supabasePaginate";
import {
  computeDayStatus, toOldBucket, STATUS_LABEL, addDays,
  type HistNovoColaborador, type HistNovoPeriodo,
} from "@/lib/histogramaNovo";
import { cn } from "@/lib/utils";

interface BaseImportResult {
  inseridos: string[];
  ignorados: { nome: string; motivo: string }[];
  naoEncontrados: string[];
  ambiguos: string[];
}

function normalizeNome(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function ReportStatusIcon({ status }: { status: DrakeReportStatus }) {
  if (status === "completed")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  if (status === "failed")
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />;
  if (
    status === "processing" ||
    status === "downloading" ||
    status === "validating" ||
    status === "importing"
  ) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />;
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function isInternalPathLeak(message: string): boolean {
  return /ENOENT|no such file or directory|context-controls|tmp[/\\]drake|mysteptime-drake|[A-Za-z]:\\|\bEPERM\b|\bEBUSY\b/i.test(
    message,
  );
}

function messageFromErrorPayload(event: DrakeProgressEvent): string {
  if (event.code === "DRAKE_TEMP_STORAGE_ERROR" || isInternalPathLeak(event.message ?? "")) {
    return "Não foi possível preparar os arquivos temporários da atualização.";
  }
  if (event.code) {
    const decoded = decodeAppAuthMessage(`${event.code}: ${event.message}`);
    if (decoded.code) return decoded.message;
  }
  const message = event.message || "Não foi possível atualizar os dados do Drake.";
  if (isInternalPathLeak(message)) {
    return "Não foi possível preparar os arquivos temporários da atualização.";
  }
  return message;
}

export function DrakeUpdateCard() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canUpdate = role === "logistics_operator";

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embarkationStatus, setEmbarkationStatus] = useState<DrakeReportStatus>("waiting");
  const [availabilityStatus, setAvailabilityStatus] = useState<DrakeReportStatus>("waiting");
  const [result, setResult] = useState<DrakeUpdateResult | null>(null);
  const [buttonLabel, setButtonLabel] = useState<"idle" | "running" | "done">("idle");
  const [showProgress, setShowProgress] = useState(false);

  const [importandoBase, setImportandoBase] = useState(false);
  const [baseResult, setBaseResult] = useState<BaseImportResult | null>(null);
  const baseFileRef = useRef<HTMLInputElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, []);

  if (!canUpdate) return null;

  const label =
    buttonLabel === "running" || isRunning
      ? "Atualizando..."
      : buttonLabel === "done"
        ? "Dados atualizados"
        : error
          ? "Tentar novamente"
          : "Atualizar dados";

  const disabled = isRunning || buttonLabel === "done";

  const applyEvent = (event: DrakeProgressEvent) => {
    if (event.type !== "error") {
      setProgress(event.progress);
    } else if (typeof event.progress === "number" && event.progress > 0) {
      setProgress(event.progress);
    }
    setEmbarkationStatus(event.embarkationStatus);
    setAvailabilityStatus(event.availabilityStatus);

    if (event.type === "error") {
      setIsRunning(false);
      setButtonLabel("idle");
      setError(messageFromErrorPayload(event));
      setMessage(null);
      notify.error(messageFromErrorPayload(event));
      return;
    }

    setMessage(event.message);

    if (event.type === "completed") {
      setIsRunning(false);
      setError(null);
      setProgress(100);
      setMessage("Dados atualizados com sucesso.");
      setEmbarkationStatus("completed");
      setAvailabilityStatus("completed");
      setResult(event.result ?? null);
      setButtonLabel("done");
      notify.success("Dados atualizados com sucesso.");
      void qc.invalidateQueries({ queryKey: ["hist-novo-colaboradores"] });
      void qc.invalidateQueries({ queryKey: ["hist-novo-periodos"] });
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setButtonLabel("idle"), 4000);
    }
  };

  const handleClick = async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setError(null);
    setResult(null);
    setIsRunning(true);
    setShowProgress(true);
    setProgress(0);
    setMessage("Preparando atualização...");
    setEmbarkationStatus("waiting");
    setAvailabilityStatus("waiting");
    setButtonLabel("running");

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Sua sessão no aplicativo expirou. Entre novamente.");
      }

      const response = await fetch("/api/integrations/drake/update", {
        method: "POST",
        credentials: "include",
        signal: abort.signal,
        headers: {
          Accept: "application/x-ndjson",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ accessToken }),
      });

      if (response.status === 409) {
        const payload = (await response.json().catch(() => null)) as DrakeProgressEvent | null;
        throw new Error(payload?.message ?? "Já existe uma atualização em andamento.");
      }

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        let parsed: { message?: string } | null = null;
        try {
          parsed = text ? (JSON.parse(text) as { message?: string }) : null;
        } catch {
          /* ignore */
        }
        throw new Error(parsed?.message || "Não foi possível iniciar a atualização.");
      }

      await consumeDrakeNdjsonStream(response.body, applyEvent, abort.signal);
    } catch (e: unknown) {
      if (abort.signal.aborted) return;
      const raw = e instanceof Error ? e.message : "Não foi possível atualizar os dados do Drake.";
      const msg = isInternalPathLeak(raw)
        ? "Não foi possível preparar os arquivos temporários da atualização."
        : raw;
      setIsRunning(false);
      setButtonLabel("idle");
      setError(msg);
      setMessage(null);
      notify.error(msg);
    }
  };

  // Importa o relatório de "quem vem trabalhar na base" (planilha externa, fora do Drake) e
  // cruza por nome com quem está de Folga ou Standby agora — só esses dois casos viram "Na
  // Base" (ver isOcupadoBucket em histogramaNovo.ts); quem já está Embarcado, de Férias,
  // Atestado etc. é ignorado, porque essas informações são mais autoritativas. Cada
  // importação SUBSTITUI por completo o lote anterior (apaga todo tipo="BASE" e insere de
  // novo a partir da planilha atual). A planilha do dia normalmente só informa "hoje" (sem
  // data fim própria) — nesse caso o "Na Base" continua valendo nos dias seguintes com os
  // dados de ontem até ela importar uma planilha nova, em vez de sumir no dia seguinte por
  // falta de reimportação.
  const handleImportBase = async (file: File) => {
    setImportandoBase(true);
    setBaseResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
      if (!rows.length) throw new Error("Planilha vazia.");

      const norm = (k: unknown) => String(k ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const first = rows[0].map(norm);
      let idxNome = first.findIndex((c) => ["nome", "colaborador", "trabalhador", "funcionario"].includes(c));
      let idxInicio = first.findIndex((c) => ["data inicio", "inicio", "data_inicio", "data de inicio"].includes(c));
      let idxFim = first.findIndex((c) => ["data fim", "fim", "data_fim", "data de fim", "data termino", "termino"].includes(c));
      const hasHeader = idxNome >= 0 || idxInicio >= 0 || idxFim >= 0;
      const dataRows = hasHeader ? rows.slice(1) : rows;
      if (idxNome < 0) idxNome = 0;
      if (idxInicio < 0) idxInicio = 1;
      if (idxFim < 0) idxFim = 2;

      const linhas = dataRows
        .map((r) => {
          const dataInicio = parseExcelDate(r[idxInicio]);
          const dataFimInformada = parseExcelDate(r[idxFim]);
          return {
            nome: String(r[idxNome] ?? "").trim(),
            dataInicio,
            // A planilha do dia normalmente só traz "hoje" (sem data fim própria) — nesse
            // caso o "Na Base" precisa continuar valendo nos dias seguintes até ela importar
            // uma planilha nova (que substitui esse lote inteiro, ver abaixo), não só no dia
            // exato do import. Só respeita uma data fim mais curta quando a planilha realmente
            // trouxer uma.
            dataFim: dataFimInformada ?? (dataInicio ? addDays(dataInicio, 365) : null),
          };
        })
        .filter((l): l is { nome: string; dataInicio: string; dataFim: string } => !!l.nome && !!l.dataInicio && !!l.dataFim);

      if (!linhas.length) {
        throw new Error("Nenhuma linha válida encontrada — preciso de nome e data de início em cada linha.");
      }

      const [colaboradores, periodos] = await Promise.all([
        selectAllPages<HistNovoColaborador>((from, to) =>
          supabase.from("hist_novo_colaboradores").select("*").order("id").range(from, to)),
        selectAllPages<HistNovoPeriodo>((from, to) =>
          supabase.from("hist_novo_periodos").select("*").order("id").range(from, to)),
      ]);

      const colabPorNome = new Map<string, HistNovoColaborador[]>();
      colaboradores.forEach((c) => {
        const key = normalizeNome(c.nome);
        if (!colabPorNome.has(key)) colabPorNome.set(key, []);
        colabPorNome.get(key)!.push(c);
      });
      const periodosPorColab = new Map<string, HistNovoPeriodo[]>();
      periodos.forEach((p) => {
        if (!periodosPorColab.has(p.colaborador_id)) periodosPorColab.set(p.colaborador_id, []);
        periodosPorColab.get(p.colaborador_id)!.push(p);
      });

      const inseridos: string[] = [];
      const ignorados: { nome: string; motivo: string }[] = [];
      const naoEncontrados: string[] = [];
      const ambiguos: string[] = [];
      const registros: any[] = [];

      for (const linha of linhas) {
        const candidatos = colabPorNome.get(normalizeNome(linha.nome)) ?? [];
        if (candidatos.length === 0) { naoEncontrados.push(linha.nome); continue; }
        if (candidatos.length > 1) { ambiguos.push(linha.nome); continue; }
        const colaborador = candidatos[0];
        const ps = periodosPorColab.get(colaborador.id) ?? [];
        const result = computeDayStatus(ps, linha.dataInicio);
        const bucket = toOldBucket(result.status);
        if (bucket !== "FO" && bucket !== "B") {
          ignorados.push({ nome: colaborador.nome, motivo: STATUS_LABEL[result.status] });
          continue;
        }
        const dias = Math.round((new Date(linha.dataFim).getTime() - new Date(linha.dataInicio).getTime()) / 86400000) + 1;
        registros.push({
          colaborador_id: colaborador.id, tipo: "BASE", origem: "manual",
          data_inicio: linha.dataInicio, data_fim: linha.dataFim, dias: dias > 0 ? dias : 1,
          unidade_operacional: null, bsp: null, centro_de_custo: null,
        });
        inseridos.push(colaborador.nome);
      }

      const { error: delErr } = await supabase.from("hist_novo_periodos").delete().eq("tipo", "BASE");
      if (delErr) throw delErr;
      if (registros.length > 0) {
        const { error: insErr } = await supabase.from("hist_novo_periodos").insert(registros);
        if (insErr) throw insErr;
      }

      void qc.invalidateQueries({ queryKey: ["hist-novo-periodos"] });
      setBaseResult({ inseridos, ignorados, naoEncontrados, ambiguos });
      notify.success(`${inseridos.length} colaborador(es) marcado(s) como "Na Base".`);
    } catch (e: any) {
      notify.error(e.message || "Erro ao importar o relatório da base.");
    } finally {
      setImportandoBase(false);
      if (baseFileRef.current) baseFileRef.current.value = "";
    }
  };

  return (
    <Card className="self-start p-4 space-y-3">
      <h3 className="text-sm font-semibold">Atualizar dados do Drake</h3>
      <p className="text-xs text-muted-foreground">
        Busca os relatórios atualizados diretamente no Drake e atualiza automaticamente os
        colaboradores, embarques e períodos de disponibilidade.
      </p>

      <div className="flex flex-wrap gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                disabled={disabled}
                loading={isRunning}
                onClick={() => void handleClick()}
                aria-label="Buscar e atualizar dados pelo Drake"
              >
                <RefreshCw className={cn("mr-2 h-4 w-4", isRunning && "animate-spin")} />
                {label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Buscar e atualizar dados pelo Drake</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <input
          ref={baseFileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void handleImportBase(e.target.files[0])}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                disabled={importandoBase}
                loading={importandoBase}
                onClick={() => baseFileRef.current?.click()}
                aria-label="Importar relatório de quem vem trabalhar na base"
              >
                <Upload className="mr-2 h-4 w-4" />
                {importandoBase ? "Importando..." : "Importar relatório da base"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Importa a planilha de quem vem trabalhar na base e cruza por nome com quem está
              de Folga/Standby, marcando como "Na Base"
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {baseResult && (
        <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
          <p className="font-medium text-foreground">
            Relatório da base: {baseResult.inseridos.length} marcado(s) como "Na Base"
          </p>
          {baseResult.ignorados.length > 0 && (
            <p className="text-muted-foreground">
              {baseResult.ignorados.length} ignorado(s) (já tinham status mais autoritativo): {" "}
              {baseResult.ignorados.map((i) => `${i.nome} (${i.motivo})`).join(", ")}
            </p>
          )}
          {baseResult.naoEncontrados.length > 0 && (
            <p className="text-muted-foreground">
              {baseResult.naoEncontrados.length} não encontrado(s) por nome: {baseResult.naoEncontrados.join(", ")}
            </p>
          )}
          {baseResult.ambiguos.length > 0 && (
            <p className="text-muted-foreground">
              {baseResult.ambiguos.length} nome(s) ambíguo(s) (mais de um colaborador com esse nome): {baseResult.ambiguos.join(", ")}
            </p>
          )}
        </div>
      )}

      {showProgress && (
        <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {message ?? (error ? "Atualização interrompida." : "Preparando atualização...")}
            </span>
            <span className="font-medium tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <ReportStatusIcon status={embarkationStatus} />
                Relatório de embarque
              </span>
              <span className="text-muted-foreground">
                {DRAKE_REPORT_STATUS_LABEL[embarkationStatus]}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <ReportStatusIcon status={availabilityStatus} />
                Relatório de disponibilidade
              </span>
              <span className="text-muted-foreground">
                {DRAKE_REPORT_STATUS_LABEL[availabilityStatus]}
              </span>
            </div>
          </div>

          {buttonLabel === "done" && result && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Resumo:</p>
              {(result.created != null || result.updated != null) && (
                <p>
                  {(result.created ?? 0) + (result.updated ?? 0)} colaboradores atualizados
                  {` (${result.created ?? 0} criados, ${result.updated ?? 0} atualizados)`}
                </p>
              )}
              {result.embarkationEvents != null && (
                <p>{result.embarkationEvents} embarques processados</p>
              )}
              {result.availabilityEvents != null && (
                <p>{result.availabilityEvents} períodos de disponibilidade lançados</p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
