import { FileText, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { DocumentoEscopo } from "@/lib/nominations";
import { notify } from "@/lib/notify";
import { Label } from "@/components/ui/label";

// IES / escopo do serviço do Soldador (pedido dela, 2026-10-30: mais de uma IES por função).
// Lista pra baixar e seletor de vários arquivos, usados no formulário de solicitação, na edição
// e nas etapas do kanban. Módulo à parte pra não criar import circular entre os diálogos.

export const SCOPE_DOCUMENT_TYPES =
  "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
export const SCOPE_BUCKET = "nomeacoes-anexos";

export async function baixarDocumentoIes(doc: DocumentoEscopo): Promise<void> {
  const { data, error } = await supabase.storage.from(SCOPE_BUCKET).download(doc.path);
  if (error) {
    notify.error(error.message);
    return;
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ListaIes({
  documentos,
  className = "text-primary",
}: {
  documentos: DocumentoEscopo[];
  className?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      {documentos.map((d) => (
        <button
          key={d.path}
          type="button"
          className={`flex items-center gap-1.5 text-xs hover:underline ${className}`}
          onClick={() => void baixarDocumentoIes(d)}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" /> {d.name}
        </button>
      ))}
    </div>
  );
}

// Já gravadas (existentes) + escolhidas agora (novos, sobem ao salvar). Dá pra remover qualquer
// uma e adicionar quantas quiser.
export function SeletorIes({
  funcao,
  existentes = [],
  onExistentesChange,
  novos,
  onNovosChange,
}: {
  funcao: string;
  existentes?: DocumentoEscopo[];
  onExistentesChange?: (docs: DocumentoEscopo[]) => void;
  novos: File[];
  onNovosChange: (files: File[]) => void;
}) {
  const total = existentes.length + novos.length;
  return (
    <div className="space-y-1">
      <Label className="text-xs">IES / escopo do serviço (PDF, Word, JPEG ou PNG)</Label>
      {total > 0 && (
        <ul className="space-y-1">
          {existentes.map((d) => (
            <li key={d.path} className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"
                onClick={() => void baixarDocumentoIes(d)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{d.name}</span>
              </button>
              {onExistentesChange && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  title="Remover"
                  onClick={() => onExistentesChange(existentes.filter((x) => x.path !== d.path))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
          {novos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                title="Remover"
                onClick={() => onNovosChange(novos.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
        <Upload className="h-3.5 w-3.5 shrink-0" />
        {total > 0 ? "Adicionar outra IES..." : "Selecionar arquivo(s)..."}
        <input
          type="file"
          multiple
          accept={SCOPE_DOCUMENT_TYPES}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onNovosChange([...novos, ...files]);
            e.target.value = "";
          }}
        />
      </label>
      <p className="text-[11px] text-muted-foreground">
        {total > 0
          ? "A Qualidade avalia o tipo de solda a partir destes documentos antes de aprovar."
          : `Sem documento? Descreva o tipo de serviço no campo Observações abaixo (indicando a função "${funcao}").`}
      </p>
    </div>
  );
}
