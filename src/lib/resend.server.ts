import { loadResendConfig } from "./emailSettings.server";

// Server-only Resend helper. Usa a configuração salva em Configurações (chave cifrada no
// banco); se não houver, cai em API_RESEND/RESEND_FROM das variáveis de ambiente.
export async function sendResendTemplateEmail(
  { to, cc, templateId, variables }: {
    to: string;
    cc?: string[];
    templateId: string;
    variables: Record<string, string>;
  },
  supabase: any,
) {
  const cfg = await loadResendConfig(supabase);
  if (!cfg) throw new Error("Avisos por e-mail não configurados/ativados em Configurações.");
  if (!templateId) throw new Error("Template do Resend não configurado.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.from,
      to,
      ...(cc && cc.length > 0 ? { cc } : {}),
      template: { id: templateId, variables },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend recusou o envio (${response.status}): ${body || "sem detalhes"}`);
  }
}
