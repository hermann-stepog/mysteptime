import { supabase } from "@/integrations/supabase/client";
import { sendResendTemplatedEmail } from "@/lib/api/email.functions";
import { STATUS_LABELS, isSoldador, type Nomination, type NominationStatus } from "@/lib/nominations";

const supabaseAny: any = supabase;

// "2026-09-27" → "27/09/2026" (string pura, sem fuso — evita virar o dia anterior).
function fmtBr(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// Nomes dos colaboradores nomeados (ativos); sem nomeados ainda → "A definir".
async function nomineeNames(nomination: Nomination): Promise<string> {
  try {
    const { data } = await supabaseAny
      .from("nomination_nominees")
      .select("colaborador_nome")
      .eq("nomination_id", nomination.id)
      .eq("is_active", true);
    const nomes = (data ?? []).map((r: any) => r.colaborador_nome).filter(Boolean);
    return nomes.length > 0 ? nomes.join(", ") : "A definir";
  } catch {
    return "A definir";
  }
}

// Template único e reaproveitável no Resend (ver src/components/nominations/
// QualificationEligibilityTab.tsx pro HTML original) — todos os alertas de nomeação usam o
// mesmo template, só variando TITULO_ALERTA/DETALHES_LABEL/PENDENCIAS/RODAPE_TEXTO por tipo de
// evento. Sem SMTP configurado (era só um placeholder no .env, nunca funcionou de verdade),
// o Resend passou a ser o único jeito real de mandar esses e-mails.
function alertTemplateId(): string | undefined {
  return import.meta.env.VITE_RESEND_ALERT_TEMPLATE_ID as string | undefined;
}

async function sendAlert(
  { to, cc, tituloAlerta, colaboradorNome, nomination, detalhesLabel, detalhes, rodapeTexto }: {
    to: string;
    cc: string[];
    tituloAlerta: string;
    colaboradorNome: string;
    nomination: Nomination;
    detalhesLabel: string;
    detalhes: string;
    rodapeTexto: string;
  },
): Promise<void> {
  const templateId = alertTemplateId();
  if (!templateId) {
    console.warn("VITE_RESEND_ALERT_TEMPLATE_ID não configurado — alerta não enviado:", tituloAlerta);
    return;
  }
  await sendResendTemplatedEmail({
    data: {
      to,
      cc,
      templateId,
      variables: {
        TITULO_ALERTA: tituloAlerta,
        COLABORADOR_NOME: colaboradorNome,
        NOMINATION_FUNCAO: nomination.funcao,
        NOMINATION_UNIDADE: nomination.unidade ?? "—",
        NOMINATION_BSP: nomination.bsp ?? "—",
        DETALHES_LABEL: detalhesLabel,
        PENDENCIAS: detalhes,
        RODAPE_TEXTO: rodapeTexto,
      },
    },
  });
}

// Resolve quem recebe o e-mail de uma etapa: `to` = usuários com o papel dono daquela etapa
// (aprovacao_tecnica/qualidade/rh/sms/solicitante_master — Aprovação PM/Nomeados/Equipe Formada
// não têm papel próprio, ninguém recebe "to" nessas, só o PM em cópia). `cc` = o e-mail do PM,
// sempre (é a solicitação dele).
async function emailsForRole(role: string): Promise<string[]> {
  const { data: roles } = await supabaseAny.from("user_roles").select("user_id").eq("role", role);
  const ids = (roles ?? []).map((r: any) => r.user_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase.from("profiles").select("email").in("id", ids);
  return (profiles ?? []).map((p) => p.email).filter((e): e is string => !!e);
}


async function pmEmail(nomination: Nomination): Promise<string | null> {
  if (nomination.pm_user_id) {
    const { data } = await supabase.from("profiles").select("email").eq("id", nomination.pm_user_id).maybeSingle();
    if (data?.email) return data.email;
  }
  if (nomination.pm_name) {
    const { data } = await supabaseAny.from("projects").select("email").eq("name", nomination.pm_name).maybeSingle();
    if (data?.email) return data.email;
  }
  return null;
}

// Paulo Nunes (Líder de Planejamento, papel "solicitante_master") só recebe alerta em 3
// situações, pedido dela: quando ele mesmo precisa agir (Simulação — já resolvido sozinho pelo
// STAGE_ROLE dele, não precisa de entrada fixa aqui), quando algo fica pendente (divergência/
// pendência de aptidão) ou quando algo é reprovado (Qualidade reprova). Fora essas 3, ele não
// entra em cópia de mais nada — Douglas (Operações) também não recebe mais nada fixo (saiu de
// "Equipe Formada", pedido dela).
const PAULO_EMAIL = "paulo.nunes@step-og.com";

const simNao = (v: boolean | null | undefined) => (v == null ? "não informado" : v ? "Sim" : "Não");

// Respostas de SMS (bloqueio de saúde / ASO em dia) e RH (documentação OK / embarque validado)
// por nomeado — entram no corpo do alerta sempre que já tiverem sido preenchidas.
async function stageAnswers(nomination: Nomination): Promise<string[]> {
  try {
    const { data } = await supabaseAny
      .from("nomination_nominees")
      .select("colaborador_nome, quality_apto_solda, sms_bloqueio_saude, sms_aso_em_dia, rh_documentacao_ok, rh_validated, aptidao_divergence, aptidao_divergence_text")
      .eq("nomination_id", nomination.id)
      .eq("is_active", true);
    const linhas: string[] = [];
    for (const n of data ?? []) {
      const partes: string[] = [];
      if (n.sms_bloqueio_saude != null || n.sms_aso_em_dia != null) {
        partes.push(`SMS: bloqueio de saúde ${simNao(n.sms_bloqueio_saude)}, ASO em dia ${simNao(n.sms_aso_em_dia)}`);
      }
      if (n.quality_apto_solda != null) partes.push(`Qualidade: ${n.quality_apto_solda ? "apto" : "NÃO apto"} para o tipo de solda`);
      if (n.rh_documentacao_ok != null || n.rh_validated) {
        partes.push(`RH: documentação OK ${simNao(n.rh_documentacao_ok)}, embarque ${n.rh_validated ? "validado" : "não validado"}`);
      }
      if (n.aptidao_divergence) partes.push(`Divergência de aptidão: ${n.aptidao_divergence_text ?? ""}`);
      if (partes.length > 0) linhas.push(`${n.colaborador_nome} — ${partes.join(" | ")}`);
    }
    return linhas;
  } catch {
    return [];
  }
}

// Chamado a cada avanço de etapa — nunca lança: falha de e-mail vira aviso, não trava nem
// desfaz a troca de etapa (mesma postura de tolerância a falha de recordDrakeSyncRun).
// Regra (pedido dela): cada papel só recebe "to" quando a etapa é a que ele mesmo precisa agir
// — Logística de Pessoal só na criação da solicitação ("solicitacao"), RH/SMS/Qualidade/
// Solicitante Master só na própria etapa (STAGE_ROLE). O PM (solicitante da nomeação) continua
// em cópia em toda etapa, é a solicitação dele. Nenhum papel entra "de brinde" em etapas que não
// são a dele.
// Quem recebe o alerta ao chegar em cada etapa (definido pela usuária):
// - recebido_logistica → Projetos ADM (solicitante_master)
// - validacao_sms_aso → SMS + o PM da solicitação (é o momento em que ele fica sabendo quem foi simulado)
// - validacao_rh → DP (papel "rh")
// - aprovacao_tecnica → Aprovação Técnica (produção)
// - validacao_qualidade → Qualidade, só quando a função tem "soldador"
// - aprovacao_pm → o PM da solicitação
// - briefing_sms → SMS
// - solicitacao → Logística de Pessoal (aviso de nova solicitação)
// Demais etapas não geram alerta. Quando a etapa trava (observacao informada), PM e Projetos ADM recebem.
const STAGE_RECIPIENT_ROLES: Partial<Record<NominationStatus, string[]>> = {
  solicitacao: ["logistics_operator"],
  recebido_logistica: ["solicitante_master"],
  validacao_sms_aso: ["sms"],
  validacao_rh: ["rh"],
  aprovacao_tecnica: ["aprovacao_tecnica"],
  validacao_qualidade: ["qualidade"],
  briefing_sms: ["sms"],
};
const STAGES_WITH_PM: NominationStatus[] = ["validacao_sms_aso", "aprovacao_pm"];
// Contas que nunca recebem alertas de Nomeações (pedido da usuária).
const NUNCA_RECEBEM = ["gabriel.sales@sttep-og.com", "fernando.v.junger@gmail.com"];

export async function notifyStageAdvance(nomination: Nomination, stage: NominationStatus, observacao?: string): Promise<void> {
  try {
    const travou = !!observacao;
    if (stage === "validacao_qualidade" && !isSoldador(nomination.funcao ?? "")) return;
    const roles = [...(STAGE_RECIPIENT_ROLES[stage] ?? []), ...(travou ? ["solicitante_master"] : [])];
    const incluiPm = travou || STAGES_WITH_PM.includes(stage);
    if (roles.length === 0 && !incluiPm) return;
    const [roleLists, pm, respostas] = await Promise.all([
      Promise.all(Array.from(new Set(roles)).map(emailsForRole)),
      incluiPm ? pmEmail(nomination) : Promise.resolve(null),
      stageAnswers(nomination),
    ]);
    const todos = Array.from(new Set([...roleLists.flat(), ...(pm ? [pm] : [])]))
      .filter((e) => !NUNCA_RECEBEM.includes(e.toLowerCase()));
    if (todos.length === 0) return;
    const toFinal = todos;
    const cc: string[] = [];
    const periodo = nomination.period_start && nomination.period_end
      ? `${fmtBr(nomination.period_start)} a ${fmtBr(nomination.period_end)}`
      : "—";
    await sendAlert({
      to: toFinal[0],
      cc: Array.from(new Set([...toFinal.slice(1), ...cc])).filter((e) => e !== toFinal[0]),
      tituloAlerta: `${STATUS_LABELS[stage]} — ${nomination.funcao}`,
      colaboradorNome: await nomineeNames(nomination),
      nomination,
      detalhesLabel: respostas.length > 0 ? "Período e validações" : "Período",
      detalhes: [...(observacao ? [observacao] : []), `Período: ${periodo}`, ...respostas].join(" • "),
      rodapeTexto: "Este é um alerta automático do My Step Time referente ao andamento de uma nomeação.",
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de nomeação (aviso, não bloqueia a atualização):", err);
  }
}

// Diverge de notifyStageAdvance: sempre pro RH (não pro PM — é um bloqueio, não um avanço).
// Paulo Nunes entra em cópia — é uma pendência, uma das 3 situações que ele acompanha.
export async function notifyAptitudeDivergence(
  nomination: Nomination,
  colaboradorNome: string,
  divergenceText: string,
  resolved: boolean,
): Promise<void> {
  try {
    const [to, pm] = await Promise.all([emailsForRole("rh"), pmEmail(nomination)]);
    const cc = [...(pm ? [pm] : []), PAULO_EMAIL];
    const toFinal = to.length > 0 ? to : cc;
    if (toFinal.length === 0) return;
    await sendAlert({
      to: toFinal[0],
      cc: Array.from(new Set([...toFinal.slice(1), ...cc])),
      tituloAlerta: resolved ? "Divergência de aptidão corrigida" : "Divergência de aptidão",
      colaboradorNome,
      nomination,
      detalhesLabel: resolved ? "Situação" : "Divergência encontrada",
      detalhes: resolved
        ? "Corrigida no Drake e reenviada para nova validação do RH."
        : divergenceText,
      rodapeTexto: resolved
        ? "Este é um alerta automático do My Step Time."
        : 'Corrija no Drake e clique em "Marcar como corrigido" para reenviar para validação.',
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de divergência de aptidão (aviso, não bloqueia):", err);
  }
}

// Diverge de notifyStageAdvance: assunto/corpo deixam claro que foi CANCELADA (não uma etapa
// concluída) — sem isso a mensagem genérica de "Equipe Formada" passava a falsa impressão de
// sucesso. Vai só pro PM (é a solicitação dele) — não é nenhuma das 3 situações de Paulo Nunes,
// nem a criação que Logística acompanha.
export async function notifyCancellation(nomination: Nomination, reason: string | null): Promise<void> {
  try {
    const pm = await pmEmail(nomination);
    const toFinal = pm ? [pm] : [];
    if (toFinal.length === 0) return;
    await sendAlert({
      to: toFinal[0],
      cc: [],
      tituloAlerta: "Solicitação cancelada",
      colaboradorNome: await nomineeNames(nomination),
      nomination,
      detalhesLabel: "Motivo",
      detalhes: reason ?? "Não informado",
      rodapeTexto: "Este é um alerta automático do My Step Time.",
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de cancelamento (aviso, não bloqueia):", err);
  }
}

// Diverge de notifyStageAdvance: é um bloqueio (a Qualidade reprovou), não um avanço — vai pro
// PM (precisa agir/decidir o próximo passo) + cópia Paulo Nunes (é uma reprovação, uma das 3
// situações que ele acompanha).
export async function notifyQualityRejection(nomination: Nomination, reason: string | null): Promise<void> {
  try {
    const pm = await pmEmail(nomination);
    const cc = [PAULO_EMAIL];
    const toFinal = pm ? [pm] : cc;
    if (toFinal.length === 0) return;
    await sendAlert({
      to: toFinal[0],
      cc: Array.from(new Set([...toFinal.slice(1), ...cc])),
      tituloAlerta: "Qualidade reprovou",
      colaboradorNome: await nomineeNames(nomination),
      nomination,
      detalhesLabel: "Motivo",
      detalhes: [reason, nomination.weld_type ? `Tipo de solda: ${nomination.weld_type}` : null]
        .filter((l): l is string => !!l).join(" — ") || "Não informado",
      rodapeTexto: "Este é um alerta automático do My Step Time.",
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de reprovação de qualidade (aviso, não bloqueia):", err);
  }
}

// Alerta de pendência de aptidão de um nomeado da solicitação EM CURSO (não é o cruzamento
// geral do Planejamento de Embarque com o Drake — ver PendenciasAptidaoTab, aquilo é só
// consulta na tela) — vai pro RH + o solicitante da nomeação. Quem chama é responsável por
// checar antes se esse aviso já foi mandado pra esse nomeado nessa nomeação (ver
// nomination_aptitude_alerts) — "automático, uma vez por nomeado", pedido dela.
export async function notifyAptitudePendency(
  nomination: Nomination,
  colaboradorNome: string,
  pendencias: string[],
): Promise<void> {
  try {
    const [rh, pm] = await Promise.all([emailsForRole("rh"), pmEmail(nomination)]);
    // É uma pendência — Paulo Nunes entra em cópia, uma das 3 situações que ele acompanha.
    const cc = [...rh, PAULO_EMAIL];
    const toFinal = pm ? [pm] : cc;
    if (toFinal.length === 0) return;
    await sendAlert({
      to: toFinal[0],
      cc: Array.from(new Set([...toFinal.slice(1), ...cc])),
      tituloAlerta: "Pendência de Aptidão",
      colaboradorNome,
      nomination,
      detalhesLabel: "Cursos vencidos / faltando",
      detalhes: pendencias.join(", "),
      rodapeTexto: "Verifique e regularize a documentação no Drake.",
    });
  } catch (err) {
    console.warn("Falha ao enviar alerta de pendência de aptidão (aviso, não bloqueia):", err);
  }
}
