# Investigação: data de admissão e função atual

Somente leitura. Nenhuma alteração foi feita.

## 1) Data de admissão

Não existe em nenhum lugar do sistema hoje.

- Banco: nenhuma coluna no schema `public` com nome parecido com `admiss`, `hire` ou `contrat`.
- Código: nenhuma ocorrência de admissao, admissão, admission, hire_date, data_admissao ou equivalentes. A única ocorrência de "contratacao" é o rótulo de um gráfico de Nomeações ("Pessoas a contratar"), que não tem relação com admissão.
- Drake: a importação/sincronização não lê nenhum campo de admissão. Nem `hist_novo_colaboradores` nem `drake_qualification_workers` guardam esse dado.
- Planilha / Smartsheet / manual: nenhuma coluna de admissão em `planejamento_embarque` nem em `collaborators`.

Por isso não há nenhuma ligação com `hist_novo_colaboradores` ou `drake_qualification_workers`. Para expor esse dado, primeiro seria preciso definir a fonte (por exemplo, confirmar se o Drake oferece esse campo) e criar onde guardá-lo.

## 2) Função atual do colaborador

| Tabela.coluna | Fonte | Observação |
|---|---|---|
| `hist_novo_colaboradores.funcao` e `.funcao_operacao` | Drake: sincronização anual e importação da planilha do Drake (colunas "Função" e "Função de operação do trabalhador") | Cadastro mestre. É de onde o endpoint SMS lê |
| `drake_qualification_workers.job_name` | Drake (sincronização da Matriz de Qualificação) | Ligada ao cadastro mestre só por `registration` = `matricula`; não existe FK |
| `planejamento_embarque.funcao` | Importação de planilha / edição manual | Ligada por matrícula/nome, sem FK |
| `colaborador_funcoes_historico.funcao` | Gerada por trigger a partir do Planejamento (`capture_funcao_planejamento`) | Tem `colaborador_id`, que aponta para o cadastro mestre |
| `collaborators.role` | Smartsheet | Cadastro legado, ligado só pelo nome |
| `timesheet_embarques.funcao_embarque`, `timesheet_semanas.funcao_override`, `bm_timesheet_dias.funcao`, `bm_lines_mo.funcao`, `nominations.funcao`, `planejamento_embarque_snapshots.funcao` | Derivadas/operacionais | Função num embarque, num BM ou numa nomeação; não é o cadastro |

Fonte recomendada para "função atual": `hist_novo_colaboradores.funcao` (Drake), com `funcao_operacao` como complemento.

## Próximo passo (se quiser a admissão)

Confirmar se o Drake fornece a data de admissão. Só então planejar onde guardar e como expor, num pedido separado.
