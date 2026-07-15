import process from "node:process";
import nodemailer from "nodemailer";

// Server-only SMTP helper. The .server.ts suffix keeps nodemailer and the
// SMTP credentials out of the client bundle. Credentials come from plain
// process.env (no VITE_ prefix — never expose SMTP secrets to the browser),
// loaded from .env by scripts/dev.mjs in local dev.
export async function sendEmail({ to, subject, text }: { to: string; subject: string; text: string }) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;

  if (!host || !port || !user || !pass) {
    throw new Error("Credenciais de e-mail (SMTP) não configuradas.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({ from, to, subject, text });
}
