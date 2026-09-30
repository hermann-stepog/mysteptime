import { supabase as typed } from "@/integrations/supabase/client";
// Tabelas novas ainda não estão nos tipos gerados.
const supabase: any = typed;

// Flow Track: registro de atividades dos usuários (só o Administrador consegue ler).
// Tudo aqui é "best-effort": uma falha no registro nunca pode travar a ação real.

const SESSION_KEY = "flow-track-session";

export function flowSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function resetFlowSession() {
  if (typeof window !== "undefined") sessionStorage.removeItem(SESSION_KEY);
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${mobile ? "Celular" : "Computador"} · ${browser}${os ? ` · ${os}` : ""}`;
}

const MODULE_LABELS: Record<string, string> = {
  "histograma-novo": "Histograma Offshore",
  "timesheet-offshore": "Timesheet Offshore",
  nominations: "Nomeações",
  transport: "Transporte",
  hospedagem: "Hospedagem",
  "passagens-aereas": "Passagens Aéreas",
  reembolsos: "Reembolsos",
  collaborators: "Colaboradores",
  costs: "Custos",
  rates: "Rates",
  bm: "Boletim de Medição",
  approvals: "Aprovações",
  reports: "Relatórios",
  settings: "Configurações",
  "flow-track": "Flow Track",
  "planejamento-embarque-historico": "Histórico do Planejamento",
};

export function moduleFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "Início";
  if (parts[0] === "admin") return MODULE_LABELS[parts[1] ?? ""] ?? (parts[1] ?? "Admin");
  if (parts[0] === "rh-sms") return "RH / SMS";
  if (parts[0] === "pm") return "Solicitante";
  if (parts[0] === "app") return "Colaborador";
  if (parts[0] === "auth") return "Login";
  return parts[0];
}

export interface FlowUser { id: string; name: string | null; role: string | null }

export function trackFlowEvent(
  user: FlowUser | null,
  acao: string,
  extra: { modulo?: string; tela?: string; detalhe?: string; registro?: string; duracao_ms?: number } = {},
) {
  if (!user) return;
  const tela = extra.tela ?? (typeof window !== "undefined" ? window.location.pathname : undefined);
  supabase
    .from("flow_track_events")
    .insert({
      user_id: user.id,
      user_name: user.name,
      user_role: user.role,
      session_id: flowSessionId(),
      modulo: extra.modulo ?? (tela ? moduleFromPath(tela) : null),
      tela,
      acao,
      detalhe: extra.detalhe ?? null,
      registro: extra.registro ?? null,
      duracao_ms: extra.duracao_ms ?? null,
      dispositivo: deviceLabel(),
    })
    .then(({ error }: { error: unknown }) => { if (error) console.warn("flow track:", error); });
}

export function updatePresence(user: FlowUser, patch: Record<string, unknown>) {
  return supabase
    .from("flow_track_presence")
    .upsert({ user_id: user.id, user_name: user.name, user_role: user.role, session_id: flowSessionId(), dispositivo: deviceLabel(), last_seen: new Date().toISOString(), ...patch }, { onConflict: "user_id" })
    .then(({ error }: { error: unknown }) => { if (error) console.warn("flow track presence:", error); });
}

export const ACAO_LABELS: Record<string, string> = {
  login: "Login",
  logout: "Saída",
  abertura_tela: "Abriu tela",
  criacao: "Criação",
  edicao: "Edição",
  exclusao: "Exclusão",
  alteracao_status: "Mudança de status",
  exportacao: "Exportação",
  anexo: "Anexo",
  aprovacao: "Aprovação",
  acesso_negado: "Acesso negado",
};
