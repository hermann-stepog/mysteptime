/** Capability checks only: preserve the stored role for identity and email recipients. */
export const SYSTEM_ADMIN_ROLES = ["administrador", "diretoria"] as const;
export const OPERATOR_ROLES = ["logistics_operator", ...SYSTEM_ADMIN_ROLES] as const;
export const FULL_NOMINATIONS_ACCESS_ROLES = [...OPERATOR_ROLES, "adm_master"] as const;

export function hasSystemAdminAccess(role: string | null | undefined): boolean {
  return SYSTEM_ADMIN_ROLES.some((allowed) => allowed === role);
}

export function hasOperatorAccess(role: string | null | undefined): boolean {
  return OPERATOR_ROLES.some((allowed) => allowed === role);
}