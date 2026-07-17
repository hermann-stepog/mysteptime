import { toast } from "sonner";

// Ponto único de feedback de ação (sucesso/erro/aviso/info) — todo o app deve chamar isso em
// vez de "sonner" diretamente, pra manter uma única forma consistente de notificar o usuário.
export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  warning: (message: string) => toast.warning(message),
  info: (message: string) => toast.info(message),
};
