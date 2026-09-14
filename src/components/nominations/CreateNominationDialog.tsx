import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas nominations/nomination_nominees/colaborador_funcoes_historico ainda não estão nos
// tipos gerados; cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import { type Nomination, isSoldador } from "@/lib/nominations";
import { notifyStageAdvance } from "@/lib/nominationEmails";
import { SearchableSelect } from "@/components/SearchableSelect";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { CLIENTES, clienteDaUnidade } from "@/lib/clientes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Upload, X } from "lucide-react";
import { notify } from "@/lib/notify";

// Formulário de "Nova Solicitação de Nomeação" — usado tanto no ambiente do Solicitante (PM,
// ver src/routes/pm/index.tsx) quanto no ambiente da Logística (ver src/routes/admin/
// nominations.tsx). Extraído pra um módulo à parte (em vez de um importar do outro) porque
// pm/index.tsx já importa NominationsPage de admin/nominations.tsx — um import na direção
// contrária criaria uma dependência circular entre as duas rotas.

// O id do usuário guardado em memória pode ficar defasado quando a sessão expira/é renovada
// enquanto o formulário está aberto — nesse caso a gravação era recusada pelas regras de
// acesso do banco (pm_user_id precisa ser igual ao usuário da sessão). Relê a sessão atual na
// hora de salvar e, se não houver mais sessão, avisa pra entrar de novo.
export async function currentAuthUserId(): Promise<string> {
  const { data, error } = await supabaseTyped.auth.getUser();
  if (error || !data.user) {
    throw new Error("Sua sessão expirou. Entre novamente para enviar a solicitação.");
  }
  return data.user.id;
}

// Uma solicitação pode pedir várias funções de uma vez — os campos comuns (unidade/BSP/
// período/projeto/cliente) são compartilhados, mas cada linha de função vira sua própria
// nomeação no banco/kanban (cada uma segue seu próprio fluxo de aprovação/nomeação). Soldador
// não pede tipo de solda/material em lista — em vez disso, anexa o escopo do serviço
// (documento) pra Qualidade avaliar e aprovar a qualificação a partir dele.
export interface FuncaoLinha { funcao: string; quantidade: string; scopeFile: File | null }
export function novaLinhaFuncao(): FuncaoLinha {
  return { funcao: "", quantidade: "1", scopeFile: null };
}

export const SCOPE_DOCUMENT_TYPES = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
const SCOPE_DOCUMENT_MAX_SIZE = 20 * 1024 * 1024;
export const SCOPE_BUCKET = "nomeacoes-anexos";

export async function uploadScopeDocument(file: File): Promise<{ path: string; name: string }> {
  if (!SCOPE_DOCUMENT_TYPES.split(",").includes(file.type)) {
    throw new Error("Formato não aceito. Envie PDF, Word, JPEG ou PNG.");
  }
  if (file.size > SCOPE_DOCUMENT_MAX_SIZE) throw new Error("Arquivo muito grande (máximo 20MB).");
  const nomeSeguro = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${crypto.randomUUID()}-${nomeSeguro}`;
  const { error } = await supabase.storage.from(SCOPE_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return { path, name: file.name };
}

// Dados de referência do formulário (funções conhecidas, unidades/BSPs vindos do Drake) — um
// só lugar pra não duplicar as mesmas consultas entre quem usa este diálogo.
export function useNominationFormData() {
  const { data: funcoesHistorico = [] } = useQuery<{ funcao: string }[]>({
    queryKey: ["create-nomination-funcoes-historico"],
    queryFn: () =>
      selectAllPages((from, to) =>
        supabase.from("colaborador_funcoes_historico").select("funcao").order("data_inicio", { ascending: false }).range(from, to),
      ),
  });
  const { data: colaboradores = [] } = useQuery<{ funcao: string | null; funcao_operacao: string | null }[]>({
    queryKey: ["create-nomination-colaboradores-funcoes"],
    queryFn: async () => (await supabase.from("hist_novo_colaboradores").select("funcao, funcao_operacao")).data ?? [],
  });
  const funcaoOptions = useMemo(() => {
    const s = new Set<string>();
    funcoesHistorico.forEach((f) => f.funcao && s.add(f.funcao));
    colaboradores.forEach((c) => { if (c.funcao_operacao) s.add(c.funcao_operacao); if (c.funcao) s.add(c.funcao); });
    return Array.from(s).sort();
  }, [funcoesHistorico, colaboradores]);

  const { data: periodos = [] } = useQuery<HistNovoPeriodo[]>({
    queryKey: ["create-nomination-periodos"],
    queryFn: () =>
      selectAllPages<HistNovoPeriodo>((from, to) =>
        supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("data_inicio").range(from, to),
      ),
  });
  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);

  // O Drake grava a mesma unidade com grafias diferentes ao longo do tempo (ex.: "BRAVO" num
  // período, "Bravo" ou "bravo" noutro) — agrupa por chave maiúscula pra não duplicar a mesma
  // unidade na lista, e guarda as grafias reais de cada grupo pra filtrar o BSP corretamente
  // (bspOptionsForUnidade precisa das grafias como estão gravadas, não da versão exibida).
  const unidadeGroups = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toUpperCase();
      if (!m.has(key)) m.set(key, new Set());
      m.get(key)!.add(trimmed);
    };
    UNIDADES_OPERACIONAIS_FIXAS.forEach(add);
    periodos.forEach((p) => { if (p.unidade_operacional) add(p.unidade_operacional); });
    return m;
  }, [periodos]);

  // Exibição normalizada: só a primeira letra maiúscula — nunca altera o que está gravado no
  // banco, só como aparece na lista/valor selecionado.
  const unidadeOptions = useMemo(
    () => Array.from(unidadeGroups.keys()).map((k) => k.charAt(0) + k.slice(1).toLowerCase()).sort(),
    [unidadeGroups],
  );

  return { funcaoOptions, periodosE, unidadeGroups, unidadeOptions };
}

export function CreateNominationDialog({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [linhas, setLinhas]         = useState<FuncaoLinha[]>([novaLinhaFuncao()]);
  const [unidade, setUnidade]       = useState("");
  const [bsp, setBsp]               = useState("");
  const [start, setStart]           = useState("");
  const [end, setEnd]               = useState("");
  const [client, setClient]         = useState("");
  const [notes, setNotes]           = useState("");

  const updateLinha = (i: number, patch: Partial<FuncaoLinha>) => {
    setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLinha = () => setLinhas((atual) => [...atual, novaLinhaFuncao()]);
  const removeLinha = (i: number) => setLinhas((atual) => (atual.length > 1 ? atual.filter((_, idx) => idx !== i) : atual));

  const { funcaoOptions, periodosE, unidadeGroups, unidadeOptions } = useNominationFormData();
  const bspOptions = useMemo(() => {
    if (!unidade) return bspOptionsForUnidade(periodosE, "all");
    const variantes = Array.from(unidadeGroups.get(unidade.toUpperCase()) ?? [unidade]);
    return bspOptionsForUnidade(periodosE, variantes);
  }, [periodosE, unidade, unidadeGroups]);

  const create = useMutation({
    mutationFn: async () => {
      const validas = linhas.filter((l) => l.funcao.trim());
      if (validas.length === 0) throw new Error("Adicione ao menos uma função.");
      if (!unidade) throw new Error("Selecione a unidade.");
      if (!bsp) throw new Error("Selecione a BSP.");
      const pmName = profile?.full_name ?? profile?.email ?? "Solicitante";
      const pmUserId = await currentAuthUserId();
      // Um id só pra todas as funções desta solicitação — "Minhas Solicitações" agrupa por
      // ele de volta num único cartão, mesmo cada função seguindo seu próprio fluxo aqui.
      const groupId = crypto.randomUUID();

      // Uma nomeação por função — cada uma segue seu próprio fluxo de aprovação/nomeação, por
      // isso não dá pra combinar num só registro. Soldador sempre passa pela Qualidade — ela
      // decide olhando o escopo do serviço anexado, não mais um tipo de solda/material
      // escolhido em lista.
      for (const l of validas) {
        const isWelder = isSoldador(l.funcao);
        const scopeDocument = l.scopeFile ? await uploadScopeDocument(l.scopeFile) : null;

        const { data, error } = await supabase
          .from("nominations")
          .insert({
            pm_user_id:                 pmUserId,
            pm_name:                    pmName,
            request_group_id:           groupId,
            funcao:                     l.funcao.trim(),
            quantidade:                 Math.max(1, Number(l.quantidade) || 1),
            unidade,
            bsp,
            weld_type:                  null,
            weld_material:               null,
            scope_document_path:        scopeDocument?.path ?? null,
            scope_document_name:        scopeDocument?.name ?? null,
            period_start:               start || null,
            period_end:                 end || null,
            project:                    null,
            client:                     client || null,
            notes:                      notes.trim() || null,
            requires_quality_validation: isWelder,
            current_status:              "solicitacao",
          })
          .select()
          .single();
        if (error) throw error;

        await supabase.from("nomination_status_history").insert({
          nomination_id:   data.id,
          status:          "solicitacao",
          changed_by_name: pmName,
          notes:           "Solicitação criada pelo solicitante",
        });
        await notifyStageAdvance(data as Nomination, "solicitacao");
      }
    },
    onSuccess: () => {
      const n = linhas.filter((l) => l.funcao.trim()).length;
      notify.success(n > 1 ? `${n} solicitações enviadas.` : "Solicitação enviada.");
      // Invalida as duas fontes possíveis (ambiente do Solicitante e da Logística) — não custa
      // invalidar uma query que não existe na tela atual.
      qc.invalidateQueries({ queryKey: ["pm-nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations"] });
      onClose();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao criar solicitação."),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Solicitação de Nomeação</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-3">
            {linhas.map((l, i) => {
              const isWelder = isSoldador(l.funcao);
              return (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="grid grid-cols-[1fr_90px_auto] items-end gap-3">
                    <div className="space-y-1">
                      <Label>Função *</Label>
                      <SearchableSelect
                        value={l.funcao}
                        onValueChange={(v) => updateLinha(i, { funcao: v, scopeFile: null })}
                        options={funcaoOptions}
                        placeholder="Buscar função..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Qtd. *</Label>
                      <Input type="number" min={1} value={l.quantidade} onChange={(e) => updateLinha(i, { quantidade: e.target.value })} />
                    </div>
                    {linhas.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeLinha(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {isWelder && (
                    <div className="space-y-1">
                      <Label className="text-xs">Escopo do serviço (PDF, Word, JPEG ou PNG)</Label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
                        <Upload className="h-3.5 w-3.5 shrink-0" />
                        {l.scopeFile ? l.scopeFile.name : "Selecionar arquivo..."}
                        <input
                          type="file" accept={SCOPE_DOCUMENT_TYPES} className="hidden"
                          onChange={(e) => updateLinha(i, { scopeFile: e.target.files?.[0] ?? null })}
                        />
                      </label>
                      <p className="text-[11px] text-muted-foreground">
                        {l.scopeFile
                          ? "A Qualidade avalia o tipo de solda a partir deste documento antes de aprovar."
                          : `Sem documento? Descreva o tipo de serviço no campo Observações abaixo (indicando a função "${l.funcao}").`}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={addLinha}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar função
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Unidade *</Label>
              <Select value={unidade} onValueChange={(v) => { setUnidade(v); setBsp(""); setClient(clienteDaUnidade(v) ?? ""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>BSP *</Label>
              <Select value={bsp} onValueChange={setBsp} disabled={!unidade}>
                <SelectTrigger><SelectValue placeholder={unidade ? "Selecione" : "Escolha a unidade"} /></SelectTrigger>
                <SelectContent>
                  {bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Data início</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data fim</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Cliente</Label>
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Enviar solicitação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
