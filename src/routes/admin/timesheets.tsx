import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, downloadCSV } from "@/lib/format";
import { toast } from "sonner";
import { Check, X, Download } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/admin/timesheets")({ component: TimesheetsPage });

function TimesheetsPage() {
  const qc = useQueryClient();
  const [comments, setComments] = useState<Record<string, string>>({});

  const { data: rows } = useQuery({
    queryKey: ["admin-timesheets"],
    queryFn: async () => (await supabase.from("timesheets").select("*, profiles!collaborator_id(full_name), projects(code, name)").eq("status", "submitted").order("work_date")).data ?? [],
  });

  const decide = useMutation({
    mutationFn: async ({ id, approve, comment }: { id: string; approve: boolean; comment?: string }) => {
      const { error } = await supabase.from("timesheets").update({
        status: approve ? "approved" : "rejected",
        reject_comment: approve ? null : comment ?? null,
        validated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-timesheets"] }); toast.success("Decisão registrada"); },
  });

  const exportApproved = async () => {
    const { data } = await supabase.from("timesheets").select("*, profiles!collaborator_id(full_name, email), projects(code, name)").eq("status", "approved");
    const rows = (data ?? []).map((r: any) => ({
      colaborador: r.profiles?.full_name, email: r.profiles?.email, projeto: r.projects?.code,
      data: r.work_date, atividade: r.activity_type, horas: r.hours, validado_em: r.validated_at,
    }));
    downloadCSV(`timesheets_aprovados_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Validação de timesheets</h1><p className="text-sm text-muted-foreground">Pendentes de aprovação.</p></div>
        <Button variant="outline" onClick={exportApproved}><Download className="mr-2 h-4 w-4" />Exportar aprovados (CSV)</Button>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Colaborador</TableHead><TableHead>Data</TableHead><TableHead>Projeto</TableHead><TableHead>Atividade</TableHead><TableHead>Horas</TableHead><TableHead>Comentário</TableHead><TableHead className="text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                <TableCell>{fmtDate(r.work_date)}</TableCell>
                <TableCell>{r.projects?.code ?? "—"}</TableCell>
                <TableCell>{r.activity_type}</TableCell>
                <TableCell>{r.hours}</TableCell>
                <TableCell><Textarea rows={1} value={comments[r.id] ?? ""} onChange={(e) => setComments({ ...comments, [r.id]: e.target.value })} placeholder="Motivo (rejeição)" /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, approve: false, comment: comments[r.id] })}><X className="h-4 w-4" /></Button>
                    <Button size="sm" onClick={() => decide.mutate({ id: r.id, approve: true })}><Check className="h-4 w-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sem timesheets pendentes.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
