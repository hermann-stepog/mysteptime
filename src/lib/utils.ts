import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useRef, type KeyboardEvent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Busca por nome "referente", não exata: ignora acentos e casa cada palavra digitada
// em qualquer lugar do nome, em qualquer ordem — assim "Gustavo Rodrigues" encontra
// "Gustavo Rangel Rodrigues" mesmo com um nome do meio entre as duas palavras buscadas.
export function matchesNameSearch(name: string, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const normalizedName = normalizeSearchText(name);
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return words.every((word) => normalizedName.includes(word));
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
// Pedido dela (2026-10-21): em todo campo de selecionar um ou mais, assim que uma opção é
// marcada ela fica fixada no topo da lista — mesmo comportamento pra todos os comboboxes do
// sistema (SearchableSelect, SearchableMultiSelect, Colaboradores, Etiquetas, Materiais etc.).
// Congela a ordem só enquanto o popover está aberto (snapshot tirado no momento em que abre) —
// senão o item marcado pularia pro topo no meio do clique, debaixo do cursor, a cada seleção
// dentro da mesma sessão de uso. Fecha e reabre: recalcula com o que está selecionado agora.
export function useOrdemComSelecionadosFixados<T>(
  options: T[],
  open: boolean,
  estaSelecionado: (opt: T) => boolean,
): T[] {
  const congelado = useRef<T[] | null>(null);
  if (open && !congelado.current) {
    congelado.current = [...options].sort(
      (a, b) => Number(estaSelecionado(b)) - Number(estaSelecionado(a)),
    );
  }
  if (!open) congelado.current = null;
  return congelado.current ?? options;
}

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
