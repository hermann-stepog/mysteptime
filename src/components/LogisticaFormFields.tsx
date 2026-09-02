import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MOTIVOS_LOGISTICA } from "@/lib/logistica";
import { matchesNameSearch } from "@/lib/utils";

// Campos de formulário compartilhados entre os módulos de logística (Hospedagem, Passagens
// Aéreas, e o que mais vier depois) — evita duplicar a mesma lógica de combobox em cada módulo.

// Autocomplete a partir de hist_novo_colaboradores, mas aceita qualquer texto digitado (ex.:
// alguém do administrativo, sem cadastro prévio) — não é uma FK, é só um texto.
export function NomeUsuarioField({ value, onChange, colaboradores }: {
  value: string; onChange: (v: string) => void; colaboradores: { id: string; nome: string }[];
}) {
  const [open, setOpen] = useState(false);
  // hist_novo_colaboradores tem 1 linha por empresa+matrícula — a mesma pessoa que já passou por
  // mais de um contrato/empresa aparece mais de uma vez com o mesmo nome. Pra esse campo (só
  // preenche um texto livre, não referencia o id) isso não importa: sem desduplicar por nome,
  // gente reaparecendo várias vezes toma o lugar de outras pessoas dentro do limite de 20
  // sugestões, escondendo quem realmente está sendo procurado.
  const colaboradoresUnicos = useMemo(() => {
    const vistos = new Set<string>();
    return colaboradores.filter((c) => {
      const chave = c.nome.trim().toUpperCase();
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }, [colaboradores]);
  const sugestoes = useMemo(() => {
    const q = value.trim();
    const lista = q ? colaboradoresUnicos.filter((c) => matchesNameSearch(c.nome, q)) : colaboradoresUnicos;
    return lista.slice(0, 20);
  }, [value, colaboradoresUnicos]);

  return (
    <Popover open={open && sugestoes.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Nome de quem vai utilizar"
          autoComplete="off"
        />
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="max-h-56 overflow-auto">
          {sugestoes.map((c) => (
            <button
              key={c.id}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => { onChange(c.nome); setOpen(false); }}
            >
              {c.nome}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Combobox de Motivo (lista + "Outro" pra digitar) — mesma lista MOTIVOS_LOGISTICA em todos os
// módulos que usam esse campo.
export function MotivoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [manual, setManual] = useState(value !== "" && !MOTIVOS_LOGISTICA.includes(value));
  if (manual) {
    return (
      <div className="flex gap-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Motivo" />
        <Button type="button" variant="ghost" size="sm" onClick={() => { setManual(false); onChange(""); }}>Lista</Button>
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={(v) => { if (v === "__outro__") { setManual(true); return; } onChange(v); }}>
      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
      <SelectContent>
        {MOTIVOS_LOGISTICA.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        <SelectItem value="__outro__">Outro (digitar)...</SelectItem>
      </SelectContent>
    </Select>
  );
}

// Select com escape para digitação manual — usado em Unidade/BSP, onde a lista vem do
// histórico (hist_novo_*) e nem sempre contém uma unidade/BSP novo ainda não cadastrado.
// Quando o valor atual não está na lista (ex.: registro antigo, ou algo digitado agora),
// o campo já abre no modo manual.
export function SelectComOutro({ value, onChange, options, placeholder = "Selecione", disabled, manualPlaceholder = "Digitar" }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  manualPlaceholder?: string;
}) {
  const [manual, setManual] = useState(false);
  const foraDaLista = value !== "" && !options.includes(value);
  if (manual || foraDaLista) {
    return (
      <div className="flex gap-1">
        <Input
          value={value} disabled={disabled} placeholder={manualPlaceholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs"
          onClick={() => { setManual(false); onChange(""); }}
        >
          Lista
        </Button>
      </div>
    );
  }
  return (
    <Select
      value={value || undefined} disabled={disabled}
      onValueChange={(v) => { if (v === "__outro__") { setManual(true); onChange(""); return; } onChange(v); }}
    >
      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        <SelectItem value="__outro__">Outro (digitar)...</SelectItem>
      </SelectContent>
    </Select>
  );
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function toNumber(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// ── Rateio por percentual entre BSPs/centros de custo ────────────────────────────────────
// Compartilhado por Transporte, Hospedagem e Passagens Aéreas: em vez de digitar o valor de
// cada BSP na mão, digita o valor TOTAL do lançamento uma vez e o percentual de cada BSP —
// o valor de cada linha sai calculado (total × percentual/100). Nunca substitui o campo de
// valor por linha, só oferece um jeito mais rápido de preenchê-lo quando o custo já nasce
// dividido por rateio; desligado, cada linha continua sendo digitada direto como sempre foi.
export function useRateioPercentual(numLinhas: number) {
  const [ativo, setAtivoState] = useState(false);
  const [valorTotal, setValorTotal] = useState("");
  const [percentuais, setPercentuaisState] = useState<string[]>(["100", "", ""]);

  const total = toNumber(valorTotal);
  const somaPercentual = round2(percentuais.slice(0, numLinhas).reduce((soma, p) => soma + toNumber(p), 0));
  const valores = percentuais.map((p) => round2(total * toNumber(p) / 100));

  function setPercentual(indice: number, valor: string) {
    setPercentuaisState((atual) => { const proximo = [...atual]; proximo[indice] = valor; return proximo; });
  }
  function setAtivo(valor: boolean) {
    setAtivoState(valor);
    if (!valor) { setValorTotal(""); setPercentuaisState(["100", "", ""]); }
  }
  function reset() {
    setAtivoState(false); setValorTotal(""); setPercentuaisState(["100", "", ""]);
  }

  return { ativo, setAtivo, valorTotal, setValorTotal, percentuais, setPercentual, valores, somaPercentual, total, reset };
}

export type UseRateioPercentualReturn = ReturnType<typeof useRateioPercentual>;

// Painel de UI do rateio acima — recebe o resultado de useRateioPercentual já pronto, só
// desenha o toggle + valor total + percentual de cada linha ativa (BSP com valor preenchido).
export function RateioPercentualPanel({ rateio, labels }: { rateio: UseRateioPercentualReturn; labels: string[] }) {
  return (
    <div className="rounded-md border border-dashed p-3 text-xs">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={rateio.ativo} onChange={(e) => rateio.setAtivo(e.target.checked)} />
        Calcular por rateio (%) em vez de digitar cada valor
      </label>
      {rateio.ativo && (
        <div className="mt-2 space-y-2">
          <div className="max-w-[220px]">
            <Label className="text-xs">Valor total do lançamento</Label>
            <Input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={rateio.valorTotal} onChange={(e) => rateio.setValorTotal(e.target.value)}
              placeholder="R$ 0,00"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {labels.map((label, i) => (
              <div key={label}>
                <Label className="text-xs">{label} — %</Label>
                <Input
                  type="number" step="0.01" min="0" max="100" inputMode="decimal"
                  value={rateio.percentuais[i] ?? ""} onChange={(e) => rateio.setPercentual(i, e.target.value)}
                  placeholder="0"
                />
                <p className="mt-0.5 text-muted-foreground">
                  {(rateio.valores[i] ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
              </div>
            ))}
          </div>
          <p className={rateio.somaPercentual === 100 ? "text-muted-foreground" : "font-medium text-destructive"}>
            Soma dos percentuais: {rateio.somaPercentual}%{rateio.somaPercentual !== 100 && " — precisa somar 100%"}
          </p>
        </div>
      )}
    </div>
  );
}

function fmtMoneyLocal(n: number): string {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Rateio complementar (Hospedagem/Passagens Aéreas) ────────────────────────────────────
// Diferente do rateio de Transporte acima: aqui já existe um valor único calculado pro
// lançamento (diárias × valor da diária, ou o valor digitado da passagem) — não faz sentido
// pedir de novo um "valor total". Em vez de 3 fatias independentes, só pede o percentual dos
// centros de custo EXTRAS (2º e 3º BSP); o BSP principal (já preenchido acima no formulário)
// fica implicitamente com o restante — nunca precisa reescrever esse valor na mão.
export function useRateioComplementar(valorBase: number) {
  const [ativo, setAtivoState] = useState(false);
  const [bsp2, setBsp2] = useState("");
  const [percentual2, setPercentual2] = useState("");
  const [bsp3, setBsp3] = useState("");
  const [percentual3, setPercentual3] = useState("");

  const valor2 = round2(valorBase * toNumber(percentual2) / 100);
  const valor3 = round2(valorBase * toNumber(percentual3) / 100);
  const restante = round2(valorBase - valor2 - valor3);

  function setAtivo(valor: boolean) {
    setAtivoState(valor);
    if (!valor) { setBsp2(""); setPercentual2(""); setBsp3(""); setPercentual3(""); }
  }
  function reset() {
    setAtivoState(false); setBsp2(""); setPercentual2(""); setBsp3(""); setPercentual3("");
  }

  return { ativo, setAtivo, bsp2, setBsp2, percentual2, setPercentual2, bsp3, setBsp3, percentual3, setPercentual3, valor2, valor3, restante, reset };
}

export type UseRateioComplementarReturn = ReturnType<typeof useRateioComplementar>;

export function RateioComplementarPanel({ rateio }: { rateio: UseRateioComplementarReturn }) {
  return (
    <div className="rounded-md border border-dashed p-3 text-xs">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={rateio.ativo} onChange={(e) => rateio.setAtivo(e.target.checked)} />
        Ratear parte do valor com outro(s) centro(s) de custo
      </label>
      {rateio.ativo && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <div><Label className="text-xs">BSP 2</Label><Input value={rateio.bsp2} onChange={(e) => rateio.setBsp2(e.target.value)} placeholder="Número do BSP" /></div>
            <div><Label className="text-xs">% do valor</Label><Input type="number" step="0.01" min="0" max="100" inputMode="decimal" value={rateio.percentual2} onChange={(e) => rateio.setPercentual2(e.target.value)} placeholder="0" /></div>
            <p className="text-muted-foreground">{fmtMoneyLocal(rateio.valor2)}</p>
          </div>
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <div><Label className="text-xs">BSP 3</Label><Input value={rateio.bsp3} onChange={(e) => rateio.setBsp3(e.target.value)} placeholder="Número do BSP" /></div>
            <div><Label className="text-xs">% do valor</Label><Input type="number" step="0.01" min="0" max="100" inputMode="decimal" value={rateio.percentual3} onChange={(e) => rateio.setPercentual3(e.target.value)} placeholder="0" /></div>
            <p className="text-muted-foreground">{fmtMoneyLocal(rateio.valor3)}</p>
          </div>
          <p className={rateio.restante < 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
            BSP principal fica com {fmtMoneyLocal(rateio.restante)}
            {rateio.restante < 0 && " — os percentuais somam mais que 100% do valor"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Pessoas adicionais no mesmo formulário (Hospedagem / Passagens Aéreas) ────────────────
// Um lançamento por pessoa continua sendo a regra no banco: aqui só evitamos reabrir o
// formulário do zero pra cada colaborador da mesma viagem/estadia. Cada pessoa adicional
// pode ter unidade/BSP próprios (ex.: mesma van de hotel, centros de custo diferentes);
// deixando em branco, herda a unidade/BSP do formulário principal.
export interface PessoaAdicional { nome: string; unidade: string; bsp: string }

export function usePessoasAdicionais() {
  const [pessoas, setPessoas] = useState<PessoaAdicional[]>([]);
  function add() { setPessoas((p) => [...p, { nome: "", unidade: "", bsp: "" }]); }
  function update(i: number, patch: Partial<PessoaAdicional>) {
    setPessoas((p) => p.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }
  function remove(i: number) { setPessoas((p) => p.filter((_, idx) => idx !== i)); }
  function reset() { setPessoas([]); }
  const validas = pessoas.filter((p) => p.nome.trim() !== "");
  return { pessoas, add, update, remove, reset, validas };
}

export type UsePessoasAdicionaisReturn = ReturnType<typeof usePessoasAdicionais>;

export function PessoasAdicionaisPanel({ estado, colaboradores, unidadeOptions, bspOptionsFor, unidadePadrao, bspPadrao }: {
  estado: UsePessoasAdicionaisReturn;
  colaboradores: { id: string; nome: string }[];
  unidadeOptions: string[];
  bspOptionsFor: (unidade: string) => string[];
  unidadePadrao: string;
  bspPadrao: string;
}) {
  return (
    <div className="rounded-md border border-dashed p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Outros colaboradores neste lançamento</span>
        <Button type="button" variant="outline" size="sm" onClick={estado.add}>Adicionar colaborador</Button>
      </div>
      {estado.pessoas.length === 0 ? (
        <p className="mt-1 text-muted-foreground">Cada colaborador adicionado gera um lançamento próprio com os mesmos dados.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {estado.pessoas.map((p, i) => {
            const unidade = p.unidade || unidadePadrao;
            const opcoesBsp = bspOptionsFor(unidade || "all");
            return (
              <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <div>
                  <Label className="text-xs">Colaborador</Label>
                  <NomeUsuarioField value={p.nome} onChange={(v) => estado.update(i, { nome: v })} colaboradores={colaboradores} />
                </div>
                <div>
                  <Label className="text-xs">Unidade</Label>
                  <SelectComOutro
                    value={p.unidade} onChange={(v) => estado.update(i, { unidade: v, bsp: "" })}
                    options={unidadeOptions} placeholder={unidadePadrao || "Selecione"} manualPlaceholder="Digitar unidade"
                  />
                </div>
                <div>
                  <Label className="text-xs">BSP</Label>
                  <SelectComOutro
                    value={p.bsp} onChange={(v) => estado.update(i, { bsp: v })}
                    options={opcoesBsp} placeholder={bspPadrao || "Selecione"} manualPlaceholder="Digitar BSP"
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => estado.remove(i)}>Remover</Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Campos "+" inline (Nome do usuário / BSP) ─────────────────────────────────────────────
// Em vez de um painel separado lá embaixo, o próprio campo principal ganha um botão "+"
// no rótulo: adiciona linhas extras logo abaixo dele.

// Nome do usuário + colaboradores extras (cada um vira um lançamento próprio ao salvar).
export function NomeUsuarioMultiField({ label = "Nome do usuário", value, onChange, colaboradores, extras, permiteAdicionar = true }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  colaboradores: { id: string; nome: string }[];
  extras: UsePessoasAdicionaisReturn;
  permiteAdicionar?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {permiteAdicionar && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={extras.add}>
            + colaborador
          </Button>
        )}
      </div>
      <NomeUsuarioField value={value} onChange={onChange} colaboradores={colaboradores} />
      {permiteAdicionar && extras.pessoas.length > 0 && (
        <div className="mt-2 space-y-2">
          {extras.pessoas.map((p, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="flex-1">
                <NomeUsuarioField value={p.nome} onChange={(v) => extras.update(i, { nome: v })} colaboradores={colaboradores} />
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => extras.remove(i)}>✕</Button>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Cada colaborador adicionado gera um lançamento próprio com os mesmos dados.</p>
        </div>
      )}
    </div>
  );
}

// BSP + BSPs extras de rateio (2º/3º centro de custo, com o % de cada um).
export function BspMultiField({ value, onChange, options, disabled, rateio, permiteRatear = true }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  disabled?: boolean;
  rateio: UseRateioComplementarReturn;
  permiteRatear?: boolean;
}) {
  const mostrar2 = rateio.ativo;
  const mostrar3 = rateio.ativo && rateio.bsp3 !== "" ? true : false;
  const [forcar3, setForcar3] = useState(false);
  const exibe3 = mostrar3 || forcar3;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">BSP</Label>
        {permiteRatear && (
          <Button
            type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
            onClick={() => { if (!rateio.ativo) rateio.setAtivo(true); else setForcar3(true); }}
          >
            + BSP
          </Button>
        )}
      </div>
      <SelectComOutro value={value} onChange={onChange} options={options} disabled={disabled} manualPlaceholder="Digitar BSP" />
      {permiteRatear && mostrar2 && (
        <div className="mt-2 space-y-2 rounded-md border border-dashed p-2 text-xs">
          <div className="grid grid-cols-[1fr_80px_auto] items-end gap-1">
            <div>
              <Label className="text-[11px]">BSP 2</Label>
              <Input value={rateio.bsp2} onChange={(e) => rateio.setBsp2(e.target.value)} placeholder="Número do BSP" />
            </div>
            <div>
              <Label className="text-[11px]">%</Label>
              <Input type="number" step="0.01" min="0" max="100" inputMode="decimal" value={rateio.percentual2} onChange={(e) => rateio.setPercentual2(e.target.value)} placeholder="0" />
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => { rateio.setAtivo(false); setForcar3(false); }}>✕</Button>
          </div>
          <p className="text-muted-foreground">{fmtMoneyLocal(rateio.valor2)}</p>
          {exibe3 && (
            <>
              <div className="grid grid-cols-[1fr_80px_auto] items-end gap-1">
                <div>
                  <Label className="text-[11px]">BSP 3</Label>
                  <Input value={rateio.bsp3} onChange={(e) => rateio.setBsp3(e.target.value)} placeholder="Número do BSP" />
                </div>
                <div>
                  <Label className="text-[11px]">%</Label>
                  <Input type="number" step="0.01" min="0" max="100" inputMode="decimal" value={rateio.percentual3} onChange={(e) => rateio.setPercentual3(e.target.value)} placeholder="0" />
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => { rateio.setBsp3(""); rateio.setPercentual3(""); setForcar3(false); }}>✕</Button>
              </div>
              <p className="text-muted-foreground">{fmtMoneyLocal(rateio.valor3)}</p>
            </>
          )}
          <p className={rateio.restante < 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
            BSP principal fica com {fmtMoneyLocal(rateio.restante)}
            {rateio.restante < 0 && " — os percentuais somam mais que 100% do valor"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Unidade + unidades adicionais ────────────────────────────────────────────────────────
// Mesma lógica das pessoas adicionais: cada unidade extra (com seu BSP) vira um lançamento
// próprio, mantendo o restante dos dados do formulário.
export interface UnidadeAdicional { unidade: string; bsp: string }

export function useUnidadesAdicionais() {
  const [unidades, setUnidades] = useState<UnidadeAdicional[]>([]);
  function add() { setUnidades((u) => [...u, { unidade: "", bsp: "" }]); }
  function update(i: number, patch: Partial<UnidadeAdicional>) {
    setUnidades((u) => u.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }
  function remove(i: number) { setUnidades((u) => u.filter((_, idx) => idx !== i)); }
  function reset() { setUnidades([]); }
  const validas = unidades.filter((u) => u.unidade.trim() !== "");
  return { unidades, add, update, remove, reset, validas };
}

export type UseUnidadesAdicionaisReturn = ReturnType<typeof useUnidadesAdicionais>;

export function UnidadeMultiField({ value, onChange, options, extras, bspOptionsFor, permiteAdicionar = true }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  extras: UseUnidadesAdicionaisReturn;
  bspOptionsFor: (unidade: string) => string[];
  permiteAdicionar?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Unidade</Label>
        {permiteAdicionar && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={extras.add}>
            + unidade
          </Button>
        )}
      </div>
      <SelectComOutro value={value} onChange={onChange} options={options} manualPlaceholder="Digitar unidade" />
      {permiteAdicionar && extras.unidades.length > 0 && (
        <div className="mt-2 space-y-2">
          {extras.unidades.map((item, i) => {
            const opcoesBsp = bspOptionsFor(item.unidade || "all");
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
                <SelectComOutro
                  value={item.unidade} onChange={(v) => extras.update(i, { unidade: v, bsp: "" })}
                  options={options} placeholder="Unidade" manualPlaceholder="Digitar unidade"
                />
                <SelectComOutro
                  value={item.bsp} onChange={(v) => extras.update(i, { bsp: v })}
                  options={opcoesBsp} placeholder="BSP" manualPlaceholder="Digitar BSP" disabled={!item.unidade}
                />
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => extras.remove(i)}>✕</Button>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">Cada unidade adicionada gera um lançamento próprio com os mesmos dados.</p>
        </div>
      )}
    </div>
  );
}
