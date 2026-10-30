import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REJECTION_REASON_MAX_CHARS,
  countWords,
  normalizeRejectionReason,
  validateRejectionReason,
  REJECTION_REASON_MAX_WORDS,
} from "@/lib/rejection-reason";

export function RejectionReasonPrompt({
  onConfirm,
  onCancel,
  loading,
  confirmLabel = "Confirmar reprovação",
  initial = "",
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading?: boolean;
  confirmLabel?: string;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = validateRejectionReason(value);
  return (
    <div className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
      <Input
        autoFocus
        className="h-8 text-xs"
        maxLength={REJECTION_REASON_MAX_CHARS}
        placeholder={`Motivo (obrigatório, até ${REJECTION_REASON_MAX_WORDS} palavras)`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
      <p className={`text-[11px] ${touched && error ? "text-destructive" : "text-muted-foreground"}`}>
        {touched && error ? error : `${countWords(value)}/${REJECTION_REASON_MAX_WORDS} palavras`}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-7 text-xs"
          loading={loading}
          disabled={!!error}
          onClick={() => {
            setTouched(true);
            if (!error) onConfirm(normalizeRejectionReason(value));
          }}
        >
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
