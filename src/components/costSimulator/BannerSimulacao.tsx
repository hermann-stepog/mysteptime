import { Info } from "lucide-react";

// Único aviso sobre a origem dos valores (pedido dela, 2026-10-02) — nada de selos, contadores
// de registros ou alertas por categoria. Reaproveitado também no cabeçalho do PDF exportado.
export function BannerSimulacao() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <Info className="h-4 w-4 shrink-0" />
      <span>Os valores desta simulação são baseados nos últimos custos lançados no sistema.</span>
    </div>
  );
}
