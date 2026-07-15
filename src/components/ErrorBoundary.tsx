import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Rede de segurança global — pega qualquer erro de render que escape dos error boundaries de
// rota do TanStack Router (ex.: erro fora do <Outlet>, em providers, ou em código que o router
// não consegue isolar por rota) e mostra uma tela amigável em vez de branco.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
    reportLovableError(error, { boundary: "global_error_boundary", componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold">Ops, algo deu errado</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Encontramos um erro inesperado nesta página. Recarregar costuma resolver.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={() => window.location.reload()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Recarregar página
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
