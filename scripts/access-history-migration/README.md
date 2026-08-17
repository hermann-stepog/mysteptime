# Migração segura do histórico Access

Este pacote extrai o Access em modo somente-leitura, cria relatórios locais, compara a fonte com
uma fotografia autenticada do Supabase e prepara staging idempotente. Nenhum script aplica dados
às tabelas públicas sem revisão linha a linha, `run` aprovado e confirmação contendo o UUID do lote.

## Auditoria confirmada em 12/08/2026

- Fonte: `C:\dev\backups\access\BDStep B_be.accdb` (2.085.367.808 bytes).
- `Tbl_JobList`: 5.889 alocações, 516 códigos legados, 285 projetos e 46 unidades.
- `Tbl_Horas_Semanal`: 46.463 eventos.
- `dbo_Tbl_Jornada`: 35 jornadas com entrada, saída, duração e faixa noturna.
- `dbo_Funcionario`: 1.851 colaboradores; `Tbl_Funcionarios`: 201 cadastros antigos.
- `Tbl_Projeto`: 1.538 linhas; `Tbl_Embarcacao`: 84; `Tbl_Evento`: 16.
- Sufixos auditados: `_1` STEP OIL, `_2` STEP ENERGY, `_3` EXPATRIADOS, `_4` PETROHAB.
- Identidade é sempre empresa + matrícula. Nunca fazer join apenas pela matrícula.
- `900322_3` continua explicitamente “legado não identificado”; não associar um nome por
  aproximação. Um placeholder sintético é apenas proposto e exige aprovação manual.
- `000837_1` e `900280_3` têm assertivas de nome baseadas em `dbo_Funcionario`; qualquer nome
  divergente no snapshot bloqueia o mapeamento.

## 1. Extrair o Access (somente leitura)

Execute no PowerShell a partir da raiz do projeto. A senha é solicitada de forma segura e não é
salva. Os arquivos brutos ficam em `private/access-history/`, ignorado pelo Git por conter CPF e
outros dados pessoais.

```powershell
./scripts/access-history-migration/extract-access-history.ps1
```

O extrator gera schema, contagem de todas as tabelas, hash SHA-256 da fonte e CSVs das tabelas
operacionais. `Documentos`, `Foto` e o flag `Medido?` ficam fora: os dois primeiros são payloads
LONGCHAR fora do escopo; o último é um flag que o ODBC não consegue selecionar por causa do `?`.
A exclusão fica registrada no `manifest.json`.

## 2. Fotografar o Supabase (somente SELECT)

Quando a operação é feita pelo Lovable, use o SQL Editor e exporte os três resultados abaixo em
CSV. Não é necessária service role e as consultas são exclusivamente `SELECT`:

```sql
select id, matricula, nome, empresa, funcao, funcao_operacao, ativo, created_at
from public.hist_novo_colaboradores order by id;

select id, colaborador_id, unidade_operacional, centro_de_custo, bsp, tipo,
       data_inicio, data_fim, dias, origem, created_at
from public.hist_novo_periodos order by id;

select id, colaborador_id, funcao, embarcacao, data_inicio, data_fim,
       cod_alocacao, criado_em
from public.colaborador_funcoes_historico order by id;
```

Nomeie os arquivos como o exportador e acrescente `snapshot-summary.json` com `readOnly: true`,
data da captura, contagens e, de preferência, os hashes SHA-256.

Como alternativa técnica, o exportador local aceita `SUPABASE_SERVICE_ROLE_KEY` somente no
ambiente local e também contém exclusivamente consultas `SELECT`:

```powershell
node --env-file=.env scripts/access-history-migration/export-supabase-snapshot.mjs `
  --output private/access-history/supabase-snapshot-20260812
```

Nunca salve uma service role no repositório.

## 3. Construir staging e relatórios

```powershell
node scripts/access-history-migration/build-stage.mjs `
  --access-dir private/access-history/access-20260812 `
  --supabase-dir private/access-history/supabase-snapshot-20260812 `
  --output private/access-history/access-20260812/prepared
```

Relatórios principais:

- `audit-summary.md/json`: volumes, intervalos e bloqueios;
- `collaborator-mapping.csv`: identidade e evidência por código legado;
- `event-catalog.csv`: tipos de evento e tratamento;
- `unit-catalog.csv` e `project-catalog.csv`: unidades e BSPs;
- `period-candidates.csv`: candidatos e classificação de sobreposição;
- `function-candidates.csv`: histórico real de função por alocação;
- `event-staging.csv`: todos os 46.463 eventos, inclusive os que não viram período;
- `jornada-staging.csv`: catálogo necessário para reconstruir HH normal/noturno com horários;
- `blocking-issues.csv`: tudo que impede uma aplicação.

Regras de deduplicação:

1. igualdade exata de colaborador, tipo, datas, unidade e BSP vira `skip_exact`;
2. sobreposição com mesmo contexto, mas datas diferentes, exige revisão de união/recorte;
3. sobreposição com tipo/unidade/BSP divergente bloqueia;
4. duplicidade interna entre JobList e Horas Semanal exige revisão;
5. nenhum candidato novo recebe `approved` automaticamente.

`Hora Extra` fica como evento bruto: não é um tipo de `hist_novo_periodos`. Embarque,
Desembarque, Dobra, Trabalho Externo, Hotel e cancelamento podem produzir períodos conforme o
catálogo. Tipos sem equivalência comprovada continuam bloqueados.

## 4. Validar num banco local ou branch

Crie o schema isolado com `sql/01_create_legacy_access_schema.sql`. Depois use `psql` para carregar
os CSVs (os caminhos são passados por variáveis, nada está hardcoded):

```powershell
psql $env:VALIDATION_DATABASE_URL `
  -f scripts/access-history-migration/sql/02_load_stage.psql `
  -v run_csv='.../run.csv' `
  -v collaborator_csv='.../collaborator-mapping.csv' `
  -v period_csv='.../period-candidates.csv' `
  -v function_csv='.../function-candidates.csv' `
  -v event_csv='.../event-staging.csv' `
  -v jornada_csv='.../jornada-staging.csv'
```

Rode `03_review_checks.psql -v run_id=<uuid>`. Resolva cada bloqueio e marque as decisões como
`approved`, `skip_exact` ou `excluded_reviewed`. Só depois marque o `run` como `approved`.

Um colaborador legado inexistente no cadastro atual só pode ser criado após a mudança manual de
`resolution_status` para `create_approved`. Um código sem identidade comprovada exige
`placeholder_approved`. Nos dois casos, o cadastro nasce com `ativo=false` para não alterar a
equipe operacional atual.

`04_define_apply_reviewed_run.sql` apenas define a operação transacional; não a chama. A chamada
exige `APLICAR:<RUN_ID>`, revalida referências/overlaps e grava uma chave de linhagem por registro,
impedindo reaplicação. A origem pública é `access_legado`, que não é apagada pelos imports Drake
ou Disponibilidade existentes.

## Pontos do schema atual

- `hist_novo_colaboradores` usa `UNIQUE (empresa, matricula)` desde a migration de 05/08/2026.
- `hist_novo_periodos` guarda unidade, BSP/centro de custo, tipo, datas, dias e origem.
- `colaborador_funcoes_historico` é o destino próprio para a função por alocação.
- `ativo` existe no banco atual, é obrigatório e tem padrão `true`; qualquer cadastro criado apenas
  para preservar o legado é gravado explicitamente com `ativo=false`.
- `DRAKE_DATA_CUTOFF = 2026-01-01` limita consultas da interface, não o armazenamento. O legado
  anterior a 2026 será preservado, mas precisa de uma decisão separada caso deva aparecer na UI.
- A aplicação não gera timesheets retroativos automaticamente; isso evita criar milhares de
  timesheets operacionais sem uma decisão específica sobre horas extras e sobreposição de 2026.
