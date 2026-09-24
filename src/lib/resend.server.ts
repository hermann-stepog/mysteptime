import { loadResendConfig } from "./emailSettings.server";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Monta o alerta em HTML no próprio app (o template antigo do Resend tinha um cabeçalho vazio
// e um rodapé com textos embolados que não dava para editar por aqui). Mesmas variáveis.
function renderAlert(v: Record<string, string>) {
  const g = (k: string) => esc(v[k] ?? "—");
  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:6px 0;color:#6b7280;width:130px;font-size:14px">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px;${bold ? "font-weight:700" : ""}">${value}</td></tr>`;
  const positivo = /^Equipe Formada/i.test(v.TITULO_ALERTA ?? "");
  const cor = positivo ? "#16a34a" : "#f59e0b";
  const icone = positivo ? "✅" : "⚠️";
  const cabecalho = positivo ? "Equipe Formada — My Step Time" : "Alerta de Nomeação — My Step Time";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:20px 28px;border-bottom:3px solid ${cor}">
<span style="font-size:18px;vertical-align:middle">${icone}</span>
<span style="font-size:16px;font-weight:700;color:#111827;vertical-align:middle;margin-left:6px">${cabecalho}</span>
</td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 18px;font-size:15px;color:#111827">Segue um alerta referente a: <strong>${g("TITULO_ALERTA")}</strong>.</p>
<table width="100%" cellpadding="0" cellspacing="0">
${row("Colaborador", g("COLABORADOR_NOME"), true)}
${row("Função", g("NOMINATION_FUNCAO"))}
${row("Unidade", g("NOMINATION_UNIDADE"))}
${row("BSP", g("NOMINATION_BSP"))}
</table>
<div style="margin-top:18px;padding:14px 16px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb">
<div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;margin-bottom:6px">${g("DETALHES_LABEL")}</div>
<div style="font-size:14px;color:#111827">${g("PENDENCIAS")}</div>
</div>
</td></tr>
<tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;font-size:12px;color:#9ca3af">${g("RODAPE_TEXTO")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Segue um alerta referente a: ${v.TITULO_ALERTA ?? "—"}.`,
    "",
    `Colaborador: ${v.COLABORADOR_NOME ?? "—"}`,
    `Função: ${v.NOMINATION_FUNCAO ?? "—"}`,
    `Unidade: ${v.NOMINATION_UNIDADE ?? "—"}`,
    `BSP: ${v.NOMINATION_BSP ?? "—"}`,
    `${v.DETALHES_LABEL ?? "Detalhes"}: ${v.PENDENCIAS ?? "—"}`,
    "",
    v.RODAPE_TEXTO ?? "",
  ].join("\n");
  const subject = `[Nomeações] ${v.TITULO_ALERTA ?? "Alerta"} — ${v.COLABORADOR_NOME ?? ""}`.trim();
  return { html, text, subject };
}

// Server-only Resend helper. Usa a configuração salva em Configurações (chave cifrada no
// banco); se não houver, cai em API_RESEND/RESEND_FROM das variáveis de ambiente.
// templateId continua no contrato por compatibilidade, mas o HTML é gerado aqui.
export async function sendResendTemplateEmail(
  { to, cc, variables }: {
    to: string;
    cc?: string[];
    templateId: string;
    variables: Record<string, string>;
  },
  supabase: any,
) {
  const cfg = await loadResendConfig(supabase);
  if (!cfg) throw new Error("Avisos por e-mail não configurados/ativados em Configurações.");
  const { html, text, subject } = renderAlert(variables);

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
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend recusou o envio (${response.status}): ${body || "sem detalhes"}`);
  }
}

export { renderAlert as renderNominationAlert };
