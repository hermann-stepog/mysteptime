## Módulo Transporte & Rotas — Tipo de transporte, Materiais, BSP, Cliente e Status

### 1. Banco de dados (migração única)

**Nova tabela `materials`:**
- `code` (texto, único), `descricao` (texto), `categoria` (texto), `active` (bool)
- GRANT para `authenticated` e `service_role`; RLS: leitura para autenticados, escrita para operador.

**Nova tabela `transport_trip_materials`** (N:N entre `transport_trips` e `materials`):
- `trip_id`, `material_id`, opcional `quantidade` (numeric).
- RLS espelhando `transport_trip_collaborators`.

**Alterações em `transport_trips`:**
- `tipo` (enum `pessoas` | `material`, default `pessoas`, NOT NULL)
- `bsp` (texto, opcional)
- `cliente` (texto, opcional — armazenado livre, mas selecionado de lista fixa na UI)
- `status` (enum `em_andamento` | `realizado` | `cancelado`, default `em_andamento`)
- Backfill: registros com `realizado=true` → `realizado`; `cancelado=true` → `cancelado`; demais → `em_andamento`.
- Manter `realizado`/`cancelado` por compatibilidade (opcional remover depois).

### 2. Novo módulo Materiais (`/admin/materials`)

- Item no sidebar admin (`route.tsx`): "Materiais".
- Página com tabela: Código, Descrição, Categoria, Status, ações (editar/desativar).
- Botão "Adicionar material" abre dialog com Código, Descrição, Categoria.
- Botão "Importar planilha .xlsx" (SheetJS, normaliza headers: Código/Codigo/code, Descrição/Descricao/description, Categoria/Category).
- Mesma estética do módulo Colaboradores.

### 3. Novo componente `MaterialMultiSelect`

- Espelha `CollaboratorMultiSelect`: popover com busca, multi-seleção, badges, botão "+ Cadastrar novo" abrindo dialog inline (mesmo do módulo Materiais) e auto-seleção do novo registro.
- Hook `useMaterialsQuery` filtrando `active=true`.

### 4. Atualizações no `/admin/transport`

**Dialog de edição/criação do trip:**
- Campo **Tipo** (radio/segmented Pessoas | Material) — obrigatório.
- Se Pessoas: mantém `CollaboratorMultiSelect` (esconde materiais).
- Se Material: mostra `MaterialMultiSelect` (esconde colaboradores).
- Campo **Cliente** (Select com opções fixas: SBM, Altera, PRIO, Perenco, Seadrill, Yinson, BW, Trident) — opcional, com opção "—".
- Campo **BSP** (Input texto) — opcional.
- Campo **Status** (Select: Em Andamento | Realizado | Cancelado) substitui os 2 checkboxes.

**Cards do Kanban:**
- Borda/badge de status colorida: azul (em_andamento), verde (realizado), vermelho (cancelado) — usando tokens semânticos existentes (primary/success/destructive).
- Badge de Tipo (Pessoas/Material) com ícone.
- Se BSP preenchido: badge destacado (chip com fundo `warning/20`, texto `warning-foreground`, rótulo "BSP: …").
- Se Cliente preenchido: chip discreto com nome do cliente.
- Lista de colaboradores OU lista de materiais conforme tipo.
- Remover os checkboxes Realizado/Cancelado; trocar por Select compacto de status (ou menu) inline no card.

**Demais abas (Painel do Dia, Quadro Detalhado, Linha do Tempo):**
- Quadro Detalhado: nova coluna Tipo, Cliente, BSP, Status (badge colorido). Filtros adicionais por Tipo, Cliente e Status (substitui filtro de Realizado/Cancelado).
- Exportação Excel: incluir colunas Tipo, Cliente, BSP, Status, Materiais.

### 5. Dashboard (`/admin/index.tsx`)

- Card "Transportes realizados no mês" passa a contar `status = 'realizado'`.
- Gráficos existentes seguem por etiqueta; sem novos cards (escopo dessa task é configuração dos cards atuais).

### 6. Ordem de execução

1. Migração (materials, trip_materials, novas colunas, backfill, RLS+GRANT).
2. Regenerar types.
3. Criar `MaterialMultiSelect` + dialog de novo material.
4. Criar `/admin/materials` + entrada no sidebar.
5. Refatorar `/admin/transport`: form do dialog, cards, filtros, exportação.
6. Atualizar Dashboard para usar `status='realizado'`.

### Detalhes técnicos

- Lista fixa de clientes em constante `CLIENTES = ['SBM','Altera','PRIO','Perenco','Seadrill','Yinson','BW','Trident']` num arquivo compartilhado (`src/lib/clientes.ts`).
- Cores de status via classes condicionais com tokens (`border-primary`, `border-success`, `border-destructive`); sem cores hardcoded.
- Compatibilidade: leitura ainda tolera `realizado`/`cancelado` antigos durante transição, mas UI grava sempre em `status`.
