import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getTodayDrakePob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const { fetchTodayPob } = await import("@/lib/drake/pob.server");
      return await fetchTodayPob();
    } catch {
      throw new Error("Não foi possível atualizar o total de embarcados no Drake. Tente novamente.");
    }
  });
