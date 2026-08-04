import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { consumeDrakeNdjsonStream } from "@/lib/drake/ndjson-stream";
import { getDrakeUpdateAccessToken, safeDrakeClientErrorMessage } from "@/lib/drake/update-client";
import { notify } from "@/lib/notify";
import { decodeAppAuthMessage } from "@/lib/supabase/app-auth-errors";
import {
  QUALIFICATION_UPDATE_STATUS_LABEL,
  type QualificationProgressEvent,
  type QualificationUpdateResult,
  type QualificationUpdateStatus,
} from "@/lib/qualification-eligibility/update-types";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: QualificationUpdateStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  }
  if (status === "failed") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />;
  }
  if (status === "processing" || status === "importing") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />;
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

function errorMessage(event: QualificationProgressEvent): string {
  if (event.code) {
    const decoded = decodeAppAuthMessage(`${event.code}: ${event.message}`);
    if (decoded.code) return decoded.message;
  }
  return safeDrakeClientErrorMessage(
    event.message,
    "Não foi possível atualizar os dados de aptidão.",
  );
}

export function QualificationUpdateCard() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const canUpdate = role === "logistics_operator";
  const [isRunning, setIsRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<QualificationUpdateStatus>("waiting");
  const [result, setResult] = useState<QualificationUpdateResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!canUpdate) return null;

  const applyEvent = (event: QualificationProgressEvent): void => {
    if (typeof event.progress === "number") setProgress(event.progress);
    setStatus(event.qualificationStatus);

    if (event.type === "error") {
      const controlledMessage = errorMessage(event);
      setIsRunning(false);
      setMessage(null);
      setError(controlledMessage);
      notify.error(controlledMessage);
      return;
    }

    setMessage(event.message);
    if (event.type !== "completed") return;

    setIsRunning(false);
    setProgress(100);
    setStatus("completed");
    setError(null);
    setResult(event.result ?? null);
    notify.success("Cursos e dados de aptidão atualizados.");
    void queryClient.invalidateQueries({ queryKey: ["qualification-eligibility"] });
  };

  const handleUpdate = async (): Promise<void> => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setIsRunning(true);
    setShowProgress(true);
    setProgress(0);
    setMessage("Preparando atualização de aptidão...");
    setError(null);
    setResult(null);
    setStatus("waiting");

    try {
      const accessToken = await getDrakeUpdateAccessToken();
      if (!accessToken) throw new Error("Sua sessão no aplicativo expirou. Entre novamente.");

      const response = await fetch("/api/integrations/drake/qualification-update", {
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
        const payload = (await response
          .json()
          .catch(() => null)) as QualificationProgressEvent | null;
        throw new Error(payload?.message ?? "Já existe uma atualização do Drake em andamento.");
      }
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Não foi possível iniciar a atualização de aptidão.");
      }

      await consumeDrakeNdjsonStream(response.body, applyEvent, abort.signal);
    } catch (caught: unknown) {
      if (abort.signal.aborted) return;
      const raw =
        caught instanceof Error
          ? caught.message
          : "Não foi possível atualizar os dados de aptidão.";
      const controlledMessage = safeDrakeClientErrorMessage(
        raw,
        "Não foi possível atualizar os dados de aptidão.",
      );
      setIsRunning(false);
      setMessage(null);
      setError(controlledMessage);
      setStatus("failed");
      notify.error(controlledMessage);
    }
  };

  return (
    <Card className="self-start space-y-3 p-4">
      <h3 className="text-sm font-semibold">Atualizar dados de aptidão</h3>
      <p className="text-xs text-muted-foreground">
        Atualiza exclusivamente vagas, unidades, cursos e vencimentos usados na consulta de aptidão.
      </p>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              disabled={isRunning}
              loading={isRunning}
              onClick={() => void handleUpdate()}
              aria-label="Atualizar cursos e dados de aptidão"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isRunning && "animate-spin")} />
              {isRunning ? "Atualizando..." : error ? "Tentar novamente" : "Atualizar aptidão"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Atualizar somente os dados usados na aba Aptidão</TooltipContent>
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
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5">
              <StatusIcon status={status} />
              Cursos e aptidão
            </span>
            <span className="text-muted-foreground">
              {QUALIFICATION_UPDATE_STATUS_LABEL[status]}
            </span>
          </div>
          {result && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Resumo:</p>
              <p>{result.workers} colaboradores atualizados</p>
              <p>{result.qualifications} cursos e vencimentos processados</p>
              <p>{result.options} opções de filtros atualizadas</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
