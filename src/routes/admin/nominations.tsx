import { createFileRoute } from "@tanstack/react-router";
import { NominationsPage } from "@/components/nominations/NominationsPage";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/nominations")({
  head: () => pageTitle("Nomeações"),
  component: NominationsPage,
});
