import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY não configurada" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { ocrText } = await req.json();

    if (typeof ocrText !== "string" || !ocrText.trim()) {
      return new Response(
        JSON.stringify({ error: "Texto OCR não informado" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Evita enviar texto desnecessariamente grande para a IA.
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
                'Extraia somente o número da nota fiscal/NF-e/NFS-e do texto OCR. Não confunda com número de boleto, chave de acesso, CNPJ, fatura, DPS, versão do DANFSe, valor, data ou código de reserva. Responda somente JSON no formato {"number":"123"} ou {"number":null}. Não invente um número se não estiver claro.',
            },
            {
              role: "user",
              content: text,
            },
          ],
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();

      return new Response(
        JSON.stringify({
          error: "Falha ao consultar IA",
          status: aiResponse.status,
          detail: errorText,
        }),
        {
          status: aiResponse.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const aiData = await aiResponse.json();
    const content = aiData?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error("Resposta da IA em formato inesperado");
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("IA não retornou JSON válido");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const rawNumber = parsed?.number;

    const number =
      typeof rawNumber === "string" && /\d/.test(rawNumber)
        ? rawNumber.trim()
        : null;

    return new Response(
      JSON.stringify({ number }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("extract-invoice-number-ai:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Erro inesperado",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
