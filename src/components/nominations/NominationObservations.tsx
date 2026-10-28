import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { canEditNominationObservations, nominationObservationsSchema } from "@/lib/nomination-observations";
import type { Nomination } from "@/lib/nominations";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function NominationObservations({ nomination }: { nomination: Nomination }) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [savedNotes, setSavedNotes] = useState(nomination.notes ?? "");
  const [notes, setNotes] = useState(savedNotes);
  const canEdit = canEditNominationObservations(user?.id, nomination.pm_user_id, role);

  useEffect(() => {
    setSavedNotes(nomination.notes ?? "");
    setNotes(nomination.notes ?? "");
  }, [nomination.id, nomination.notes]);

  const save = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("Você não pode editar estas observações.");
      const parsed = nominationObservationsSchema.safeParse({ nominationId: nomination.id, notes });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Observações inválidas.");
      // Function-specific cast until the managed database types include this RPC.
      const { data, error } = await (supabase.rpc as any)("nomination_save_observations", {
        p_nomination_id: parsed.data.nominationId,
        p_notes: parsed.data.notes,
      });
      if (error) throw new Error("Não foi possível salvar as observações. Confira sua permissão e tente novamente.");
      return (data as string | null) ?? "";
    },
    onSuccess: (value) => {
      setSavedNotes(value);
      setNotes(value);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["pm-nominations"] });
      qc.invalidateQueries({ queryKey: ["pm-nomination-history", nomination.id] });
      notify.success("Observações salvas.");
    },
    onError: (error: Error) => notify.error(error.message),
  });

  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={editing ? id : undefined}>Observações</Label>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => { setNotes(savedNotes); setEditing(true); }}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {savedNotes ? "Editar observações" : "Incluir observações"}
          </Button>
        )}
      </div>
      {editing ? (
        <>
          <Textarea id={id} rows={3} maxLength={10000} value={notes} disabled={save.isPending}
            onChange={(event) => setNotes(event.target.value)} placeholder="Tipo de serviço a ser executado" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar observações
            </Button>
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{savedNotes || "—"}</p>
      )}
    </section>
  );
}