import { createFileRoute } from "@tanstack/react-router";
import { handleSmsContextRequest } from "@/lib/smsContext";

// Endpoint externo READ-ONLY para o Sistema SMS (datasets de contexto). Somente GET; nenhuma escrita.
export const Route = createFileRoute("/api/integrations/sms/context")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handleSmsContextRequest(request, {
          secret: process.env["SMS_SYNC_ACCESS_TOKEN"],
          fetchPage: async (def, from, to) => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            let q = (supabaseAdmin as any).from(def.table).select(def.select, { count: "exact" });
            for (const col of def.order) q = q.order(col, { ascending: true, nullsFirst: false });
            const { data, error, count } = await q.range(from, to);
            if (error) throw error;
            return { rows: data ?? [], count: count ?? 0 };
          },
          fetchActiveEmployees: async () => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const all: { empresa: string | null; matricula: string }[] = [];
            for (let from = 0; ; from += 1000) {
              const { data, error } = await (supabaseAdmin as any)
                .from("hist_novo_colaboradores")
                .select("empresa, matricula")
                .eq("ativo", true)
                .order("id", { ascending: true })
                .range(from, from + 999);
              if (error) throw error;
              all.push(...(data ?? []));
              if (!data || data.length < 1000) break;
            }
            return all;
          },
        }),
    },
  },
});
