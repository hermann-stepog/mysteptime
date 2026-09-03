import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, type AppRole } from "@/hooks/useAuth";

// "Ver como outro papel" — feature exclusiva da conta master (ADM), pedida pra pré-visualizar
// rápido o que cada papel vê no menu, sem precisar de um segundo login de teste. É PURAMENTE
// de navegação: troca só quais abas aparecem no topo (ver visibleNav em admin/route.tsx).
// Os dados continuam sendo lidos com o acesso real de operador — os papéis de verdade (PM,
// Visitante etc.) são impostos pelo RLS no banco, então isso aqui NUNCA restringe dado
// nenhum, só a navegação. Ver conversa com a usuária: decisão explícita dela.
const VIEW_AS_ALLOWED_EMAIL = "bruna.roque@step-og.com";
const STORAGE_KEY = "step-view-as-role";

export const VIEW_AS_ROLES: { value: AppRole; label: string }[] = [
  { value: "pm", label: "Solicitante" },
  { value: "visitante", label: "Visitante" },
  { value: "aprovacao_tecnica", label: "Nomeações — Aprovação Técnica" },
  { value: "qualidade", label: "Nomeações — Qualidade" },
  { value: "rh", label: "Nomeações — RH" },
  { value: "sms", label: "Nomeações — SMS" },
];

interface ViewAsCtx {
  canViewAs: boolean;
  viewAsRole: AppRole | null;
  setViewAsRole: (role: AppRole | null) => void;
  effectiveRole: AppRole | null;
}

const Ctx = createContext<ViewAsCtx | null>(null);

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { role, profile } = useAuth();
  const canViewAs = profile?.email === VIEW_AS_ALLOWED_EMAIL;
  const [viewAsRole, setViewAsRoleState] = useState<AppRole | null>(null);

  // Recupera a última escolha (localStorage) só pra quem pode usar a feature — nunca vaza
  // pra outra conta que eventualmente rode neste mesmo navegador.
  useEffect(() => {
    if (!canViewAs) { setViewAsRoleState(null); return; }
    const saved = localStorage.getItem(STORAGE_KEY) as AppRole | null;
    if (saved) setViewAsRoleState(saved);
  }, [canViewAs]);

  const setViewAsRole = (r: AppRole | null) => {
    setViewAsRoleState(r);
    if (r) localStorage.setItem(STORAGE_KEY, r); else localStorage.removeItem(STORAGE_KEY);
  };

  const effectiveRole = canViewAs && viewAsRole ? viewAsRole : role;

  return (
    <Ctx.Provider value={{ canViewAs, viewAsRole: canViewAs ? viewAsRole : null, setViewAsRole, effectiveRole }}>
      {children}
    </Ctx.Provider>
  );
}

export function useViewAs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useViewAs must be used inside ViewAsProvider");
  return ctx;
}
