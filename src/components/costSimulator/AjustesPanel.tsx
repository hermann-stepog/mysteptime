import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  mesesAtras,
  hojeISO,
  type AjustesSimulacao,
  type MetodoCalculo,
} from "@/lib/costSimulator";
import type { TipoMarkup } from "@/lib/bm";
import type { CostFilterOptions } from "@/lib/api/costSimulator.functions";

// Os overrides manuais por categoria ficam no ResultadoPanel (editados linha a linha na tabela,
// já que cada categoria só existe depois que a simulação roda).

const PRESETS: { tipo: "3" | "6" | "12"; label: string }[] = [
  { tipo: "3", label: "Últimos 3 meses" },
  { tipo: "6", label: "Últimos 6 meses" },
  { tipo: "12", label: "Últimos 12 meses" },
];

export function AjustesPanel({
  ajustes,
  onChange,
  opcoesFiltro,
  erroOpcoesFiltro,
}: {
  ajustes: AjustesSimulacao;
  onChange: (next: AjustesSimulacao) => void;
  opcoesFiltro: CostFilterOptions | undefined;
  erroOpcoesFiltro: string | null;
}) {
  function setPeriodoPreset(tipo: "3" | "6" | "12") {
    onChange({
      ...ajustes,
      periodoReferencia: { tipo, inicio: mesesAtras(Number(tipo)), fim: hojeISO() },
    });
  }

  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-medium">Ajustes</h2>

      <div className="space-y-2">
        <Label>Período de referência dos custos</Label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.tipo}
              type="button"
              onClick={() => setPeriodoPreset(p.tipo)}
              className={`text-xs rounded-md border px-2 py-1 ${
                ajustes.periodoReferencia.tipo === p.tipo
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...ajustes,
                periodoReferencia: { ...ajustes.periodoReferencia, tipo: "custom" },
              })
            }
            className={`text-xs rounded-md border px-2 py-1 ${
              ajustes.periodoReferencia.tipo === "custom"
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted"
            }`}
          >
            Personalizado
          </button>
        </div>
        {ajustes.periodoReferencia.tipo === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={ajustes.periodoReferencia.inicio}
              onChange={(e) =>
                onChange({
                  ...ajustes,
                  periodoReferencia: { ...ajustes.periodoReferencia, inicio: e.target.value },
                })
              }
            />
            <Input
              type="date"
              value={ajustes.periodoReferencia.fim}
              onChange={(e) =>
                onChange({
                  ...ajustes,
                  periodoReferencia: { ...ajustes.periodoReferencia, fim: e.target.value },
                })
              }
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Filtros dos custos históricos</Label>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="w-full border rounded-md h-9 px-2 text-sm"
            aria-label="Hotel (filtra hospedagem)"
            value={ajustes.filtros.hotelIds?.[0] ?? ""}
            onChange={(e) =>
              onChange({
                ...ajustes,
                filtros: {
                  ...ajustes.filtros,
                  hotelIds: e.target.value ? [e.target.value] : undefined,
                },
              })
            }
            disabled={!opcoesFiltro}
          >
            <option value="">Todos os hotéis</option>
            {opcoesFiltro?.hoteis.map((h) => (
              <option key={h.id} value={h.id}>
                {h.nome}
                {h.cidade ? ` (${h.cidade})` : ""}
              </option>
            ))}
          </select>
          <select
            className="w-full border rounded-md h-9 px-2 text-sm"
            aria-label="Tipo de transporte (filtra transporte)"
            value={ajustes.filtros.tipoTransporte ?? ""}
            onChange={(e) =>
              onChange({
                ...ajustes,
                filtros: { ...ajustes.filtros, tipoTransporte: e.target.value || undefined },
              })
            }
            disabled={!opcoesFiltro}
          >
            <option value="">Todos os tipos</option>
            {opcoesFiltro?.tiposTransporte.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {erroOpcoesFiltro && <p className="text-xs text-destructive">{erroOpcoesFiltro}</p>}
      </div>

      <div className="space-y-2">
        <Label>Método de cálculo</Label>
        <select
          className="w-full border rounded-md h-9 px-2 text-sm"
          value={ajustes.metodoCalculo}
          onChange={(e) => onChange({ ...ajustes, metodoCalculo: e.target.value as MetodoCalculo })}
        >
          <option value="media">Média</option>
          <option value="mediana">Mediana</option>
          <option value="ultimo">Último valor lançado</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label>Reajuste (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={ajustes.reajustePercent}
            onChange={(e) => onChange({ ...ajustes, reajustePercent: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-2">
          <Label>Contingência (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={ajustes.contingenciaPercent}
            onChange={(e) =>
              onChange({ ...ajustes, contingenciaPercent: Number(e.target.value) || 0 })
            }
          />
        </div>
      </div>

      <div className="space-y-3 border-t pt-3">
        <div className="flex items-center justify-between">
          <Label>Aplicar markup</Label>
          <Switch
            checked={ajustes.markup.aplicar}
            onCheckedChange={(v) =>
              onChange({ ...ajustes, markup: { ...ajustes.markup, aplicar: v } })
            }
          />
        </div>
        {ajustes.markup.aplicar && (
          <div className="space-y-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select
                className="w-full border rounded-md h-9 px-2 text-sm"
                value={ajustes.markup.tipo}
                onChange={(e) =>
                  onChange({
                    ...ajustes,
                    markup: { ...ajustes.markup, tipo: e.target.value as TipoMarkup },
                  })
                }
              >
                <option value="simples">Simples (só lucro)</option>
                <option value="com_imposto">Com imposto (lucro + imposto por fora)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Lucro (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={ajustes.markup.percentualLucro}
                  onChange={(e) =>
                    onChange({
                      ...ajustes,
                      markup: { ...ajustes.markup, percentualLucro: Number(e.target.value) || 0 },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Imposto (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={ajustes.markup.percentualImposto}
                  onChange={(e) =>
                    onChange({
                      ...ajustes,
                      markup: { ...ajustes.markup, percentualImposto: Number(e.target.value) || 0 },
                    })
                  }
                  disabled={ajustes.markup.tipo !== "com_imposto"}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
