// Motivo de reprovação nas Nomeações: obrigatório e curto (até 4 palavras).
export const REJECTION_REASON_MAX_WORDS = 4;
export const REJECTION_REASON_MAX_CHARS = 40;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function validateRejectionReason(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return "Informe o motivo da reprovação.";
  if (countWords(t) > REJECTION_REASON_MAX_WORDS)
    return `Use no máximo ${REJECTION_REASON_MAX_WORDS} palavras.`;
  if (t.length > REJECTION_REASON_MAX_CHARS)
    return `Use no máximo ${REJECTION_REASON_MAX_CHARS} caracteres.`;
  return null;
}

export function normalizeRejectionReason(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
