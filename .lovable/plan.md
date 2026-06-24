## Objetivo
Permitir até 3 Clientes e 3 BSPs por viagem no formulário "Nova Viagem" do módulo Transporte.

## Mudanças no banco
Adicionar colunas opcionais na tabela `transport_trips`:
- `cliente_2 text`, `cliente_3 text`
- `bsp_2 text`, `bsp_3 text`

Os campos existentes `cliente` e `bsp` permanecem como o primeiro/principal. Tudo opcional, sem mudança de policies/grants.

## Mudanças no formulário (`src/routes/admin/transport.tsx`)
- No diálogo "Nova/Editar Viagem", abaixo dos campos atuais de Cliente e BSP, adicionar:
  - Cliente 2 (opcional) + BSP 2 (opcional)
  - Cliente 3 (opcional) + BSP 3 (opcional)
- Mesmo componente visual: `Select` (com lista `CLIENTES`) para Cliente, `Input` para BSP.
- Labels: "Cliente 2 (opcional)", "BSP 2 (opcional)", "Cliente 3 (opcional)", "BSP 3 (opcional)".
- Estendido o estado `f` do form e o payload do insert/update para incluir `cliente_2`, `cliente_3`, `bsp_2`, `bsp_3` (convertendo string vazia em `null`).
- Carregar os valores existentes no modo edição.

## Exibição (mínimo necessário)
- Nos cards de viagem e na tabela "Detalhe", quando existir, mostrar os clientes/BSPs adicionais como chips/linhas adicionais, no mesmo estilo dos atuais (sem alterar layout geral).
- Exportação CSV: incluir colunas `Cliente 2`, `Cliente 3`, `BSP 2`, `BSP 3`.

## Fora do escopo
- Sem mudanças no Dashboard KPI (continua agrupando pelo cliente principal).
- Sem mudanças em filtros existentes.
