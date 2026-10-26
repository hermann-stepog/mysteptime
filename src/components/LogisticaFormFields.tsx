import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { MOTIVOS_LOGISTICA, FORMAS_PAGAMENTO } from "@/lib/logistica";
import { cn, matchesNameSearch, useOrdemComSelecionadosFixados } from "@/lib/utils";
import { SearchableSelect } from "@/components/SearchableSelect";
import { parseValorForm } from "@/lib/format";

// Campos de formulário compartilhados entre os módulos de logística (Hospedagem, Passagens
// Aéreas, e o que mais vier depois) — evita duplicar a mesma lógica de combobox em cada módulo.

// Autocomplete a partir de hist_novo_colaboradores, mas aceita qualquer texto digitado (ex.:
// alguém do administrativo, sem cadastro prévio) — não é uma FK, é só um texto.
// Lista com seleção por digitação das primeiras letras (mesmo comportamento do campo Motivo),
// com escape "Outro (digitar)..." para valores fora da lista.
export function ListaDigitavelField({ value, onChange, options, placeholder = "Selecione", manualPlaceholder = "Digitar" }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; manualPlaceholder?: string;
}) {
  const [manual, setManual] = useState(value !== "" && !options.includes(value));
  if (manual) {
    return (
      <div className="flex gap-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={manualPlaceholder} />
        <Button type="button" variant="ghost" size="sm" onClick={() => { setManual(false); onChange(""); }}>Lista</Button>
      </div>
    );
  }
  return (
    <SearchableSelect
      value={value}
      onValueChange={(v) => { if (v === "__outro__") { setManual(true); return; } onChange(v); }}
      options={[...options, { value: "__outro__", label: "Outro (digitar)..." }]}
      placeholder={placeholder}
    />
  );
}

// hist_novo_colaboradores tem registros "sujos" vindos de contratos antigos sem nome
// identificado de verdade (tipo "[LEGADO NÃO IDENTIFICADO]900322_3") — nunca são uma pessoa de
// carne e osso, então nunca devem aparecer como sugestão em nenhum campo de nome (pedido dela,
// 2026-10-22). Detecta pelo colchete no início, que nome real nunca tem.
function ehNomeInvalido(nome: string): boolean {
  return nome.trim().startsWith("[");
}

function nomesUnicos(colaboradores: { nome: string }[]): string[] {
  const vistos = new Set<string>(); const out: string[] = [];
  for (const c of colaboradores) {
    const n = c.nome.trim(); const k = n.toUpperCase();
    if (!n || ehNomeInvalido(n) || vistos.has(k)) continue; vistos.add(k); out.push(n);
  }
  return out.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// hist_novo_colaboradores tem 1 linha por empresa+matrícula — a mesma pessoa que já passou por
// mais de um contrato/empresa aparece mais de uma vez com o mesmo nome. Pra campos de texto
// livre (não referenciam o id) isso não importa — desduplica por nome antes de listar.
function colaboradoresUnicosPorNome(colaboradores: { id: string; nome: string }[]): { id: string; nome: string }[] {
  const vistos = new Set<string>();
  return colaboradores.filter((c) => {
    const chave = c.nome.trim().toUpperCase();
    if (!c.nome.trim() || ehNomeInvalido(c.nome) || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// Botão "Limpar busca" dentro do próprio campo de busca (pedido dela, 2026-10-20) — some quando
// não há texto digitado.
function BotaoLimparBusca({ search, onClear }: { search: string; onClear: () => void }) {
  if (!search) return null;
  return (
    <button
      type="button"
      className="mr-2 shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
    >
      Limpar busca
    </button>
  );
}

// Pedido dela (2026-10-20): puxa TODO colaborador do Drake (sem limite de sugestões, antes
// cortava em 20), sugere enquanto digita, e rola direito dentro de um Dialog — mesma correção de
// scroll-lock do Radix Dialog que o CommandList compartilhado já tem (onWheel manual), aplicada
// aqui também, sem reestruturar o campo pra dentro de um Command/cmdk (continua sendo texto
// livre — digitar qualquer coisa fora da lista é aceito, não é obrigatório escolher da lista).
export function NomeUsuarioField({ value, onChange, colaboradores, placeholder = "Nome de quem vai utilizar", inputClassName }: {
  value: string; onChange: (v: string) => void; colaboradores: { id: string; nome: string }[]; placeholder?: string; inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const colaboradoresUnicos = useMemo(() => colaboradoresUnicosPorNome(colaboradores), [colaboradores]);
  const sugestoes = useMemo(() => {
    const q = value.trim();
    return q ? colaboradoresUnicos.filter((c) => matchesNameSearch(c.nome, q)) : colaboradoresUnicos;
  }, [value, colaboradoresUnicos]);

  return (
    <Popover open={open && sugestoes.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            type="text"
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              // Mesmo comportamento do combobox de Colaborador em Transporte: digitar as
              // primeiras letras e apertar Enter já escolhe a primeira sugestão da lista.
              if (e.key === "Enter" && sugestoes.length > 0) {
                e.preventDefault();
                onChange(sugestoes[0].nome);
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            autoComplete="off"
            className={cn(inputClassName, value && "pr-7")}
          />
          {value && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange("")}
              title="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div
          className="max-h-64 overflow-auto"
          onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; e.stopPropagation(); e.preventDefault(); }}
        >
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

// Combobox multi-select de verdade (um valor = lista de nomes dentro do MESMO registro — não
// confundir com NomeUsuarioMultiField abaixo, que gera um lançamento separado por colaborador).
// Pedido dela, 2026-10-20: poder escolher vários colaboradores no mesmo lançamento de
// Reembolso/Nota de Débito, com badges removíveis igual ao CollaboratorMultiSelect de
// Transporte — mas aqui por nome/texto livre vindo do Drake, não por id de uma tabela própria.
export function ColaboradoresDrakeMultiField({ value, onChange, colaboradores, placeholder = "Selecionar colaboradores" }: {
  value: string[]; onChange: (v: string[]) => void; colaboradores: { id: string; nome: string }[]; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const colaboradoresUnicos = useMemo(() => colaboradoresUnicosPorNome(colaboradores), [colaboradores]);
  const toggle = (nome: string) => onChange(value.includes(nome) ? value.filter((v) => v !== nome) : [...value, nome]);
  const ordenados = useOrdemComSelecionadosFixados(colaboradoresUnicos, open, (c) => value.includes(c.nome));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{value.length ? `${value.length} selecionado(s)` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
          <Command filter={(itemValue, s) => (matchesNameSearch(itemValue, s) ? 1 : 0)}>
            <div className="flex items-center border-b">
              <CommandInput placeholder="Buscar colaborador..." value={search} onValueChange={setSearch} className="border-0" />
              <BotaoLimparBusca search={search} onClear={() => setSearch("")} />
            </div>
            <CommandList className="max-h-64">
              <CommandEmpty>Nenhum encontrado.</CommandEmpty>
              <CommandGroup>
                {ordenados.map((c) => (
                  <CommandItem key={c.id} value={c.nome} onSelect={() => toggle(c.nome)}>
                    <Check className={cn("mr-2 h-4 w-4", value.includes(c.nome) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{c.nome}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((nome) => (
            <Badge key={nome} variant="secondary" className="gap-1 pr-1">
              <span>{nome}</span>
              <button type="button" onClick={() => toggle(nome)} className="hover:text-destructive" title="Remover">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// Combobox de Motivo (lista + "Outro" pra digitar) — MOTIVOS_LOGISTICA por padrão (Transporte/
// Hospedagem/Passagens), mas aceita uma lista própria via `options` (ex.: MOTIVOS_REEMBOLSO em
// Despesas Extras, que tem "Reunião" e não faz sentido misturar com a lista de embarque).
export function MotivoField({
  value,
  onChange,
  options = MOTIVOS_LOGISTICA,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: readonly string[];
}) {
  const [manual, setManual] = useState(value !== "" && !options.includes(value));
  if (manual) {
    return (
      <div className="flex gap-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Motivo" />
        <Button type="button" variant="ghost" size="sm" onClick={() => { setManual(false); onChange(""); }}>Lista</Button>
      </div>
    );
  }
  return (
    <SearchableSelect
      value={value}
      onValueChange={(v) => { if (v === "__outro__") { setManual(true); return; } onChange(v); }}
      options={[...options, { value: "__outro__", label: "Outro (digitar)..." }]}
      placeholder="Selecione"
    />
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
    <SearchableSelect
      value={value}
      disabled={disabled}
      onValueChange={(v) => { if (v === "__outro__") { setManual(true); onChange(""); return; } onChange(v); }}
      options={[...options, { value: "__outro__", label: "Outro (digitar)..." }]}
      placeholder={placeholder}
    />
  );
}

// Forma de pagamento (Cartão de Crédito / Faturado) — lista fixa, sem opção "Outro", usada
// em Transporte/Hospedagem/Passagens Aéreas. Campo opcional (não força refazer lançamentos antigos).
export function FormaPagamentoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SearchableSelect
      value={value || "__nenhum__"}
      onValueChange={(v) => onChange(v === "__nenhum__" ? "" : v)}
      options={[{ value: "__nenhum__", label: "—" }, ...FORMAS_PAGAMENTO]}
      placeholder="Selecione"
    />
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

  const total = parseValorForm(valorTotal) ?? 0;
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
              type="text" inputMode="decimal"
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
  function replace(items: PessoaAdicional[]) { setPessoas(items); }
  function reset() { setPessoas([]); }
  const validas = pessoas.filter((p) => p.nome.trim() !== "");
  return { pessoas, add, update, remove, replace, reset, validas };
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
export function NomeUsuarioMultiField({
  label = "Nome do usuário", value, onChange, colaboradores, extras, permiteAdicionar = true, modoLista = false,
  helpText = "Cada colaborador adicionado gera um lançamento próprio com os mesmos dados.",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  colaboradores: { id: string; nome: string }[];
  extras: UsePessoasAdicionaisReturn;
  permiteAdicionar?: boolean;
  helpText?: string;
  modoLista?: boolean;
}) {
  const nomes = useMemo(() => (modoLista ? nomesUnicos(colaboradores) : []), [modoLista, colaboradores]);
  const Campo = ({ v, set }: { v: string; set: (x: string) => void }) => modoLista
    ? <ListaDigitavelField value={v} onChange={set} options={nomes} placeholder="Nome de quem vai utilizar" manualPlaceholder="Nome de quem vai utilizar" />
    : <NomeUsuarioField value={v} onChange={set} colaboradores={colaboradores} />;
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
      {Campo({ v: value, set: onChange })}
      {permiteAdicionar && extras.pessoas.length > 0 && (
        <div className="mt-2 space-y-2">
          {extras.pessoas.map((p, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="flex-1">
                {Campo({ v: p.nome, set: (v) => extras.update(i, { nome: v }) })}
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => extras.remove(i)}>✕</Button>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">{helpText}</p>
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
  function replace(items: UnidadeAdicional[]) { setUnidades(items); }
  function reset() { setUnidades([]); }
  const validas = unidades.filter((u) => u.unidade.trim() !== "");
  return { unidades, add, update, remove, replace, reset, validas };
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
