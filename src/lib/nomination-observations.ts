import { z } from "zod";
import { hasSystemAdminAccess } from "./access-roles";

export const nominationObservationsSchema = z.object({
  nominationId: z.string().uuid(),
  notes: z.string().trim().max(10000, "As observações devem ter no máximo 10.000 caracteres."),
});

export function canEditNominationObservations(
  userId: string | null | undefined,
  requesterId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return Boolean(userId && (userId === requesterId || hasSystemAdminAccess(role)));
}