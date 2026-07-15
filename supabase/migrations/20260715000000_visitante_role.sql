-- Novo papel "Visitante": acesso restrito a Solicitações (Transporte), Dashboard
-- (Histograma Offshore Novo) e Timesheet Offshore (somente leitura).
-- Precisa ser um arquivo próprio: um valor de enum recém-adicionado não pode ser
-- usado em políticas/consultas na mesma transação em que foi criado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'visitante';
