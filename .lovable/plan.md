## Adicionar campo de quantidade aos materiais selecionados

Quando "Material" estiver selecionado no card de Nova viagem, cada material escolhido passa a ter um campo numérico de **Quantidade** ao lado do badge.

### Mudanças

1. **`src/components/MaterialMultiSelect.tsx`**
   - Criar um novo componente `MaterialQuantitySelect` (ou estender o atual via prop `withQuantity`) que gerencia `Array<{ material_id: string; quantidade: number }>` em vez de `string[]`.
   - Cada material selecionado é exibido em uma linha com: nome do material + input numérico (min=1, default=1) + botão remover.
   - O popover de seleção continua igual; ao marcar um material, ele entra com `quantidade: 1`.

2. **`src/routes/admin/transport.tsx`**
   - No dialog "Nova viagem", trocar o estado de materiais selecionados para a nova estrutura `{material_id, quantidade}[]`.
   - No submit (insert/update em `transport_trip_materials`), gravar `quantidade` (coluna já existe na tabela).
   - Ao carregar viagem para edição, hidratar a quantidade vinda do banco.
   - Nos cards do kanban e nas tabelas (Painel do Dia, Quadro Detalhado, Linha do Tempo, export Excel), exibir os materiais como `Descrição ×{quantidade}`.

3. **Sem migração** — `transport_trip_materials.quantidade` já existe (3 colunas: trip_id, material_id, quantidade).

### Observações
- Quantidade é obrigatória e mínima 1; se o usuário apagar, volta para 1 ao salvar.
- O fluxo de "Pessoas" permanece inalterado.
