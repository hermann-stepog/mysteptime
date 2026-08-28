import { sendNominationPhaseEmail } from "@/lib/api/email.functions";
import { STATUS_FLUXO_LABEL, type PassagemAerea, type StatusFluxo } from "@/lib/passagensAereas";

function subjectFor(p: PassagemAerea, stage: StatusFluxo): string {
  const trecho = p.origem && p.destino ? ` (${p.origem} → ${p.destino})` : "";
  return `Passagem aérea — ${STATUS_FLUXO_LABEL[stage]}${trecho}`;
}

function bodyFor(p: PassagemAerea, stage: StatusFluxo, notes?: string): string {
  const lines = [
    `Etapa: ${STATUS_FLUXO_LABEL[stage]}`,
    `Colaborador: ${p.nome_usuario}`,
    `Unidade: ${p.unidade} · BSP: ${p.bsp}`,
    p.data_ida ? `Data de ida: ${p.data_ida.split("-").reverse().join("/")}` : null,
    notes ? `Observação: ${notes}` : null,
  ].filter((l): l is string => !!l);
  return lines.join("\n");
}

// Chamado a cada avanço de etapa — nunca lança: falha de e-mail vira aviso, não trava nem
// desfaz a troca de etapa (mesmo padrão de tolerância a falha de notifyStageAdvance, em
// nominationEmails.ts). Sem e-mail do solicitante cadastrado, simplesmente não manda nada —
// não é um requisito pra usar o fluxo.
export async function notifyPassagemStageAdvance(p: PassagemAerea, stage: StatusFluxo, notes?: string): Promise<void> {
  if (!p.solicitante_email) return;
  try {
    await sendNominationPhaseEmail({
      data: { to: p.solicitante_email, subject: subjectFor(p, stage), text: bodyFor(p, stage, notes) },
    });
  } catch (err) {
    console.warn("Falha ao enviar e-mail de passagem aérea (aviso, não bloqueia a atualização):", err);
  }
}
