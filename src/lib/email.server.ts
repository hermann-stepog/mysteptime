import process from "node:process";
import { Resend } from "resend";

// Server-only Resend helper. The .server.ts suffix keeps a chave da API fora do bundle do
// cliente. Vem de process.env (sem prefixo VITE_ — nunca exposta ao navegador), carregada do
// .env por scripts/dev.mjs em dev local; em produção, configurada nas env vars do deploy.
export async function sendEmail(
  { to, cc, subject, text }: { to: string; cc?: string; subject: string; text: string },
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Logística STEP <notificacoes@step-og.com>";

  if (!apiKey) {
    throw new Error("Credencial de e-mail (RESEND_API_KEY) não configurada.");
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from, to, cc: cc ? [cc] : undefined, subject, text,
  });
  if (error) throw new Error(error.message);
}
