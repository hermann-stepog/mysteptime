import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, Download, Eye, Radio, Route as RouteIcon, Users } from "lucide-react";
import { supabase as typed } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { AppLoader } from "@/components/AppLoader";
import { KpiValue } from "@/components/KpiValue";
import { ACAO_LABELS, trackFlowEvent } from "@/lib/flowTrack";
import { pageTitle } from "@/lib/pageTitle";

const supabase: any = typed;

export const Route = createFileRoute("/admin/flow-track")({
  head: () => pageTitle("Flow Track"),
  component: FlowTrackPage,
});

interface Ev {
  id: string; created_at: string; user_id: string; user_name: string | null; user_role: string | null;
  session_id: string | null; modulo: string | null; tela: string | null; acao: string; detalhe: string | null;
  registro: string | null; duracao_ms: number | null; dispositivo: string | null;
}
interface Presence {
  user_id: string; user_name: string | null; user_role: string | null; tela: string | null; modulo: string | null;
  ultima_acao: string | null; ultima_acao_em: string | null; sessao_inicio: string; last_seen: string; dispositivo: string | null;
}

const ONLINE_MS = 2 * 60 * 1000;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const fmtDT = (s: string) => new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
};
const spHour = (s: string) => Number(new Date(s).toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false })) % 24;
const spDay = (s: string) => new Date(new Date(s).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getDay();
const spDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const acaoTone = (a: string) => a === "exclusao" || a === "acesso_negado" ? "destructive" : a === "criacao" || a === "login" ? "success" : a === "alteracao_status" || a === "edicao" ? "warning" : "muted";

function FlowTrackPage() {
  const { role, loading, user, profile } = useAuth();
  if (loading) return <AppLoader />;
  if (role !== "administrador") {
    if (user) trackFlowEvent({ id: user.id, name: profile?.full_name ?? null, role }, "acesso_negado", { detalhe: "Tentou abrir o Flow Track" });
    return <Navigate to="/" />;
  }
  return <FlowTrackContent />;
}

function FlowTrackContent() {
  const qc = useQueryClient();
  const hoje = spDate(new Date());
  const [de, setDe] = useState(spDate(new Date(Date.now() - 6 * 86400000)));
  const [ate, setAte] = useState(hoje);
  const [fUser, setFUser] = useState("all");
  const [fRole, setFRole] = useState("all");
  const [fMod, setFMod] = useState("all");
  const [fAcao, setFAcao] = useState("all");
  const [busca, setBusca] = useState("");
  const [now, setNow] = useState(Date.now());

  const { data: events = [], isLoading } = useQuery<Ev[]>({
    queryKey: ["flow-track-events", de, ate],
    queryFn: async () => {
      const out: Ev[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("flow_track_events").select("*")
          .gte("created_at", `${de}T00:00:00-03:00`).lte("created_at", `${ate}T23:59:59.999-03:00`)
          .order("created_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < 1000 || out.length >= 20000) break;
      }
      return out;
    },
  });
  const { data: presence = [] } = useQuery<Presence[]>({
    queryKey: ["flow-track-presence"],
    queryFn: async () => (await supabase.from("flow_track_presence").select("*").order("last_seen", { ascending: false })).data ?? [],
  });

  // Atualização automática sem recarregar a página.
  useEffect(() => {
    const ch = supabase.channel("flow-track-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "flow_track_presence" }, () => qc.invalidateQueries({ queryKey: ["flow-track-presence"] }))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "flow_track_events" }, () => qc.invalidateQueries({ queryKey: ["flow-track-events"] }))
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [qc]);

  const users = useMemo(() => Array.from(new Map(events.map((e) => [e.user_id, e.user_name ?? e.user_id])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR")), [events]);
  const roles = useMemo(() => Array.from(new Set(events.map((e) => e.user_role).filter(Boolean) as string[])).sort(), [events]);
  const mods = useMemo(() => Array.from(new Set(events.map((e) => e.modulo).filter(Boolean) as string[])).sort(), [events]);
  const acoes = useMemo(() => Array.from(new Set(events.map((e) => e.acao))).sort(), [events]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return events.filter((e) =>
      (fUser === "all" || e.user_id === fUser) && (fRole === "all" || e.user_role === fRole) &&
      (fMod === "all" || e.modulo === fMod) && (fAcao === "all" || e.acao === fAcao) &&
      (!q || [e.user_name, e.modulo, e.tela, e.detalhe, e.registro, ACAO_LABELS[e.acao] ?? e.acao].some((v) => v?.toLowerCase().includes(q))));
  }, [events, fUser, fRole, fMod, fAcao, busca]);

  const online = presence.filter((p) => now - new Date(p.last_seen).getTime() < ONLINE_MS);
  const hojeEvents = events.filter((e) => spDate(new Date(e.created_at)) === hoje);

  // Tempo de uso: soma do tempo gasto em cada tela, por usuário.
  const tempoPorUsuario = useMemo(() => {
    const m = new Map<string, { nome: string; ms: number; eventos: number; tarefas: number }>();
    filtered.forEach((e) => {
      const r = m.get(e.user_id) ?? { nome: e.user_name ?? "—", ms: 0, eventos: 0, tarefas: 0 };
      r.ms += e.duracao_ms ?? 0; r.eventos++;
      if (["criacao", "edicao", "alteracao_status", "aprovacao", "exclusao"].includes(e.acao)) r.tarefas++;
      m.set(e.user_id, r);
    });
    return Array.from(m.values()).sort((a, b) => b.eventos - a.eventos);
  }, [filtered]);
  const tempoMedio = tempoPorUsuario.length ? tempoPorUsuario.reduce((s, r) => s + r.ms, 0) / tempoPorUsuario.length : 0;

  const count = (key: (e: Ev) => string | null) => {
    const m = new Map<string, number>();
    filtered.forEach((e) => { const k = key(e); if (k) m.set(k, (m.get(k) ?? 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const porModulo = count((e) => (e.acao === "abertura_tela" ? e.modulo : null));
  const porModuloTodas = count((e) => e.modulo);
  const porAcao = count((e) => ACAO_LABELS[e.acao] ?? e.acao);

  const tempoPorModulo = useMemo(() => {
    const m = new Map<string, { ms: number; n: number }>();
    // duracao_ms fica no evento da tela SEGUINTE, referindo-se à tela anterior (detalhe "Veio de X").
    filtered.forEach((e) => {
      if (e.acao !== "abertura_tela" || !e.duracao_ms || !e.detalhe) return;
      const mod = e.detalhe.replace(/^Veio de /, "").replace(/ \(\d+s\)$/, "");
      const r = m.get(mod) ?? { ms: 0, n: 0 }; r.ms += e.duracao_ms; r.n++; m.set(mod, r);
    });
    return Array.from(m.entries()).map(([k, v]) => ({ k, media: v.ms / v.n, n: v.n })).sort((a, b) => b.media - a.media);
  }, [filtered]);

  const heat = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    filtered.forEach((e) => { g[spDay(e.created_at)][spHour(e.created_at)]++; });
    return g;
  }, [filtered]);
  const heatMax = Math.max(1, ...heat.flat());

  const porDia = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((e) => { const d = spDate(new Date(e.created_at)); m.set(d, (m.get(d) ?? 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Alertas de auditoria
  const alertas = useMemo(() => {
    const a: { tone: "destructive" | "warning"; texto: string; quando: string }[] = [];
    filtered.filter((e) => e.acao === "acesso_negado").forEach((e) => a.push({ tone: "destructive", texto: `${e.user_name ?? "Usuário"} tentou acessar área sem permissão (${e.detalhe ?? e.tela})`, quando: e.created_at }));
    filtered.filter((e) => e.acao === "exclusao").forEach((e) => a.push({ tone: "destructive", texto: `${e.user_name ?? "Usuário"} excluiu um registro em ${e.modulo}`, quando: e.created_at }));
    filtered.filter((e) => { const h = spHour(e.created_at); const d = spDay(e.created_at); return e.acao === "login" && (h < 6 || h >= 20 || d === 0 || d === 6); })
      .forEach((e) => a.push({ tone: "warning", texto: `${e.user_name ?? "Usuário"} acessou fora do horário padrão`, quando: e.created_at }));
    const porHora = new Map<string, { n: number; nome: string; at: string }>();
    filtered.filter((e) => ["edicao", "criacao", "exclusao", "alteracao_status"].includes(e.acao)).forEach((e) => {
      const k = `${e.user_id}|${e.created_at.slice(0, 13)}`;
      const r = porHora.get(k) ?? { n: 0, nome: e.user_name ?? "Usuário", at: e.created_at }; r.n++; porHora.set(k, r);
    });
    porHora.forEach((r) => { if (r.n >= 50) a.push({ tone: "warning", texto: `${r.nome} fez ${r.n} alterações em uma hora`, quando: r.at }); });
    online.forEach((p) => {
      const idle = now - new Date(p.ultima_acao_em ?? p.last_seen).getTime();
      if (idle > 30 * 60000) a.push({ tone: "warning", texto: `${p.user_name ?? "Usuário"} está inativo há ${fmtDur(idle)}`, quando: p.last_seen });
    });
    return a.sort((x, y) => y.quando.localeCompare(x.quando));
  }, [filtered, online, now]);

  // Produtividade
  const tarefas = filtered.filter((e) => ["criacao", "edicao", "alteracao_status", "aprovacao"].includes(e.acao)).length;
  const tempoProdutivo = filtered.reduce((s, e) => s + (e.duracao_ms && e.duracao_ms < 30 * 60000 ? e.duracao_ms : 0), 0);
  const tempoOcioso = filtered.reduce((s, e) => s + (e.duracao_ms && e.duracao_ms >= 30 * 60000 ? e.duracao_ms : 0), 0);
  const eficiencia = tempoProdutivo + tempoOcioso > 0 ? Math.round((tempoProdutivo / (tempoProdutivo + tempoOcioso)) * 100) : 0;
  const sessoes = new Set(filtered.map((e) => e.session_id).filter(Boolean));
  const sessoesComTarefa = new Set(filtered.filter((e) => ["criacao", "edicao", "alteracao_status", "aprovacao"].includes(e.acao)).map((e) => e.session_id));
  const sessoesAbandonadas = Array.from(sessoes).filter((s) => !sessoesComTarefa.has(s)).length;

  // Timeline / mapa de navegação do usuário escolhido
  const timelineUser = fUser !== "all" ? fUser : tempoPorUsuario.length ? filtered.find((e) => e.user_name === tempoPorUsuario[0].nome)?.user_id ?? null : null;
  const timeline = useMemo(() => filtered.filter((e) => e.user_id === timelineUser).slice(0, 300).reverse(), [filtered, timelineUser]);
  const caminho = useMemo(() => {
    const out: { label: string; at: string }[] = [];
    timeline.forEach((e) => {
      const label = e.acao === "abertura_tela" ? e.modulo ?? e.tela ?? "Tela" : ACAO_LABELS[e.acao] ?? e.acao;
      if (out[out.length - 1]?.label !== label) out.push({ label, at: e.created_at });
    });
    return out.slice(-40);
  }, [timeline]);
  const fluxos = useMemo(() => {
    const m = new Map<string, number>();
    const bySession = new Map<string, Ev[]>();
    filtered.filter((e) => e.acao === "abertura_tela" && e.session_id).forEach((e) => { const l = bySession.get(e.session_id!) ?? []; l.push(e); bySession.set(e.session_id!, l); });
    bySession.forEach((l) => {
      l.sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (let i = 1; i < l.length; i++) if (l[i - 1].modulo !== l[i].modulo) { const k = `${l[i - 1].modulo} → ${l[i].modulo}`; m.set(k, (m.get(k) ?? 0) + 1); }
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filtered]);

  const exportCsv = () => {
    const head = ["Data/hora", "Usuário", "Perfil", "Módulo", "Tela", "Ação", "Detalhe", "Registro", "Tempo (s)", "Dispositivo"];
    const rows = filtered.map((e) => [fmtDT(e.created_at), e.user_name, e.user_role, e.modulo, e.tela, ACAO_LABELS[e.acao] ?? e.acao, e.detalhe, e.registro, e.duracao_ms ? Math.round(e.duracao_ms / 1000) : "", e.dispositivo]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `flow-track_${de}_${ate}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (isLoading) return <AppLoader />;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Activity className="h-6 w-6 text-primary" />Flow Track</h1>
          <p className="text-sm text-muted-foreground">Monitoramento e auditoria das atividades dos usuários — visível só para Administrador.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" />Exportar CSV</Button>
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-7">
        <div><label className="text-xs text-muted-foreground">De</label><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><label className="text-xs text-muted-foreground">Até</label><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <FilterSelect label="Usuário" value={fUser} onChange={setFUser} options={users.map(([id, n]) => [id, String(n)])} />
        <FilterSelect label="Perfil" value={fRole} onChange={setFRole} options={roles.map((r) => [r, r])} />
        <FilterSelect label="Módulo" value={fMod} onChange={setFMod} options={mods.map((m) => [m, m])} />
        <FilterSelect label="Ação" value={fAcao} onChange={setFAcao} options={acoes.map((a) => [a, ACAO_LABELS[a] ?? a])} />
        <div><label className="text-xs text-muted-foreground">Busca rápida</label><Input placeholder="Nome, tela, registro..." value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Radio} label="Usuários online" value={online.length} />
        <Kpi icon={Activity} label="Atividades hoje" value={hojeEvents.length} />
        <Kpi icon={Clock} label="Tempo médio por usuário" text={fmtDur(tempoMedio)} />
        <Kpi icon={AlertTriangle} label="Alertas no período" value={alertas.length} />
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="live">Ao vivo</TabsTrigger>
          <TabsTrigger value="timeline">Timeline e navegação</TabsTrigger>
          <TabsTrigger value="eventos">Registro de passos</TabsTrigger>
          <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
          <TabsTrigger value="alertas">Alertas {alertas.length > 0 && `(${alertas.length})`}</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4"><h3 className="mb-3 font-semibold">Atividades por dia</h3><VBars data={porDia.map(([d, n]) => [d.slice(8, 10) + "/" + d.slice(5, 7), n])} /></Card>
            <Card className="p-4"><h3 className="mb-3 font-semibold">Módulos mais acessados</h3><HBars data={porModulo.slice(0, 8)} /></Card>
            <Card className="p-4"><h3 className="mb-3 font-semibold">Tipos de ação</h3><Donut data={porAcao} /></Card>
            <Card className="p-4">
              <h3 className="mb-3 font-semibold">Últimas atividades</h3>
              <ul className="max-h-72 space-y-2 overflow-auto text-sm">
                {filtered.slice(0, 15).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-0">
                    <span className="truncate"><b>{e.user_name ?? "—"}</b> · {ACAO_LABELS[e.acao] ?? e.acao} · <span className="text-muted-foreground">{e.modulo}</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDT(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="live">
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Perfil</TableHead><TableHead>Situação</TableHead><TableHead>Tela atual</TableHead><TableHead>Última ação</TableHead><TableHead>Inatividade</TableHead><TableHead>Duração da sessão</TableHead><TableHead>Dispositivo</TableHead></TableRow></TableHeader>
              <TableBody>
                {presence.map((p) => {
                  const on = now - new Date(p.last_seen).getTime() < ONLINE_MS;
                  return (
                    <TableRow key={p.user_id}>
                      <TableCell className="font-medium">{p.user_name ?? "—"}</TableCell>
                      <TableCell>{p.user_role}</TableCell>
                      <TableCell><StatusBadge tone={on ? "success" : "muted"}>{on ? "Online" : "Offline"}</StatusBadge></TableCell>
                      <TableCell>{on ? p.modulo ?? p.tela : "—"}</TableCell>
                      <TableCell>{p.ultima_acao ?? "—"}{p.ultima_acao_em && <span className="block text-xs text-muted-foreground">{fmtDT(p.ultima_acao_em)}</span>}</TableCell>
                      <TableCell>{on ? fmtDur(now - new Date(p.ultima_acao_em ?? p.last_seen).getTime()) : "—"}</TableCell>
                      <TableCell>{on ? fmtDur(now - new Date(p.sessao_inicio).getTime()) : `Visto ${fmtDT(p.last_seen)}`}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.dispositivo}</TableCell>
                    </TableRow>
                  );
                })}
                {presence.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Ninguém registrado ainda.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {fUser === "all" ? "Mostrando o usuário mais ativo do período — escolha outro no filtro Usuário." : "Usuário escolhido no filtro."}
          </p>
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><RouteIcon className="h-4 w-4" />Mapa de navegação</h3>
            {caminho.length === 0 ? <p className="text-sm text-muted-foreground">Sem navegação no período.</p> : (
              <div className="flex flex-wrap items-center gap-2">
                {caminho.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="rounded-lg border bg-primary/5 px-3 py-1.5 text-sm" title={fmtDT(c.at)}>{c.label}</span>
                    {i < caminho.length - 1 && <span className="text-muted-foreground">→</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 font-semibold">Timeline de atividades</h3>
            <ol className="relative max-h-[520px] overflow-auto border-l pl-6">
              {timeline.slice().reverse().map((e) => (
                <li key={e.id} className="mb-4">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge tone={acaoTone(e.acao)}>{ACAO_LABELS[e.acao] ?? e.acao}</StatusBadge>
                    <span className="font-medium">{e.modulo}</span>
                    <span className="text-xs text-muted-foreground">{fmtDT(e.created_at)}</span>
                  </div>
                  {(e.detalhe || e.registro) && <p className="mt-0.5 text-xs text-muted-foreground">{e.detalhe}{e.registro ? ` · registro ${e.registro.slice(0, 8)}` : ""}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </TabsContent>

        <TabsContent value="eventos">
          <Card className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Data/hora</TableHead><TableHead>Usuário</TableHead><TableHead>Perfil</TableHead><TableHead>Módulo</TableHead><TableHead>Tela</TableHead><TableHead>Ação</TableHead><TableHead>Detalhe</TableHead><TableHead>Registro</TableHead><TableHead>Tempo</TableHead><TableHead>Dispositivo</TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.slice(0, 1000).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDT(e.created_at)}</TableCell>
                    <TableCell>{e.user_name}</TableCell>
                    <TableCell className="text-xs">{e.user_role}</TableCell>
                    <TableCell>{e.modulo}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.tela}</TableCell>
                    <TableCell><StatusBadge tone={acaoTone(e.acao)}>{ACAO_LABELS[e.acao] ?? e.acao}</StatusBadge></TableCell>
                    <TableCell className="text-xs">{e.detalhe}</TableCell>
                    <TableCell className="font-mono text-[10px]">{e.registro?.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{e.duracao_ms ? fmtDur(e.duracao_ms) : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.dispositivo}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Nenhuma atividade com esses filtros.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
          {filtered.length > 1000 && <p className="mt-2 text-xs text-muted-foreground">Mostrando as 1.000 mais recentes de {filtered.length}. Use Exportar CSV para ver todas.</p>}
        </TabsContent>

        <TabsContent value="relatorios" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Clock} label="Tempo produtivo" text={fmtDur(tempoProdutivo)} />
            <Kpi icon={Clock} label="Tempo ocioso (telas paradas > 30 min)" text={fmtDur(tempoOcioso)} />
            <Kpi icon={Activity} label="Tarefas concluídas" value={tarefas} />
            <Kpi icon={Eye} label="Eficiência operacional" value={eficiencia} suffix="%" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><Users className="h-4 w-4" />Usuários mais ativos</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead className="text-right">Atividades</TableHead><TableHead className="text-right">Tarefas</TableHead><TableHead className="text-right">Tempo de uso</TableHead></TableRow></TableHeader>
                <TableBody>{tempoPorUsuario.slice(0, 15).map((r) => (
                  <TableRow key={r.nome}><TableCell>{r.nome}</TableCell><TableCell className="text-right">{r.eventos}</TableCell><TableCell className="text-right">{r.tarefas}</TableCell><TableCell className="text-right">{fmtDur(r.ms)}</TableCell></TableRow>
                ))}</TableBody>
              </Table>
            </Card>
            <Card className="p-4"><h3 className="mb-3 font-semibold">Atividades por módulo</h3><HBars data={porModuloTodas.slice(0, 12)} /></Card>
            <Card className="p-4">
              <h3 className="mb-3 font-semibold">Tempo médio em cada módulo (possíveis gargalos)</h3>
              <ul className="space-y-1.5 text-sm">{tempoPorModulo.slice(0, 10).map((r) => (
                <li key={r.k} className="flex justify-between border-b pb-1 last:border-0"><span>{r.k}</span><span className="text-muted-foreground">{fmtDur(r.media)} · {r.n} visitas</span></li>
              ))}</ul>
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 font-semibold">Fluxos mais utilizados</h3>
              <ul className="space-y-1.5 text-sm">{fluxos.map(([k, n]) => (
                <li key={k} className="flex justify-between border-b pb-1 last:border-0"><span>{k}</span><span className="text-muted-foreground">{n}×</span></li>
              ))}</ul>
              <p className="mt-3 text-xs text-muted-foreground">Sessões sem nenhuma tarefa concluída (processos abandonados): <b>{sessoesAbandonadas}</b> de {sessoes.size}.</p>
            </Card>
          </div>
          <Card className="overflow-auto p-4">
            <h3 className="mb-3 font-semibold">Horários de maior utilização</h3>
            <table className="text-[10px]">
              <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="w-6 font-normal text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>{heat.map((row, d) => (
                <tr key={d}><td className="pr-2 text-muted-foreground">{WEEKDAYS[d]}</td>{row.map((v, h) => (
                  <td key={h} className="p-0.5"><div className="h-5 w-5 rounded-sm bg-primary" style={{ opacity: v ? 0.15 + (v / heatMax) * 0.85 : 0.05 }} title={`${WEEKDAYS[d]} ${h}h: ${v}`} /></td>
                ))}</tr>
              ))}</tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="alertas">
          <Card className="divide-y">
            {alertas.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nenhum alerta no período.</p>}
            {alertas.slice(0, 200).map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="flex items-center gap-2"><AlertTriangle className={a.tone === "destructive" ? "h-4 w-4 text-destructive" : "h-4 w-4 text-warning"} />{a.texto}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDT(a.quando)}</span>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Todos</SelectItem>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, text, suffix }: { icon: typeof Activity; label: string; value?: number; text?: string; suffix?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</div>
      <div className="mt-1 text-2xl font-semibold">{text ?? <KpiValue value={value ?? 0} suffix={suffix} />}</div>
    </Card>
  );
}

function HBars({ data }: { data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  if (!data.length) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <ul className="space-y-2">{data.map(([k, v]) => (
      <li key={k} className="text-sm">
        <div className="flex justify-between"><span className="truncate">{k}</span><span className="text-muted-foreground">{v}</span></div>
        <div className="mt-0.5 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary transition-all" style={{ width: `${(v / max) * 100}%` }} /></div>
      </li>
    ))}</ul>
  );
}

function VBars({ data }: { data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  if (!data.length) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <div className="flex h-48 items-end gap-1">
      {data.map(([k, v]) => (
        <div key={k} className="flex flex-1 flex-col items-center gap-1" title={`${k}: ${v}`}>
          <span className="text-[10px] text-muted-foreground">{v}</span>
          <div className="w-full rounded-t bg-primary transition-all" style={{ height: `${(v / max) * 150}px` }} />
          <span className="text-[10px] text-muted-foreground">{k}</span>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLORS = ["var(--primary)", "var(--success)", "var(--warning)", "var(--destructive)", "var(--muted-foreground)", "var(--accent-foreground)"];
function Donut({ data }: { data: [string, number][] }) {
  const total = data.reduce((s, d) => s + d[1], 0);
  if (!total) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  let acc = 0;
  const stops = data.map(([, v], i) => { const a = acc; acc += (v / total) * 360; return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${a}deg ${acc}deg`; }).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-40 w-40 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
        <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-card"><span className="text-2xl font-semibold">{total}</span><span className="text-xs text-muted-foreground">ações</span></div>
      </div>
      <ul className="space-y-1 text-sm">{data.map(([k, v], i) => (
        <li key={k} className="flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />{k} <span className="text-muted-foreground">({v})</span></li>
      ))}</ul>
    </div>
  );
}
