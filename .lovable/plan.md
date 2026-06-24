## Origens e Destinos extras (ilimitados) — Nova Viagem

Adicionar a possibilidade de incluir múltiplos pares de **Origem** e **Destino** no formulário de Nova/Editar Viagem, de forma independente dos campos de Cliente/BSP.

### Comportamento
- Manter os campos atuais `origem` e `destino` como principais (1º par).
- Abaixo deles, exibir uma lista dinâmica de pares extras (Origem + Destino lado a lado), cada um com botão **Remover**.
- Botão **+ Adicionar origem/destino** ao final, sem limite de quantidade.
- Todos os pares extras são opcionais; pares totalmente vazios são descartados ao salvar.
- Mesmo padrão visual dos campos atuais (mesmos `Input`/labels/spacing).

### Persistência
- Novas colunas em `transport_trips`:
  - `origens_extras text[]` (default `'{}'`)
  - `destinos_extras text[]` (default `'{}'`)
- Arrays alinhados por índice (posição N de origens_extras corresponde à posição N de destinos_extras). Strings vazias permitidas para preservar alinhamento quando só um lado for preenchido.

### UI
Em `src/routes/admin/transport.tsx`:
- `FormState`: adicionar `origens_extras: string[]` e `destinos_extras: string[]`.
- `init`: ler arrays do `Trip` (fallback `[]`).
- Form: após o par principal de origem/destino, renderizar `origens_extras.map(...)` com inputs controlados, botão remover (X) por linha e botão "Adicionar origem/destino".
- Submit: filtrar pares totalmente vazios antes do upsert.
- **TripCard**: mostrar origens/destinos extras como linhas adicionais no mesmo bloco de rota (formato `origem → destino`), abaixo do par principal.
- **DetailView (tabela)**: juntar todos os pares no formato `o1 → d1; o2 → d2` na coluna de rota.
- **CSV**: novas colunas `origens_extras` e `destinos_extras` (join por `;`).

### Fora de escopo
- Sem alterações em dashboard/KPIs, filtros, agrupamentos por rota (continuam usando origem/destino principais).
- Sem vínculo com Cliente/BSP (independente, conforme decisão).