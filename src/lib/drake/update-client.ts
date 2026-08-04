import { supabase } from "@/integrations/supabase/client";

export async function getDrakeUpdateAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function isInternalDrakePathLeak(message: string): boolean {
  return /ENOENT|no such file or directory|context-controls|tmp[/\\]drake|mysteptime-drake|[A-Za-z]:\\|\bEPERM\b|\bEBUSY\b/i.test(
    message,
  );
}

export function safeDrakeClientErrorMessage(message: string, fallback: string): string {
  return isInternalDrakePathLeak(message)
    ? "Não foi possível preparar os arquivos temporários da atualização."
    : message || fallback;
}
