import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KeyboardEvent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const FOCUSABLE_SELECTOR = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Faz "Enter" se comportar como "Tab" dentro de um formulário: pula pro próximo campo focável
// em vez de tentar submeter algo. Não mexe em botões (Enter continua clicando neles normalmente)
// nem em textarea (onde Enter deve quebrar linha).
export function focusNextOnEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter") return;
  const target = e.target as HTMLElement;
  if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA") return;
  e.preventDefault();
  const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const idx = focusable.indexOf(target);
  if (idx > -1 && idx + 1 < focusable.length) focusable[idx + 1].focus();
}
