
## Importação Inteligente de Materiais (.xlsx / .csv)

Substituir o fluxo atual de importação em **`src/routes/admin/materials.tsx`** por um assistente em duas etapas que aceita qualquer estrutura de planilha.

### 1. Leitura flexível do arquivo
- Aceitar `.xlsx`, `.xls` e `.csv` (xlsx já lê todos via `XLSX.read`).
- Detectar automaticamente a linha de cabeçalho: primeira linha não-vazia com pelo menos 1 célula textual.
- Ler todas as linhas restantes, ignorando linhas totalmente vazias.

### 2. Mapeamento automático de colunas
Para cada cabeçalho da planilha, normalizar (lowercase, sem acentos, sem espaços/símbolos) e tentar casar com os campos do banco:

| Campo destino | Aliases reconhecidos |
|---|---|
| `descricao` (obrigatório) | descricao, descrição, description, item, produto, material, nome, name |
| `categoria` (opcional)    | categoria, category, tipo, type, grupo, group, classe |
| `code` (opcional)         | codigo, código, code, cod, sku, ref, referencia |

Colunas não reconhecidas ficam como **"Ignorar"** por padrão. Campos sem correspondência ficam **nulos**.

### 3. Diálogo de prévia (novo `ImportMaterialsDialog`)
Após selecionar o arquivo, abre-se um modal com:
- **Tabela de mapeamento**: para cada coluna detectada, exibir nome original + `Select` com opções `Descrição | Categoria | Código | Ignorar` (pré-selecionado pelo auto-match). Usuário pode ajustar.
- **Resumo**: total de linhas lidas, linhas válidas (com `descricao` preenchida), linhas ignoradas (sem descrição).
- **Alertas** (não bloqueiam):
  - "X linhas sem descrição serão ignoradas"
  - "Coluna 'Y' não foi reconhecida e será ignorada"
  - "Nenhuma coluna mapeada para Descrição" (este sim bloqueia o botão Importar)
- **Prévia das 5 primeiras linhas** já mapeadas, mostrando como serão inseridas.
- Botões: **Cancelar** | **Importar N registros**.

### 4. Inserção no banco
- Converter cada linha em `{ descricao, categoria, code }` aplicando `String().trim()` e transformando vazios em `null`.
- Filtrar linhas sem `descricao`.
- Quando houver `code`, manter o comportamento atual de `upsert` com `onConflict: "code"`; quando não houver, usar `insert` puro (sem upsert) para evitar conflitos com `code = null`.
- Dividir em dois lotes (com code / sem code) e executar ambos.
- Toast final: "N materiais importados, M ignorados".

### 5. Arquivos afetados
- **`src/routes/admin/materials.tsx`**: remover `onImport` inline, trocar botão "Importar planilha" por `<ImportMaterialsDialog />`.
- **`src/components/ImportMaterialsDialog.tsx`** (novo): toda a lógica de leitura, mapeamento, prévia e inserção.

### Fora de escopo
Não altera schema do banco, não toca em outras telas, não muda o fluxo de cadastro manual.
