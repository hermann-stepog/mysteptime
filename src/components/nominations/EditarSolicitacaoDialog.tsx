import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Upload, FileText } from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRascunho, RascunhoAviso } from "@/hooks/useRascunho";
import { type Nomination, isSoldador, requestTitle } from "@/lib/nominations";
import { notifyRequestCreated } from "@/lib/nominationEmails";
import { CLIENTES, clienteDaUnidade } from "@/lib/clientes";
import { notify } from "@/lib/notify";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useNominationFormData, uploadScopeDocument, currentAuthUserId, SCOPE_DOCUMENT_TYPES, SCOPE_BUCKET,
} from "@/components/nominations/CreateNominationDialog";

// Formulário "Editar solicitação" — saiu de src/routes/pm/index.tsx pra ser usado também pela
// Logística de Pessoal no card do kanban de Nomeações (NominationsPage.tsx importa daqui, sem
// import circular com a rota do PM).

// nominations ainda não está nos tipos gerados do Supabase; cast local (mesmo da rota do PM).
const supabase: any = supabaseTyped;

export async function baixarEscopoDocumento(path: string, nomeOriginal: string): Promise<void> {
  const { data, error } = await supabase.storage.from(SCOPE_BUCKET).download(path);
  if (error) { notify.error(error.message); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = nomeOriginal;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Editar a solicitação inteira (todas as funções de uma vez) ─────────────────
// Mesma forma do CreateDialog (linhas de função + campos compartilhados), pré-preenchida com
// as funções já existentes do grupo. Permite editar campos compartilhados, editar/remover
// funções existentes e adicionar novas — tudo sob o mesmo request_group_id. O Solicitante (PM)
// só chega aqui enquanto tudo está em "Solicitação" (gate no GroupDetailDialog / ManageDialog);
// a Logística de Pessoal também edita pelo card do kanban (pedido dela, 2026-10-29), em
// "Solicitação" e "Logística de Pessoal".
interface GroupLinha {
  id: string | null;
  funcao: string;
  quantidade: string;
  scopeFile: File | null;
  existingScopePath: string | null;
  existingScopeName: string | null;
}

export function EditGroupDialog({ items, onClose, onSaved }: { items: Nomination[]; onClose: () => void; onSaved: () => void }) {
  const { profile, role } = useAuth();
  const ehSolicitante = role === "pm";
  const qc = useQueryClient();
  const primeiro = items[0];

  const [linhas, setLinhas] = useState<GroupLinha[]>(
    items.map((n) => ({
      id: n.id, funcao: n.funcao, quantidade: String(n.quantidade), scopeFile: null,
      existingScopePath: n.scope_document_path, existingScopeName: n.scope_document_name,
    })),
  );
  const [unidade, setUnidade] = useState(primeiro.unidade ?? "");
  const [bsp, setBsp]         = useState(primeiro.bsp ?? "");
  const [start, setStart]     = useState(primeiro.period_start ?? "");
  const [end, setEnd]         = useState(primeiro.period_end ?? "");
  const [client, setClient]   = useState(primeiro.client ?? "");
  const [notes, setNotes]     = useState(primeiro.notes ?? "");
  // Rascunho automático da edição do grupo (ver useRascunho) — anexo novo não entra.
  const rascunho = useRascunho(
    `nomeacao:editar-grupo:${primeiro.request_group_id ?? primeiro.id}`,
    {
      linhas: linhas.map(({ scopeFile: _f, ...l }) => l),
      unidade, bsp, start, end, client, notes,
    },
    (v) => {
      setLinhas(v.linhas.map((l) => ({ ...l, scopeFile: null })));
      setUnidade(v.unidade); setBsp(v.bsp); setStart(v.start); setEnd(v.end);
      setClient(v.client); setNotes(v.notes);
    },
  );

  const updateLinha = (i: number, patch: Partial<GroupLinha>) => {
    setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLinha = () => setLinhas((atual) => [...atual, { id: null, funcao: "", quantidade: "1", scopeFile: null, existingScopePath: null, existingScopeName: null }]);
  const removeLinha = (i: number) => setLinhas((atual) => (atual.length > 1 ? atual.filter((_, idx) => idx !== i) : atual));

  const { funcaoOptions, unidadeGroups, unidadeOptions } = useNominationFormData();
  const bspOptions = useMemo(() => {
    if (!unidade) {
      const todos = new Set<string>();
      unidadeGroups.forEach((g) => g.bsps.forEach((b) => todos.add(b)));
      return Array.from(todos).sort();
    }
    // A BSP já gravada continua na lista mesmo que não venha do Planejamento (ex.: unidade fixa
    // "Bravo", cuja BSP foi digitada em "+ Inserir nova BSP" na criação).
    const lista = new Set(unidadeGroups.get(unidade.toUpperCase())?.bsps ?? []);
    if (bsp && unidade === primeiro.unidade) lista.add(bsp);
    return Array.from(lista).sort();
  }, [unidade, unidadeGroups, bsp, primeiro.unidade]);

  const save = useMutation({
    mutationFn: async () => {
      const validas = linhas.filter((l) => l.funcao.trim());
      if (validas.length === 0) throw new Error("Adicione ao menos uma função.");
      if (!unidade) throw new Error("Selecione a unidade.");
      if (!bsp) throw new Error("Selecione a BSP.");
      const quem = profile?.full_name ?? profile?.email ?? (ehSolicitante ? "Solicitante" : "Logística");
      const pmUserId = await currentAuthUserId();
      // Função nova herda o solicitante e a etapa da solicitação (quando é a Logística editando,
      // não vira solicitação dela nem volta pra "Solicitação" separada do resto do card).
      const herdado = {
        pm_user_id: primeiro.pm_user_id ?? pmUserId,
        pm_name: primeiro.pm_name ?? quem,
        pm_responsavel: primeiro.pm_responsavel,
        current_status: primeiro.current_status,
        logistics_received_at: primeiro.logistics_received_at,
        logistics_received_by: primeiro.logistics_received_by,
      };
      // Solicitações antigas (de antes do agrupamento existir) não têm request_group_id — ao
      // salvar aqui, todas as funções do grupo ganham um de uma vez, pra passar a se comportar
      // como uma solicitação única daqui em diante (kanban, Minhas Solicitações etc.).
      const groupId = primeiro.request_group_id ?? crypto.randomUUID();

      const idsMantidos = new Set(validas.filter((l) => l.id).map((l) => l.id));
      const removidos = items.filter((n) => !idsMantidos.has(n.id));
      if (removidos.length > 0) {
        const { error } = await supabase.from("nominations").delete().in("id", removidos.map((n) => n.id));
        if (error) throw error;
      }

      const novas: Nomination[] = [];
      for (const l of validas) {
        const isWelder = isSoldador(l.funcao);
        const scopeDocument = l.scopeFile ? await uploadScopeDocument(l.scopeFile) : null;
        const camposComuns = {
          unidade, bsp,
          period_start: start || null,
          period_end: end || null,
          client: client || null,
          notes: notes.trim() || null,
        };

        if (l.id) {
          const { data: atualizadas, error } = await supabase.from("nominations").update({
            ...camposComuns,
            request_group_id: groupId,
            funcao: l.funcao.trim(),
            quantidade: Math.max(1, Number(l.quantidade) || 1),
            requires_quality_validation: isWelder,
            ...(scopeDocument ? { scope_document_path: scopeDocument.path, scope_document_name: scopeDocument.name } : {}),
          }).eq("id", l.id).select("id");
          if (error) throw error;
          // RLS bloqueando UPDATE não dá erro, só volta 0 linhas — sem isso a tela dizia
          // "Solicitação atualizada" sem ter salvo nada (mesmo caso de excluirSolicitacoes).
          if (!atualizadas?.length) {
            throw new Error("Não foi possível salvar: a solicitação mudou de etapa ou você não tem permissão para editá-la.");
          }
          await supabase.from("nomination_status_history").insert({
            nomination_id: l.id,
            status: items.find((n) => n.id === l.id)?.current_status ?? primeiro.current_status,
            changed_by_name: quem,
            notes: ehSolicitante ? "Solicitação editada pelo solicitante" : `Solicitação editada por ${quem}`,
          });
        } else {
          const { data, error } = await supabase.from("nominations").insert({
            ...herdado,
            request_group_id: groupId,
            ...camposComuns,
            funcao: l.funcao.trim(),
            quantidade: Math.max(1, Number(l.quantidade) || 1),
            weld_type: null,
            weld_material: null,
            scope_document_path: scopeDocument?.path ?? null,
            scope_document_name: scopeDocument?.name ?? null,
            project: null,
            requires_quality_validation: isWelder,
          }).select().single();
          if (error) throw error;
          await supabase.from("nomination_status_history").insert({
            nomination_id: data.id, status: herdado.current_status, changed_by_name: quem, notes: "Função adicionada à solicitação",
          });
          novas.push(data as Nomination);
        }
      }
      await notifyRequestCreated(novas);
    },
    onSuccess: () => {
      notify.success("Solicitação atualizada.");
      qc.invalidateQueries({ queryKey: ["pm-nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations"] });
      void rascunho.limpar();
      onSaved();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao atualizar solicitação."),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar solicitação {requestTitle(primeiro)}</DialogTitle>
        </DialogHeader>
        <RascunhoAviso rascunho={rascunho} />

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
                      {l.existingScopePath && !l.scopeFile && (
                        <button
                          type="button" className="mb-1 flex items-center gap-1.5 text-xs text-primary hover:underline"
                          onClick={() => baixarEscopoDocumento(l.existingScopePath!, l.existingScopeName ?? "escopo-do-servico")}
                        >
                          <FileText className="h-3.5 w-3.5" /> {l.existingScopeName ?? "Ver documento atual"}
                        </button>
                      )}
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
                        <Upload className="h-3.5 w-3.5 shrink-0" />
                        {l.scopeFile ? l.scopeFile.name : l.existingScopePath ? "Substituir arquivo..." : "Selecionar arquivo..."}
                        <input
                          type="file" accept={SCOPE_DOCUMENT_TYPES} className="hidden"
                          onChange={(e) => updateLinha(i, { scopeFile: e.target.files?.[0] ?? null })}
                        />
                      </label>
                      <p className="text-[11px] text-muted-foreground">
                        {l.scopeFile || l.existingScopePath
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
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>BSP *</Label>
              <Select value={bsp} onValueChange={setBsp} disabled={!unidade}>
                <SelectTrigger><SelectValue placeholder={unidade ? "Selecione" : "Escolha a unidade"} /></SelectTrigger>
                <SelectContent>{bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
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
          <Button onClick={() => save.mutate()} loading={save.isPending}>Salvar alterações</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
