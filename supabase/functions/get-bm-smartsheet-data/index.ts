import { serve } from "https://deno.land/std/http/server.ts";

const SMARTSHEET_API = "https://api.smartsheet.com/2.0/sheets";

serve(async (req) => {
  const token = Deno.env.get("SMARTSHEET_TOKEN");
  const { sheetType } = await req.json(); // "sheet1" ou "sheet2"

  const sheetId =
    sheetType === "sheet1" ? Deno.env.get("SMARTSHEET_ID_1") : Deno.env.get("SMARTSHEET_ID_2");

  if (!token || !sheetId) {
    return new Response(JSON.stringify({ error: "Token ou Sheet ID não configurado" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch(`${SMARTSHEET_API}/${sheetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: "Falha ao buscar Smartsheet", status: response.status }),
      { status: response.status, headers: { "Content-Type": "application/json" } },
    );
  }

  const data = await response.json();

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
});
