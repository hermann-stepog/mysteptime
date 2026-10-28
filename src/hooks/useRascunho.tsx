import { useCallback, useEffect, useRef, useState } from "react";
import { FileClock } from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// form_drafts ainda não está nos tipos gerados do Supabase.
const supabase: any = supabaseTyped;

// Rascunho automático de formulário (pedido dela, 2026-10-28): a partir do momento em que alguém
// começa a preencher, o conteúdo fica salvo no banco (tabela form_drafts, um por usuário por
// formulário) — não some ao fechar a janela, recarregar ou trocar de computador. Reabrir o mesmo
// formulário restaura de onde parou. Só deixa de ser rascunho quando a tela chama `limpar()`
// depois do "Salvar" dar certo.
//
// `formKey` identifica o formulário (e, na edição, o registro: "transporte:viagem:<id>"); null
// desliga o rascunho. `values` é tudo o que o formulário tem preenchido, só com dado
// serializável em JSON (arquivo anexado não entra — o navegador não deixa guardar). `restore`
// devolve esses valores pros campos.
export type RascunhoStatus = "carregando" | "vazio" | "salvando" | "salvo" | "erro";

export interface Rascunho {
  status: RascunhoStatus;
  atualizadoEm: string | null;
  restaurado: boolean;
  limpar: () => Promise<void>;
  descartar: () => void;
}

const ESPERA_MS = 800;
const PROXIMO = "__proximo__";

export function useRascunho<T>(
  formKey: string | null,
  values: T,
  restore: (v: T) => void,
): Rascunho {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<RascunhoStatus>(formKey ? "carregando" : "vazio");
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [restaurado, setRestaurado] = useState(false);

  const json = JSON.stringify(values);
  const inicialRef = useRef<string | null>(null);
  // Conteúdo do formulário ao abrir (em branco, ou o registro como está no banco na edição) —
  // voltar exatamente pra ele nunca vira rascunho.
  const abertoRef = useRef<string | null>(null);
  const carregadoRef = useRef(false);
  const limpoRef = useRef(false);
  const pendenteRef = useRef<string | null>(null);
  const ultimoGravadoRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const gravar = useCallback(
    async (dados: string) => {
      if (!formKey || !userId) return;
      pendenteRef.current = null;
      ultimoGravadoRef.current = dados;
      setStatus("salvando");
      const agora = new Date().toISOString();
      const { error } = await supabase.from("form_drafts").upsert(
        { user_id: userId, form_key: formKey, data: JSON.parse(dados), updated_at: agora },
        { onConflict: "user_id,form_key" },
      );
      if (error) {
        setStatus("erro");
        return;
      }
      setAtualizadoEm(agora);
      setStatus("salvo");
    },
    [formKey, userId],
  );

  // Carrega o rascunho existente (uma vez por formulário aberto).
  useEffect(() => {
    if (!formKey || !userId) return;
    let cancelado = false;
    inicialRef.current = json;
    abertoRef.current = json;
    ultimoGravadoRef.current = null;
    carregadoRef.current = false;
    limpoRef.current = false;
    setRestaurado(false);
    setStatus("carregando");
    (async () => {
      const { data } = await supabase
        .from("form_drafts")
        .select("data, updated_at")
        .eq("user_id", userId)
        .eq("form_key", formKey)
        .maybeSingle();
      if (cancelado) return;
      if (data?.data) {
        ultimoGravadoRef.current = JSON.stringify(data.data);
        restoreRef.current(data.data as T);
        setAtualizadoEm(data.updated_at);
        setRestaurado(true);
        setStatus("salvo");
      } else {
        setStatus("vazio");
      }
      carregadoRef.current = true;
    })();
    return () => {
      cancelado = true;
    };
    // `json` de propósito fora: o snapshot inicial é o do momento em que o formulário abriu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, userId]);

  // Depois de limpar (Salvar deu certo / Descartar), o formulário pode continuar aberto e ser
  // reaproveitado (alguns zeram os campos e seguem na tela) — a "base" passa a ser o conteúdo
  // daquele momento, e só uma mudança a partir dela vira rascunho de novo.
  const jsonRef = useRef(json);
  jsonRef.current = json;
  const novaBaseRef = useRef<string | null>(null);

  // Grava (com espera curta) sempre que o conteúdo muda e já não é mais o formulário em branco.
  useEffect(() => {
    if (!formKey || !userId || !carregadoRef.current) return;
    if (limpoRef.current) {
      if (novaBaseRef.current === null) return;
      // PROXIMO: a base é o primeiro conteúdo depois do Salvar — cobre a tela que zera os campos
      // logo em seguida (no mesmo onSuccess), sem gravar o formulário zerado como rascunho.
      inicialRef.current = novaBaseRef.current === PROXIMO ? json : novaBaseRef.current;
      novaBaseRef.current = null;
      ultimoGravadoRef.current = null;
      limpoRef.current = false;
    }
    if (json === ultimoGravadoRef.current) return;
    if (json === inicialRef.current || json === abertoRef.current) {
      // Voltou exatamente ao que era ao abrir (apagou o que tinha digitado): não sobra rascunho.
      if (timerRef.current) clearTimeout(timerRef.current);
      pendenteRef.current = null;
      if (ultimoGravadoRef.current !== null) {
        ultimoGravadoRef.current = null;
        setStatus("vazio");
        setAtualizadoEm(null);
        setRestaurado(false);
        void supabase
          .from("form_drafts")
          .delete()
          .eq("user_id", userId)
          .eq("form_key", formKey);
      }
      return;
    }
    pendenteRef.current = json;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (pendenteRef.current) void gravar(pendenteRef.current);
    }, ESPERA_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, formKey, userId, gravar]);

  // Fechou o formulário antes da espera terminar: grava o que estava pendente mesmo assim.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendenteRef.current && !limpoRef.current) void gravar(pendenteRef.current);
    },
    [gravar],
  );

  const apagar = useCallback(
    async (base: string) => {
      limpoRef.current = true;
      novaBaseRef.current = base;
      pendenteRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus("vazio");
      setAtualizadoEm(null);
      setRestaurado(false);
      if (!formKey || !userId) return;
      await supabase.from("form_drafts").delete().eq("user_id", userId).eq("form_key", formKey);
    },
    [formKey, userId],
  );

  const limpar = useCallback(() => apagar(PROXIMO), [apagar]);

  const descartar = useCallback(() => {
    const inicial = abertoRef.current ?? jsonRef.current;
    void apagar(inicial);
    restoreRef.current(JSON.parse(inicial) as T);
  }, [apagar]);

  return { status, atualizadoEm, restaurado, limpar, descartar };
}

// Aviso discreto do rascunho, pra pôr no topo/rodapé do formulário.
export function RascunhoAviso({ rascunho }: { rascunho: Rascunho }) {
  const { status, atualizadoEm, restaurado, descartar } = rascunho;
  if (status === "vazio" || status === "carregando") return null;
  const hora = atualizadoEm
    ? new Date(atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <FileClock className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold uppercase tracking-wide">Rascunho</span>
      <span>
        {status === "salvando"
          ? "salvando…"
          : status === "erro"
            ? "não foi possível salvar o rascunho agora"
            : `${restaurado ? "restaurado · " : ""}salvo automaticamente${hora ? ` às ${hora}` : ""} — só vira lançamento ao clicar em Salvar`}
      </span>
      <button
        type="button"
        onClick={descartar}
        className="ml-auto underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50"
      >
        Descartar rascunho
      </button>
    </div>
  );
}
