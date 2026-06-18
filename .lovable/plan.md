
## Escopo

Reformular o módulo **Transporte & Rotas** como kanban, criar o módulo **Colaboradores** como fonte única de dados, conectá-lo a todos os módulos que usam nome de colaborador, e adicionar métricas no Dashboard.

---

## 1. Banco de dados (migração única)

Novas tabelas / colunas:

- **`collaborators`** — Nome, Função, Cidade de residência, ativo. Substitui (no nível de UI) o uso atual de `profiles` como lista de colaboradores. `profiles` continua existindo apenas para autenticação.
- **`transport_columns`** — colunas kanban configuráveis. Seed: `Embarque`, `Desembarque`, `Viagem`. Campo `position` para ordenação.
- **`transport_tags`** — etiquetas reutilizáveis (nome + cor), criáveis pelo usuário.
- **`transport_trips`** — novo registro principal (substitui `transport_requests` na UI nova):
  - `car_number` (texto, ex: "Carro 01")
  - `column_id` → `transport_columns`
  - `scheduled_at`, `origin`, `destination`, `notes`
  - `realizado` (bool), `cancelado` (bool)
- **`transport_trip_tags`** — N:N entre trip e tags.
- **`transport_trip_collaborators`** — N:N entre trip e colaboradores.

Mantemos `transport_requests` no banco (não removemos dados), mas a UI nova trabalha com `transport_trips`. RLS: leitura por authenticated, escrita por operator. GRANTs completos.

---

## 2. Módulo Colaboradores (`/admin/collaborators`)

- Tabela com Nome, Função, Cidade, ações (editar/desativar).
- Botão **"Adicionar colaborador"** → dialog com formulário (Nome, Função, Cidade).
- Botão **"Importar planilha .xlsx"** → aceita colunas `Nome`, `Função`, `Cidade`. Parser via `xlsx` (SheetJS), preview antes de importar.
- Item no menu lateral admin.

---

## 3. Componente reutilizável `CollaboratorMultiSelect` / `CollaboratorSelect`

- Dropdown alimentado por `collaborators` ativos.
- Busca por nome.
- Botão **"+ Cadastrar novo"** dentro do dropdown que abre o mesmo dialog do módulo Colaboradores e seleciona automaticamente o novo registro.
- Versão single e multi.

Substituir nos módulos existentes que hoje selecionam colaborador a partir de `profiles`:
- Transporte (novo kanban)
- Qualificação / Avaliações / demais formulários que pedem colaborador (mapeio durante a implementação lendo os arquivos).

---

## 4. Transporte & Rotas — nova estrutura

Página com 4 abas:

### Aba 1 — Kanban (padrão)
- Colunas vindas de `transport_columns`. Botão **"+ Nova coluna"**.
- Cada coluna lista cards de `transport_trips` daquela coluna.
- Drag-and-drop entre colunas (dnd-kit, já leve).
- Card mostra: número do carro, etiquetas coloridas, horário, origem → destino, avatares/nomes de colaboradores, checkboxes pequenos **Realizado** e **Cancelado**.
- Clicar no card abre dialog de edição com todos os campos + Observações + multi-select de etiquetas (com "+ criar etiqueta") + multi-select de colaboradores.
- Botão **"+ Nova viagem"** no topo.

### Aba 2 — Painel do Dia
- Seletor de data no topo (default = hoje), navegação ← / →.
- Cards ordenados por horário, mesmo conteúdo visual do card kanban + status visível.

### Aba 3 — Quadro Detalhado
- Tabela: Data, Carro, Etiquetas, Horário, Origem, Destino, Colaboradores, Observações, Status.
- Filtros: intervalo de datas, etiqueta, status (realizado/cancelado/pendente).

### Aba 4 — Linha do Tempo
- Timeline horizontal do dia (seletor de data), agrupada por carro (uma linha por carro), blocos posicionados pelo horário mostrando origem → destino e etiquetas.

### Exportação
- Botão **"Exportar Excel"** visível em todas as abas (header da página).
- Dialog: período (data início → data fim) ou "toda a programação".
- Gera `.xlsx` via SheetJS com colunas: Data, Carro, Etiquetas, Horário, Origem, Destino, Colaboradores, Observações, Status.

---

## 5. Dashboard

Adicionar ao `/admin`:
- **Card "Transportes realizados no mês"** — count de `transport_trips` com `realizado = true` no mês atual. Clicável → vai para Quadro Detalhado já filtrado.
- **Gráfico de transportes por etiqueta** — barras ou donut com quantidade e %, usando recharts (já no projeto). Cada fatia/barra clicável → Quadro Detalhado filtrado pela etiqueta.
- Dados ao vivo via React Query.

---

## 6. Detalhes técnicos

- Dependências novas: `xlsx` (importação/exportação Excel) e `@dnd-kit/core` + `@dnd-kit/sortable` (drag and drop kanban).
- Padrão visual mantido: `Card`, `Button`, `Dialog`, `Select`, `Badge`, tokens de cor já existentes (sidebar, primary, warning, success, destructive). Etiquetas usam `Badge` com cor custom da tag.
- Realtime opcional desligado nesta etapa (React Query refetch já cobre).
- Rotas novas:
  - `/admin/collaborators`
  - `/admin/transport` continua, mas o componente é totalmente reescrito.
- O arquivo atual `transport_requests` permanece no banco intocado — apenas deixa de ser usado pela UI.

---

## 7. Ordem de execução

1. Migração (tabelas + GRANTs + RLS + seed das 3 colunas padrão).
2. Aguardar regeneração dos tipos.
3. Instalar `xlsx` e `@dnd-kit/*`.
4. Criar `CollaboratorMultiSelect` + dialog "novo colaborador".
5. Página `/admin/collaborators` (lista, manual, import xlsx).
6. Reescrever `/admin/transport` com 4 abas + exportação.
7. Substituir selects de colaborador nos demais módulos.
8. Atualizar Dashboard com card + gráfico clicáveis.
