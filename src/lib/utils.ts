import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KeyboardEvent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// button[role="combobox"] é o trigger do <Select> do Radix — visualmente/semanticamente é um
// campo de formulário (não uma ação), por isso entra na navegação mesmo sendo um <button>.
const FOCUSABLE_SELECTOR = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button[role="combobox"]:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Faz "Enter" se comportar como "Tab" dentro de um formulário: pula pro próximo campo focável
// em vez de tentar submeter algo. Não mexe em botões de ação (Enter continua clicando neles
// normalmente) nem em textarea (onde Enter deve quebrar linha) — exceto o trigger do Select,
// que é um campo, não uma ação.
// IMPORTANTE: precisa ser ligado via onKeyDownCapture (fase de captura), não onKeyDown. O
// Radix Select.Trigger tem seu próprio handler de "Enter" (reabre o dropdown) direto no botão;
// na fase de bubble esse handler já rodou antes do nosso, e preventDefault() sozinho não desfaz
// isso. Na fase de captura a gente intercepta primeiro e com stopPropagation() o handler do
// Radix nunca chega a rodar.
export function focusNextOnEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter") return;
  const target = e.target as HTMLElement;
  const isSelectTrigger = target.tagName === "BUTTON" && target.getAttribute("role") === "combobox";
  if ((target.tagName === "BUTTON" && !isSelectTrigger) || target.tagName === "TEXTAREA") return;
  e.preventDefault();
  e.stopPropagation();
  const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const idx = focusable.indexOf(target);
  if (idx > -1 && idx + 1 < focusable.length) focusable[idx + 1].focus();
}
