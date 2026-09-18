import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/utils";
import { useNumberFlowElementReady, type ChartStatFlowFormat } from "@/components/charts/chart-stat-flow";

// Número de KPI com contagem animada quando o valor muda (filtro, atualização de dado etc.) —
// mesmo custom element (NumberFlow) já usado nos centros de gráfico, só num tamanho maior pros
// cartões de KPI. Cor sólida de propósito (não gradiente/bg-clip-text): o NumberFlow renderiza
// via custom element próprio, então um `color: transparent` + `background-clip: text` no
// ancestral não teria texto nenhum da própria caixa pra recortar.
export function KpiValue({
  value, suffix, className, format, locales,
}: {
  value: number; suffix?: string; className?: string; format?: ChartStatFlowFormat; locales?: Intl.LocalesArgument;
}) {
  const ready = useNumberFlowElementReady();
  const staticValue = new Intl.NumberFormat(locales, format).format(value);
  return (
    <span className={cn("tabular-nums", className)}>
      {ready ? <NumberFlow value={value} suffix={suffix} format={format} locales={locales} willChange /> : `${staticValue}${suffix ?? ""}`}
    </span>
  );
}
