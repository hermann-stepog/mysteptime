## Objetivo
Na aba **Histograma** do módulo Histograma Offshore, transformar as siglas coloridas (E, P, D, FO, F) exibidas acima da tabela em **chips clicáveis** que filtram os colaboradores mostrados.

## Comportamento
- Os chips (E, P, D, FO, F) viram botões toggle **multi-seleção**. "B" (Base) fica de fora do filtro, como pedido.
- Ao ativar um ou mais chips, a tabela mostra **apenas colaboradores que têm ao menos um dia com aquele status dentro do período** selecionado (dateStart → dateEnd), usando `getDisplayStatus` (mesma lógica que já pinta as células, para que P e E fiquem coerentes com o visual).
- Sem chips ativos = mostra todos (comportamento atual).
- Estado visual do chip ativo: borda mais forte + leve highlight, seguindo o mesmo padrão dos chips de status já existentes no cabeçalho (linha ~145-168), para manter consistência.
- Um pequeno botão "Limpar" aparece ao lado da legenda quando houver pelo menos um chip ativo.
- Contador no rodapé (`X colaboradores · Y dias`) continua refletindo o que está visível após o filtro.

## Escopo técnico
Arquivo único: `src/routes/admin/embarkations.tsx`, apenas dentro do componente `HistogramaTab` (linha 682+):
- Adicionar `useState<Set<DayStatus>>` para os status ativos.
- Calcular `visiblePeople` com `useMemo` filtrando `people` pelos dias do range via `getDisplayStatus`.
- Substituir os `<span>` da legenda por `<button>` toggles reaproveitando cores de `DAY_STATUS_COLOR`.
- Trocar `people.map` por `visiblePeople.map` no corpo da tabela e no contador.

Nada muda fora de `HistogramaTab`: os chips de resumo do cabeçalho (linha 145), a aba Dashboard e a lógica do Smartsheet permanecem intactas.