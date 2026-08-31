import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Detecta quando uma nova versão do app foi publicada enquanto a aba está aberta
 * (ou quando o navegador serviu um HTML antigo do cache) e oferece recarregar.
 *
 * Funciona sem build id: compara os scripts com hash do HTML atual do servidor
 * (buscado com cache desativado) com os scripts carregados nesta página.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function currentScriptFingerprint(): string {
  return Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
    .map((s) => new URL(s.src, location.origin).pathname)
    .filter((p) => p.includes("/_build/") || p.includes("/assets/"))
    .sort()
    .join("|");
}

function fingerprintFromHtml(html: string): string {
  const matches = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)).map((m) => m[1]);
  return matches
    .map((src) => {
      try {
        return new URL(src, location.origin).pathname;
      } catch {
        return src;
      }
    })
    .filter((p) => p.includes("/_build/") || p.includes("/assets/"))
    .sort()
    .join("|");
}

export function AppVersionWatcher() {
  const notified = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let cancelled = false;
    const local = currentScriptFingerprint();
    if (!local) return;

    const check = async () => {
      if (cancelled || notified.current || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(location.origin + "/", {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const remote = fingerprintFromHtml(await res.text());
        if (!remote || remote === local) return;
        notified.current = true;
        toast.info("Nova versão disponível", {
          description: "Recarregue para carregar as últimas atualizações.",
          duration: Infinity,
          action: {
            label: "Atualizar",
            onClick: () => {
              if ("caches" in window) {
                caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).finally(() =>
                  location.reload(),
                );
              } else {
                location.reload();
              }
            },
          },
        });
      } catch {
        /* offline ou rede instável — ignora */
      }
    };

    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    void check();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
