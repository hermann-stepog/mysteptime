import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Ship, Truck, Hotel, Bell } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/app/schedule")({ component: Schedule });

function Schedule() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: embarks } = useQuery({ queryKey: ["my-embarks"], queryFn: async () => (await supabase.from("embarkations").select("*, clients(name), projects(code)").eq("collaborator_id", user!.id).order("embark_date", { ascending: false }).limit(10)).data ?? [] });
  const { data: transports } = useQuery({ queryKey: ["my-transport"], queryFn: async () => (await supabase.from("transport_requests").select("*, vendors(name)").eq("collaborator_id", user!.id).order("scheduled_at", { ascending: false }).limit(10)).data ?? [] });
  const { data: hotels } = useQuery({ queryKey: ["my-hotel"], queryFn: async () => (await supabase.from("hotel_bookings").select("*").eq("collaborator_id", user!.id).order("check_in", { ascending: false }).limit(10)).data ?? [] });
  const { data: notifs } = useQuery({ queryKey: ["my-notifs"], queryFn: async () => (await supabase.from("notifications").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(20)).data ?? [] });

  const markRead = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifs"] }),
  });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Agenda &amp; Notificações</h1>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Bell className="h-4 w-4" />Notificações</h2>
        <div className="space-y-2">
          {(notifs ?? []).map((n) => (
            <Card key={n.id} className={`p-3 ${!n.read ? "border-primary/40 bg-primary/5" : ""}`} onClick={() => !n.read && markRead.mutate(n.id)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground mt-1">{n.body}</div>}
                </div>
                {!n.read && <StatusBadge tone="primary">Nova</StatusBadge>}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{fmtDateTime(n.created_at)}</div>
            </Card>
          ))}
          {(notifs ?? []).length === 0 && <Card className="p-4 text-center text-sm text-muted-foreground">Sem notificações.</Card>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Ship className="h-4 w-4" />Embarques</h2>
        <div className="space-y-2">
          {(embarks ?? []).map((e: any) => (
            <Card key={e.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{fmtDate(e.embark_date)} · {e.clients?.name ?? "—"}</div>
                <StatusBadge tone="primary">{e.status}</StatusBadge>
              </div>
              {e.pre_embark_instructions && <div className="mt-1 text-xs text-muted-foreground">{e.pre_embark_instructions}</div>}
            </Card>
          ))}
          {(embarks ?? []).length === 0 && <Card className="p-4 text-center text-sm text-muted-foreground">Sem embarques.</Card>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Truck className="h-4 w-4" />Transporte</h2>
        <div className="space-y-2">
          {(transports ?? []).map((t: any) => (
            <Card key={t.id} className="p-3 text-sm">
              <div className="font-medium">{t.origin} → {t.destination}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(t.scheduled_at)} · {t.transport_type} · {t.vendors?.name ?? "—"}</div>
            </Card>
          ))}
          {(transports ?? []).length === 0 && <Card className="p-4 text-center text-sm text-muted-foreground">Sem transporte agendado.</Card>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Hotel className="h-4 w-4" />Hotel</h2>
        <div className="space-y-2">
          {(hotels ?? []).map((h) => (
            <Card key={h.id} className="p-3 text-sm">
              <div className="font-medium">{h.hotel_name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(h.check_in)} → {fmtDate(h.check_out)}</div>
            </Card>
          ))}
          {(hotels ?? []).length === 0 && <Card className="p-4 text-center text-sm text-muted-foreground">Sem hospedagem.</Card>}
        </div>
      </section>
    </div>
  );
}
