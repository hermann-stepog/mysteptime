import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM = `Você é um especialista em entrega de e-mails transacionais do app "My Step Time" (logística de pessoal, STEP).
Contexto: os avisos saem pelo Resend (remetente notificacoes@step-og.com). Tipos: boas-vindas de novos usuários (com senha provisória) e alertas de mudança de etapa em Nomeações (destinatário = responsável da etapa, cópia para Logística).
Causas comuns: chave do Resend inválida/sem permissão, domínio não verificado, remetente fora do domínio, destinatário digitado errado, e-mail no lixo eletrônico/quarentena, app publicado sem a versão atual, limite de envio (429), bloqueio do servidor do destinatário.
Responda em português simples, para uma pessoa não técnica, neste formato:
**Causa provável:** ...
**Como corrigir:** passos numerados curtos.
**Como confirmar:** uma frase.
Se faltar informação, diga o que a pessoa deve verificar ou copiar.`;

export const diagnoseEmailAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ details: z.string().trim().min(5).max(8000) }))
  .handler(async ({ data, context }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId).maybeSingle();
    if (roleRow?.role !== "logistics_operator") throw new Error("Sem permissão.");

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Serviço de IA não configurado.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: SYSTEM,
        input: data.details,
        stream: true,
        store: false,
        reasoning: { effort: "low" },
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Muitas análises em pouco tempo. Tente de novo em instantes.");
      if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos em Configurações > Planos.");
      throw new Error(`Falha na análise (${res.status}). ${body.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.startsWith("data:")) continue;
        const payload = l.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          if (ev.type === "error" || ev.type === "response.failed") throw new Error("A análise falhou. Tente novamente.");
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("A análise")) throw e;
        }
      }
    }
    return { answer: text.trim() || "Não foi possível gerar um diagnóstico. Inclua mais detalhes do erro." };
  });
