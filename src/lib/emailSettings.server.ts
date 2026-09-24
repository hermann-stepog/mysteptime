import process from "node:process";

// Chave do Resend fica cifrada (AES-GCM) no banco; só o servidor tem a chave de decifragem
// (segredo EMAIL_SETTINGS_ENCRYPTION_KEY). O navegador nunca recebe a chave em claro.
async function aesKey(): Promise<CryptoKey> {
  const secret = process.env.EMAIL_SETTINGS_ENCRYPTION_KEY;
  if (!secret) throw new Error("Chave de cifragem das configurações de e-mail não configurada.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const [iv, ct] = payload.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ct));
  return new TextDecoder().decode(pt);
}

export type ResendConfig = { apiKey: string; from: string };

// Config ativa salva na tela; se não houver, cai no que estiver nas variáveis de ambiente.
export async function loadResendConfig(supabase: any): Promise<ResendConfig | null> {
  try {
    const { data } = await supabase.rpc("get_email_send_config");
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.enabled && row.resend_api_key_encrypted && row.sender_email) {
      const apiKey = await decryptSecret(row.resend_api_key_encrypted);
      const from = row.sender_name ? `${row.sender_name} <${row.sender_email}>` : row.sender_email;
      return { apiKey, from };
    }
  } catch (err) {
    console.warn("Falha ao ler config de e-mail salva:", err);
  }
  const apiKey = process.env.API_RESEND;
  const from = process.env.RESEND_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

export type DomainCheck =
  | { status: "verified"; message: string }
  | { status: "restricted"; message: string }
  | { status: "failed"; message: string };

// Confere a chave e se o domínio está verificado no Resend.
export async function checkResendDomain(apiKey: string, domain: string): Promise<DomainCheck> {
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${apiKey}` } });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 401 && String(body?.name ?? "").includes("restricted")) {
    return { status: "restricted", message: "A chave é só de envio e não permite conferir o domínio. Envie um e-mail de teste para validar." };
  }
  if (!res.ok) return { status: "failed", message: `Chave recusada pelo Resend (${res.status}): ${body?.message ?? "sem detalhes"}` };
  const found = (body?.data ?? []).find((d: any) => String(d.name).toLowerCase() === domain.toLowerCase());
  if (!found) return { status: "failed", message: `O domínio ${domain} não existe nesta conta do Resend.` };
  if (found.status !== "verified") return { status: "failed", message: `O domínio ${domain} ainda não está verificado no Resend (situação: ${found.status}).` };
  return { status: "verified", message: `Domínio ${domain} verificado no Resend.` };
}

export async function sendResendHtml(cfg: ResendConfig, to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend recusou o envio (${res.status}): ${body || "sem detalhes"}`);
  }
}
