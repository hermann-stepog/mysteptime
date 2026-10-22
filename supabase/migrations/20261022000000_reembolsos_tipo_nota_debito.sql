-- Pedido dela, 2026-10-22: "Tipo de Reembolso" (Colaborador / Nota de Débito), igual ao toggle
-- "Tipo de Transporte" (Pessoas/Material) já existente em Transporte — quando for Nota de
-- Débito, guarda o número informado.
ALTER TABLE public.reembolsos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'colaborador';
ALTER TABLE public.reembolsos DROP CONSTRAINT IF EXISTS reembolsos_tipo_check;
ALTER TABLE public.reembolsos ADD CONSTRAINT reembolsos_tipo_check CHECK (tipo IN ('colaborador', 'nota_debito'));

ALTER TABLE public.reembolsos ADD COLUMN IF NOT EXISTS numero_nota_debito TEXT;
