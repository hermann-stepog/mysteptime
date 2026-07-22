import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

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

  return (
    <Card className="self-start p-4 space-y-3">
      <h3 className="text-sm font-semibold">Atualizar dados do Drake</h3>
      <p className="text-xs text-muted-foreground">
        Busca os relatórios atualizados diretamente no Drake e atualiza automaticamente os
        colaboradores, embarques e períodos de disponibilidade.
      </p>

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

      {error && <p className="text-xs text-destructive">{error}</p>}

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
