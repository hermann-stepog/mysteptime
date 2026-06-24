## 1. Ordenação por número do carro (todas as abas)

Aplicar ordenação crescente por `car_number` (numérica natural: "Carro 1, 2, 3, 10") nas listagens:

- **Kanban**: dentro de cada coluna, ordenar cards por `car_number`.
- **Painel do Dia** e **Linha do Tempo**: o agrupamento já é por carro — ordenar as chaves do Map em ordem crescente.
- **Quadro Detalhado**: ordenar linhas da tabela por `car_number` (mantendo filtros atuais).

Helper único `compareCarNumber(a, b)` que extrai dígitos para ordenação natural.

## 2. Formulário Nova Viagem: campo só Data

- Trocar o input `datetime-local` (linha 364) por `type="date"`.
- `FormState.scheduled_at` passa a guardar `YYYY-MM-DD`.
- Ao salvar, normalizar para `YYYY-MM-DDT00:00:00` (mantém compatibilidade com a coluna `timestamptz` existente, sem migração).
- `init`: usar `slice(0, 10)` em vez de `slice(0, 16)`.
- Horário da viagem segue representado pelos campos já existentes **Horário de Partida** e **Horário de Destino**.

## 3. Nova aba "Dashboard KPI" (última)

Adicionar `<TabsTrigger value="kpi">Dashboard KPI</TabsTrigger>` + `<TabsContent value="kpi">` renderizando `<KpiDashboard />`.

### Filtros (topo, sticky no mobile)
- Período: `data_inicio` e `data_fim` (default: mês corrente).
- Etiqueta: `Select` populado de `transport_tags`.
- Tipo: Pessoas | Material | Todos.

Filtros persistem em search params (`?from=&to=&tag=&tipo=`) reusando `validateSearch` da rota.

### Cards de destaque (grid responsiva 1/2/3 col)
- Total de transportes (após filtro)
- Realizados
- Em andamento

### Gráficos (recharts, já instalado — ver `src/routes/admin/index.tsx`)
Layout `grid gap-4 md:grid-cols-2`:

1. **Donut — distribuição por status** (`PieChart` com `Realizado/Em Andamento/Cancelado`).
2. **Linha — evolução mensal** (`LineChart`, agrupando por `YYYY-MM` de `scheduled_at`).
3. **Barras horizontais — top rotas por volume** (`BarChart layout="vertical"`, chave = `origin → destination`, top 10).
4. **Barras agrupadas — comparativo por etiqueta** (cada barra = etiqueta, séries = tipo Pessoas vs Material).
5. **Barras — custo por rota**: ⚠️ ver nota técnica.
6. **Barras — custo por cliente**: somar `cost_logs.amount` agrupado por `clients.name` no período.

Todos os dados via `useQuery` em cima das mesmas fontes (`transport_trips`, `transport_tags`, `cost_logs`) — atualização em tempo real ao invalidar queries no save de viagem.

## 4. Responsividade global

- **Header/Sidebar admin** (`src/routes/admin/route.tsx`): sidebar vira `Sheet` colapsável com botão hamburger em `<md`.
- **Cards de viagem (Kanban, Painel do Dia)**: já são `flex-col` mas revisar `min-w-0`, `truncate`, `shrink-0` conforme padrão `responsive-layout-patterns`.
- **Quadro Detalhado**: envelopar `<Table>` em `overflow-x-auto`; filtros viram `grid-cols-1 sm:grid-cols-2 lg:flex`.
- **Dashboard KPI**: cards e gráficos `grid-cols-1 md:grid-cols-2`; donut/linha ocupam largura total no mobile.
- **Formulário Nova Viagem (Dialog)**: campos `grid-cols-1 sm:grid-cols-2`; dialog rolável em telas baixas (`max-h-[90vh] overflow-y-auto`).
- Auditar demais rotas admin (`embarkations`, `materials`, `collaborators`, `documents`, `hotel`, `costs`, `payroll`, `timesheets`, `approvals`, `reports`) para o mesmo padrão de grid/Sheet/tabela com scroll.

## Notas técnicas

- **Custo por rota**: a tabela `cost_logs` **não tem `trip_id`** (ver schema). Sem alteração de BD, vou agregar custos por **cliente** (existe `client_id`) e usar isso também como proxy do "custo por rota" agrupando por `origin→destination` das viagens daquele cliente no período (rateio igual entre viagens do cliente). Alternativa mais precisa: criar coluna `trip_id` em `cost_logs` (migração + GRANT/RLS) — só faço se você confirmar.
- **Coluna `scheduled_at`**: mantida como `timestamptz`; só o input do formulário muda. Viagens antigas continuam funcionando (hora vira 00:00 ao reabrir, mas Partida/Destino preservam o horário real).
- Sem mudanças no padrão visual (mesmos tokens, `Card`, `Tabs`, paleta).

## Pergunta antes de implementar

Quer que eu **adicione `trip_id` em `cost_logs`** (migração) para ter "custo por rota" preciso, ou prefere o proxy via cliente?
