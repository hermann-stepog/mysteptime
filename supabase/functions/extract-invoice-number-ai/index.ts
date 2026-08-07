import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY não configurada" }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const { ocrText } = await req.json();

    if (typeof ocrText !== "string" || !ocrText.trim()) {
      return new Response(
        JSON.stringify({ error: "Texto OCR não informado" }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const text = ocrText.slice(0, 30000);

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          temperature: 0,
          max_tokens: 40,
          messages: [
            {
              role: "system",
              content:
                'Extraia somente o número da nota fiscal / NF-e / NFS-e do texto OCR. NUNCA confunda com chave de acesso, CNPJ, número de boleto, linha digitável, número da fatura, número da DPS, versão do DANFSe, reserva, datas ou valores monetários. Se não houver certeza absoluta, retorne null. Nunca invente um número. Responda somente JSON no formato {"number":"123"} ou {"number":null}.',
            },
            { role: "user", content: text },
          ],
        }),
      },
    );

    if (!aiResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "Falha ao consultar IA",
          status: aiResponse.status,
        }),
        { status: aiResponse.status, headers: jsonHeaders },
      );
    }

    const aiData = await aiResponse.json();
    const content = aiData?.choices?.[0]?.message?.content;

    let number: string | null = null;

    if (typeof content === "string") {
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const rawNumber = parsed?.number;

          if (typeof rawNumber === "string" && /\d/.test(rawNumber)) {
            number = rawNumber.trim();
          }
        } catch {
          number = null;
        }
      }
    }

    return new Response(JSON.stringify({ number }), { headers: jsonHeaders });
  } catch {
    return new Response(
      JSON.stringify({ error: "Erro inesperado" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
