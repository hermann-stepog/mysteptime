import { createFileRoute } from "@tanstack/react-router";
import { handleSmsEmployeesRequest, SMS_EMPLOYEE_COLUMNS, type SmsSourceRow } from "@/lib/smsEmployees";

// Endpoint externo READ-ONLY para o Sistema SMS. Somente GET; nenhuma escrita.
export const Route = createFileRoute("/api/integrations/sms/employees")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handleSmsEmployeesRequest(request, {
          secret: process.env["SMS_SYNC_ACCESS_TOKEN"],
          fetchRows: async () => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const all: SmsSourceRow[] = [];
            const page = 1000;
            for (let from = 0; ; from += page) {
              const { data, error } = await (supabaseAdmin as any)
                .from("hist_novo_colaboradores")
                .select(SMS_EMPLOYEE_COLUMNS)
                .eq("ativo", true)
                .order("nome", { ascending: true })
                .order("id", { ascending: true })
                .range(from, from + page - 1);
              if (error) throw error;
              all.push(...((data ?? []) as SmsSourceRow[]));
              if (!data || data.length < page) break;
            }
            return all;
          },
        }),
    },
  },
});
