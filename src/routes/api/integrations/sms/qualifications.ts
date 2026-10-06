import { createFileRoute } from "@tanstack/react-router";
import {
  handleSmsQualificationsRequest,
  SMS_QUALIFICATION_COLUMNS,
  type SmsQualification,
} from "@/lib/smsEmployees";

// Endpoint externo READ-ONLY para o Sistema SMS (cursos/qualificações do Drake). Somente GET.
export const Route = createFileRoute("/api/integrations/sms/qualifications")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handleSmsQualificationsRequest(request, {
          secret: process.env["SMS_SYNC_ACCESS_TOKEN"],
          fetchRows: async () => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const all: SmsQualification[] = [];
            const page = 1000;
            for (let from = 0; ; from += page) {
              const { data, error } = await (supabaseAdmin as any)
                .from("drake_worker_qualifications")
                .select(SMS_QUALIFICATION_COLUMNS)
                .order("drake_worker_id", { ascending: true })
                .order("qualification_name", { ascending: true })
                .order("qualification_id", { ascending: true })
                .range(from, from + page - 1);
              if (error) throw error;
              all.push(...((data ?? []) as SmsQualification[]));
              if (!data || data.length < page) break;
            }
            return all;
          },
        }),
    },
  },
});
