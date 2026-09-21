import process from "node:process";

// Server-only Resend helper. A chave nunca pode ter prefixo VITE_ (não pode
// chegar no bundle do navegador) — mesmo padrão do SMTP em email.server.ts.
// Usa fetch direto na API do Resend em vez de instalar o SDK, só pra mandar
// e-mails de Template (id + variáveis), que é tudo que a gente precisa aqui.
export async function sendResendTemplateEmail(
  { to, cc, templateId, variables }: {
    to: string;
    cc?: string[];
    templateId: string;
    variables: Record<string, string>;
  },
) {
  const apiKey = process.env.API_RESEND;
  const from = process.env.RESEND_FROM;
  if (!apiKey) throw new Error("Credencial do Resend (API_RESEND) não configurada.");
  if (!from) throw new Error("Remetente do Resend (RESEND_FROM) não configurado.");
  if (!templateId) throw new Error("Template do Resend não configurado.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
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
