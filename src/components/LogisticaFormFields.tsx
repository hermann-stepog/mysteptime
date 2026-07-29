import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MOTIVOS_LOGISTICA } from "@/lib/logistica";

// Campos de formulário compartilhados entre os módulos de logística (Hospedagem, Passagens
// Aéreas, e o que mais vier depois) — evita duplicar a mesma lógica de combobox em cada módulo.

// Autocomplete a partir de hist_novo_colaboradores, mas aceita qualquer texto digitado (ex.:
// alguém do administrativo, sem cadastro prévio) — não é uma FK, é só um texto.
export function NomeUsuarioField({ value, onChange, colaboradores }: {
  value: string; onChange: (v: string) => void; colaboradores: { id: string; nome: string }[];
}) {
  const [open, setOpen] = useState(false);
  const sugestoes = useMemo(() => {
    const q = value.trim().toLowerCase();
    const lista = q ? colaboradores.filter((c) => c.nome.toLowerCase().includes(q)) : colaboradores;
    return lista.slice(0, 20);
  }, [value, colaboradores]);

  return (
    <Popover open={open && sugestoes.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
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
