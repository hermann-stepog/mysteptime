import { supabase } from "@/integrations/supabase/client";
import { sendNominationPhaseEmail } from "@/lib/api/email.functions";
import { STATUS_LABELS, STAGE_ROLE, type Nomination, type NominationStatus } from "@/lib/nominations";

const supabaseAny: any = supabase;

// Resolve quem recebe o e-mail de uma etapa: `to` = usuários com o papel dono daquela etapa
// (aprovacao_tecnica/rh/sms — Aprovação PM não tem papel próprio, vai só pro PM; Solicitação/
// Recebido/Simulação/Nomeados/Equipe Formada não têm um papel de etapa dedicado, só a
// Logística acompanha). `cc` = todos os operadores (Logística de Pessoal, sempre em cópia) +
// o e-mail do PM sempre que a transição é um avanço da própria solicitação dele.
async function emailsForRole(role: string): Promise<string[]> {
  const { data: roles } = await supabaseAny.from("user_roles").select("user_id").eq("role", role);
  const ids = (roles ?? []).map((r: any) => r.user_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase.from("profiles").select("email").in("id", ids);
  return (profiles ?? []).map((p) => p.email).filter((e): e is string => !!e);
}

async function operatorEmails(): Promise<string[]> {
  return emailsForRole("logistics_operator");
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

function subjectFor(nomination: Nomination, stage: NominationStatus): string {
  const bspPart = nomination.bsp ? ` (${nomination.bsp})` : "";
  return `Nomeação — ${STATUS_LABELS[stage]} — ${nomination.funcao}${bspPart}`;
}

function bodyFor(nomination: Nomination, stage: NominationStatus): string {
  const lines = [
    `Etapa: ${STATUS_LABELS[stage]}`,
    `Função: ${nomination.funcao}`,
    nomination.unidade ? `Unidade: ${nomination.unidade}` : null,
    nomination.bsp ? `BSP: ${nomination.bsp}` : null,
    nomination.pm_name ? `Solicitante: ${nomination.pm_name}` : null,
    nomination.period_start && nomination.period_end
      ? `Período: ${nomination.period_start} a ${nomination.period_end}`
      : null,
  ].filter((l): l is string => !!l);
  return lines.join("\n");
}

// Chamado a cada avanço de etapa — nunca lança: falha de e-mail vira aviso, não trava nem
// desfaz a troca de etapa (mesma postura de tolerância a falha de recordDrakeSyncRun).
export async function notifyStageAdvance(nomination: Nomination, stage: NominationStatus): Promise<void> {
  try {
    const stageRole = STAGE_ROLE[stage];
    const [to, cc, pm] = await Promise.all([
      stageRole ? emailsForRole(stageRole) : Promise.resolve([]),
      operatorEmails(),
      pmEmail(nomination),
    ]);
    const ccAll = Array.from(new Set([...cc, ...(pm ? [pm] : [])]));
    const toFinal = to.length > 0 ? to : ccAll; // sem dono de etapa dedicado: manda só pra logística/PM
    if (toFinal.length === 0) return;

    await sendNominationPhaseEmail({
      data: {
        to: toFinal[0],
        cc: Array.from(new Set([...toFinal.slice(1), ...ccAll])).join(",") || undefined,
        subject: subjectFor(nomination, stage),
        text: bodyFor(nomination, stage),
      },
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de nomeação (aviso, não bloqueia a atualização):", err);
  }
}

// Diverge de notifyStageAdvance: sempre pro RH (não pro PM — é um bloqueio, não um avanço).
export async function notifyAptitudeDivergence(
  nomination: Nomination,
  colaboradorNome: string,
  divergenceText: string,
  resolved: boolean,
): Promise<void> {
  try {
    const [to, cc] = await Promise.all([emailsForRole("rh"), operatorEmails()]);
    const toFinal = to.length > 0 ? to : cc;
    if (toFinal.length === 0) return;
    await sendNominationPhaseEmail({
      data: {
        to: toFinal[0],
        cc: Array.from(new Set([...toFinal.slice(1), ...cc])).join(",") || undefined,
        subject: resolved
          ? `Nomeação — Divergência de aptidão corrigida — ${colaboradorNome}`
          : `Nomeação — Divergência de aptidão — ${colaboradorNome}`,
        text: resolved
          ? `A divergência de aptidão de ${colaboradorNome} foi corrigida no Drake e reenviada para nova validação do RH.\n\nFunção: ${nomination.funcao}`
          : `Divergência de aptidão encontrada para ${colaboradorNome}:\n\n${divergenceText}\n\nFunção: ${nomination.funcao}\n\nCorrija no Drake e clique em "Marcar como corrigido" para reenviar para validação.`,
      },
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de divergência de aptidão (aviso, não bloqueia):", err);
  }
}

// Diverge de notifyStageAdvance: assunto/corpo deixam claro que foi CANCELADA (não uma etapa
// concluída) — sem isso a mensagem genérica de "Equipe Formada" passava a falsa impressão de
// sucesso. Vai pro PM (é a solicitação dele) + cópia Logística.
export async function notifyCancellation(nomination: Nomination, reason: string | null): Promise<void> {
  try {
    const [cc, pm] = await Promise.all([operatorEmails(), pmEmail(nomination)]);
    const toFinal = pm ? [pm] : cc;
    if (toFinal.length === 0) return;
    const bspPart = nomination.bsp ? ` (${nomination.bsp})` : "";
    await sendNominationPhaseEmail({
      data: {
        to: toFinal[0],
        cc: Array.from(new Set([...toFinal.slice(1), ...cc])).join(",") || undefined,
        subject: `Nomeação — Cancelada — ${nomination.funcao}${bspPart}`,
        text: [
          `A solicitação foi CANCELADA.`,
          `Função: ${nomination.funcao}`,
          nomination.unidade ? `Unidade: ${nomination.unidade}` : null,
          nomination.bsp ? `BSP: ${nomination.bsp}` : null,
          reason ? `Motivo: ${reason}` : null,
        ].filter((l): l is string => !!l).join("\n"),
      },
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de cancelamento (aviso, não bloqueia):", err);
  }
}

// Diverge de notifyStageAdvance: é um bloqueio (a Qualidade reprovou), não um avanço — vai pro
// PM (precisa agir/decidir o próximo passo) + cópia Logística, igual notifyCancellation.
export async function notifyQualityRejection(nomination: Nomination, reason: string | null): Promise<void> {
  try {
    const [cc, pm] = await Promise.all([operatorEmails(), pmEmail(nomination)]);
    const toFinal = pm ? [pm] : cc;
    if (toFinal.length === 0) return;
    const bspPart = nomination.bsp ? ` (${nomination.bsp})` : "";
    await sendNominationPhaseEmail({
      data: {
        to: toFinal[0],
        cc: Array.from(new Set([...toFinal.slice(1), ...cc])).join(",") || undefined,
        subject: `Nomeação — Qualidade reprovou — ${nomination.funcao}${bspPart}`,
        text: [
          `A Qualidade REPROVOU esta solicitação em Aprovação Técnica.`,
          `Função: ${nomination.funcao}`,
          nomination.unidade ? `Unidade: ${nomination.unidade}` : null,
          nomination.bsp ? `BSP: ${nomination.bsp}` : null,
          nomination.weld_type ? `Tipo de solda: ${nomination.weld_type}` : null,
          reason ? `Motivo: ${reason}` : null,
        ].filter((l): l is string => !!l).join("\n"),
      },
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de reprovação de qualidade (aviso, não bloqueia):", err);
  }
}
