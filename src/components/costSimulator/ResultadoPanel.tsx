import { useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ResultadoSimulacao } from "@/lib/costSimulator";

// Painel de resultado: KPIs, tabela por categoria (com valor por pessoa e override manual por
// linha) e o gráfico de ritmo acumulado. Exportação em PDF captura os blocos marcados com
// data-grafico.

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const chartConfig: ChartConfig = {
  custoAcumulado: { label: "Custo acumulado", color: "var(--chart-2)" },
};

export function ResultadoPanel({
  resultado,
  overrides,
  onChangeOverride,
  onExportarPdf,
}: {
  resultado: ResultadoSimulacao | null;
  overrides: Record<string, number | null>;
  onChangeOverride: (chave: string, valor: number | null) => void;
  onExportarPdf: (graficos: HTMLElement[]) => Promise<void>;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const [exportando, setExportando] = useState(false);

  if (!resultado) {
    return (
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-medium">Resultado</h2>
          <BrandLogo className="h-7 w-auto" />
        </div>
        <p className="text-sm text-muted-foreground">Preencha o formulário e clique em Calcular.</p>
      </Card>
    );
  }

  const pessoas = resultado.totalPessoas;
  const porPessoaDe = (valor: number) => (pessoas > 0 ? formatBRL(valor / pessoas) : "—");

  async function exportar() {
    if (!raiz.current) return;
    setExportando(true);
    try {
      await onExportarPdf(Array.from(raiz.current.querySelectorAll<HTMLElement>("[data-grafico]")));
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div ref={raiz} className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-medium">Resultado</h2>
            <BrandLogo className="h-7 w-auto" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={exportando}
          >
            <FileDown className="mr-1 h-4 w-4" />
            {exportando ? "Gerando PDF..." : "Exportar PDF"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Total" valor={formatBRL(resultado.total)} />
          <Kpi label="Por pessoa" valor={formatBRL(resultado.porPessoa)} />
          <Kpi label="Pessoas" valor={String(pessoas)} />
        </div>
      </Card>

      <Card className="overflow-x-auto p-4">
        <h2 className="mb-3 font-medium">Custos por categoria</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 pr-2">Categoria</th>
              <th className="py-1.5 pr-2">Base do cálculo</th>
              <th className="py-1.5 pr-2">Valor unitário</th>
              <th className="py-1.5 pr-2">Qtd</th>
              <th className="py-1.5 pr-2">Subtotal</th>
              <th className="py-1.5 pr-2">Por pessoa</th>
              <th className="py-1.5 pr-2">% do total</th>
            </tr>
          </thead>
          <tbody>
            {resultado.porCategoria.map((c) => (
              <tr key={c.chaveOverride} className="border-b last:border-0">
                <td className="py-1.5 pr-2">{c.categoria}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{c.base}</td>
                <td className="py-1.5 pr-2">
                  <Input
                    type="number"
                    step="0.01"
                    className="h-8 w-28"
                    value={overrides[c.chaveOverride] ?? ""}
                    placeholder={formatBRL(c.unitario)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChangeOverride(c.chaveOverride, v === "" ? null : Number(v) || 0);
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2">{c.qtd}</td>
                <td className="py-1.5 pr-2 font-medium">{formatBRL(c.subtotal)}</td>
                <td className="py-1.5 pr-2">{porPessoaDe(c.subtotal)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">
                  {c.percentualDoTotal.toFixed(1)}%
                </td>
              </tr>
            ))}
            {resultado.porCategoria.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-muted-foreground">
                  Nenhum custo histórico encontrado pros filtros informados.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <LinhaTotal
              label="Subtotal"
              valor={resultado.subtotal}
              porPessoa={porPessoaDe(resultado.subtotal)}
              borda
            />
            {resultado.reajusteValor !== 0 && (
              <LinhaTotal
                label="Reajuste"
                valor={resultado.reajusteValor}
                porPessoa={porPessoaDe(resultado.reajusteValor)}
              />
            )}
            {resultado.contingenciaValor !== 0 && (
              <LinhaTotal
                label="Contingência"
                valor={resultado.contingenciaValor}
                porPessoa={porPessoaDe(resultado.contingenciaValor)}
              />
            )}
            {resultado.markupValor !== 0 && (
              <LinhaTotal
                label="Markup"
                valor={resultado.markupValor}
                porPessoa={porPessoaDe(resultado.markupValor)}
              />
            )}
            <LinhaTotal
              label="Total"
              valor={resultado.total}
              porPessoa={porPessoaDe(resultado.total)}
              borda
              destaque
            />
          </tfoot>
        </table>
      </Card>

      {resultado.serieMensal.length > 1 && (
        <Card className="p-4" data-grafico>
          <h2 className="mb-3 font-medium">Ritmo de gasto acumulado</h2>
          <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
            <LineChart
              data={resultado.serieMensal}
              margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="mes"
                tickLine={false}
                axisLine={false}
                tickFormatter={(m) => `Mês ${m}`}
              />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="custoAcumulado"
                stroke="var(--color-custoAcumulado)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </Card>
      )}
    </div>
  );
}

function LinhaTotal({
  label,
  valor,
  porPessoa,
  borda,
  destaque,
}: {
  label: string;
  valor: number;
  porPessoa: string;
  borda?: boolean;
  destaque?: boolean;
}) {
  return (
    <tr className={`${borda ? "border-t" : ""} ${destaque ? "text-base" : ""}`}>
      <td className={`py-1.5 pr-2 ${destaque ? "font-semibold" : "text-muted-foreground"}`}>
        {label}
      </td>
      <td colSpan={3} />
      <td className={`py-1.5 pr-2 text-right ${destaque ? "font-semibold" : "font-medium"}`}>
        {formatBRL(valor)}
      </td>
      <td className={`py-1.5 pr-2 ${destaque ? "font-semibold" : ""}`}>{porPessoa}</td>
      <td />
    </tr>
  );
}

function Kpi({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </div>
  );
}
