// Stable per-creation key: retries must not create another notification.
export function nominationCreationEmailKey(nominationId: string): string {
  return `nomination/${nominationId}/solicitacao`;
}

export type EmailSendResult =
  | { sent: true; id: string }
  | { sent: false; id: null; reason: "paused" };

export async function acceptedEmailResult(response: Response): Promise<EmailSendResult> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Envio de e-mail recusado (${response.status}): ${body || "sem detalhes"}`);
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !body.id) {
    throw new Error("O envio não retornou um identificador; entrega não confirmada. Não reenviar automaticamente.");
  }
  return { sent: true, id: body.id };
}