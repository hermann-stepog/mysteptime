import * as React from "react";

// Generaliza o padrão de use-mobile.tsx (que é fixo em 768px) pra qualquer
// media query — usado onde a lógica em JS precisa saber a largura da tela
// (ex.: quantos dias cabem numa janela paginada), e não só esconder/mostrar
// via classe CSS.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
