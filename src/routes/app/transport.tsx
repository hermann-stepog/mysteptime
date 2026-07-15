import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, Clock, X } from "lucide-react";
import { notify } from "@/lib/notify";
import { fmtDateTime } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/app/transport")({ head: () => pageTitle("Transporte"), component: AppTransportPage });

// ── Tipos de transporte ───────────────────────────────────────────────────────

const TIPOS = [
  { id: "uber",         label: "Uber" },
  { id: "veiculo_step", label: "Veículo STEP" },
  { id: "locacao_carro",label: "Locação de Carro" },
  { id: "future",       label: "Future" },
] as const;

const TIPO_LABELS: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.id, t.label]));

// ── Types ─────────────────────────────────────────────────────────────────────

type Solicitacao = {
  id: string;
  created_at: string;
  solicitante: string;
  setor: string;
  centro_custo: string;
  data_hora: string;
  origem: string | null;
  destino: string | null;
  tipos_transporte: string[];
  status: string;
  notes: string | null;
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  if (status === "programado") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Programado
      </span>
    );
  }
  if (status === "cancelado") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <X className="h-3.5 w-3.5" /> Cancelado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
      <Clock className="h-3.5 w-3.5" /> Aguardando programação
    </span>
  );
}

// ── Solicitar tab ─────────────────────────────────────────────────────────────

function SolicitarTab({ solicitations }: { solicitations: Solicitacao[] }) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();

  const [solicitante, setSolicitante] = useState(profile?.full_name ?? "");
  const [setor, setSetor]             = useState("");
  const [centroCusto, setCentroCusto] = useState("");
  const [dataHora, setDataHora]       = useState("");
  const [origem, setOrigem]           = useState("");
  const [destino, setDestino]         = useState("");
  const [tipos, setTipos]             = useState<string[]>([]);
  const [notes, setNotes]             = useState("");

  const toggle = (id: string) =>
    setTipos((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const create = useMutation({
    mutationFn: async () => {
      if (!solicitante.trim() || !setor.trim() || !centroCusto.trim() || !dataHora)
        throw new Error("Preencha todos os campos obrigatórios.");
      if (tipos.length === 0)
        throw new Error("Selecione ao menos um tipo de transporte.");

      const { error } = await supabase.from("transport_solicitations").insert({
        user_id:          user!.id,
        solicitante:      solicitante.trim(),
        setor:            setor.trim(),
        centro_custo:     centroCusto.trim(),
        data_hora:        dataHora,
        origem:           origem.trim() || null,
        destino:          destino.trim() || null,
        tipos_transporte: tipos,
        notes:            notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Solicitação enviada com sucesso.");
      qc.invalidateQueries({ queryKey: ["app-solicitations", user?.id] });
      setSetor(""); setCentroCusto(""); setDataHora(""); setOrigem(""); setDestino(""); setTipos([]); setNotes("");
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao enviar solicitação."),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <h2 className="font-semibold text-sm">Nova Solicitação</h2>

        <div className="space-y-1">
          <Label className="text-xs">Solicitante *</Label>
          <Input
            placeholder="Seu nome"
            value={solicitante}
            onChange={(e) => setSolicitante(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Setor *</Label>
            <Input placeholder="Ex.: Operações" value={setor} onChange={(e) => setSetor(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Centro de Custo *</Label>
            <Input placeholder="Ex.: CC-001" value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Data / Hora de programação *</Label>
          <Input
            type="datetime-local"
            value={dataHora}
            onChange={(e) => setDataHora(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Origem</Label>
            <Input placeholder="Ex.: Macaé" value={origem} onChange={(e) => setOrigem(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Destino</Label>
            <Input placeholder="Ex.: Rio de Janeiro" value={destino} onChange={(e) => setDestino(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Tipo de transporte *</Label>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS.map(({ id, label }) => (
              <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border accent-primary cursor-pointer"
                  checked={tipos.includes(id)}
                  onChange={() => toggle(id)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Observações</Label>
          <Input placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Button
          className="w-full"
          onClick={() => create.mutate()}
          loading={create.isPending}
        >
          Enviar solicitação
        </Button>
      </Card>

      {/* Histórico */}
      {solicitations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Minhas solicitações</p>
          <div className="space-y-2">
            {solicitations.map((s) => (
              <Card key={s.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-medium">{s.setor} — {s.centro_custo}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(s.data_hora)}</p>
                    {(s.origem || s.destino) && (
                      <p className="text-xs text-muted-foreground">{s.origem || "—"} → {s.destino || "—"}</p>
                    )}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {(s.tipos_transporte ?? []).map((t) => (
                        <span key={t} className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-700">
                          {TIPO_LABELS[t] ?? t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <StatusChip status={s.status} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Programado tab ────────────────────────────────────────────────────────────

function ProgramadoTab({ solicitations }: { solicitations: Solicitacao[] }) {
  const programmed = solicitations.filter((s) => s.status === "programado");

  if (programmed.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState icon={Clock} title="Nenhuma solicitação programada ainda" description="A logística irá confirmar sua solicitação em breve." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {programmed.map((s) => (
        <Card key={s.id} className="p-4 border-l-4 border-l-green-500">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">{s.setor}</p>
              <StatusChip status={s.status} />
            </div>
            <p className="text-xs text-muted-foreground">CC: {s.centro_custo}</p>
            <p className="text-xs text-muted-foreground">{fmtDateTime(s.data_hora)}</p>
            {(s.origem || s.destino) && (
              <p className="text-xs text-muted-foreground">{s.origem || "—"} → {s.destino || "—"}</p>
            )}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {(s.tipos_transporte ?? []).map((t) => (
                <span key={t} className="text-[10px] rounded px-1.5 py-0.5 bg-green-100 text-green-800 font-medium">
                  {TIPO_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function AppTransportPage() {
  const { user } = useAuth();

  const { data: solicitations = [], isLoading } = useQuery<Solicitacao[]>({
    queryKey: ["app-solicitations", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_solicitations")
        .select("*")
        .eq("user_id", user!.id)
        .order("data_hora", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Transporte</h1>
        <p className="text-xs text-muted-foreground">Solicite e acompanhe seu transporte</p>
      </div>

      <Tabs defaultValue="solicitar">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="solicitar">Solicitar</TabsTrigger>
          <TabsTrigger value="programado">
            Programado
            {solicitations.filter((s) => s.status === "programado").length > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                {solicitations.filter((s) => s.status === "programado").length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="solicitar" className="mt-4">
          <SolicitarTab solicitations={solicitations} />
        </TabsContent>
        <TabsContent value="programado" className="mt-4">
          <ProgramadoTab solicitations={solicitations} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
