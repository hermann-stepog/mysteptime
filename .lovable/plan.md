# Análise técnica — integração My Step Time → Sistema SMS (sincronização de colaboradores)

Somente análise. Nada foi alterado. Contagens e schemas lidos do banco em 06/10/2026.

## 1) Tabelas de colaboradores hoje

Existem 4 cadastros paralelos, sem chave em comum entre eles.

| Tabela | Linhas | Papel |
|---|---|---|
| `hist_novo_colaboradores` | 1.981 | Cadastro mestre offshore, alimentado pelo Drake. Base do Histograma, Timesheet, BM e Nomeações |
| `drake_qualification_workers` | 629 | Espelho do Drake para a Matriz de Qualificação |
| `planejamento_embarque` | 272 | Planilha operacional atual (status do dia, datas). Importação/edição manual |
| `collaborators` | 511 | Cadastro "Geral" legado (transporte, hospedagem), sincronizado do Smartsheet por nome |

**hist_novo_colaboradores**
- `id uuid PK default gen_random_uuid()`, `created_at timestamptz not null default now()`
- `matricula text not null`, `nome text not null`, `empresa text`, `funcao text`, `funcao_operacao text`, `ativo boolean not null default true`
- `UNIQUE (empresa, matricula)`
- Filhas: `hist_novo_periodos.colaborador_id` e `timesheet_embarques.colaborador_id` (FK, ON DELETE CASCADE); `colaborador_funcoes_historico.colaborador_id`
- Dado: 0 matrículas nulas, mas só 1.818 matrículas distintas em 1.981 linhas. A mesma matrícula aparece com `empresa` diferente (ou nula), então a matrícula sozinha não é única.

**drake_qualification_workers**
- `drake_worker_id text PK`, `registration text not null`, `full_name text not null`, `job_name`, `worker_type`, `worker_state`, `current_operational_unit_name`, `sync_id uuid not null`, `synced_at timestamptz not null`
- Filha: `drake_worker_qualifications (drake_worker_id, qualification_id) PK`, FK com cascade. Campos: `qualification_name`, `indicated_course_id/name`, `issue_date`, `expiration_date`

**planejamento_embarque**
- `id uuid PK`, `matricula text` (nula em 9 linhas), `nome text not null`, `unidade`, `bsp`, `funcao`, `especialidade`, `status`
- Datas: `embarque`, `desembarque`, `folga_inicio/fim`, `ferias_inicio/fim`, `programado_1 date`, `programado_2 text`, `duracao_embarque_dias`
- Outros: `observacoes`, `rh_bloqueado`, `rh_bloqueio_justificativa`, `rh_bloqueio_marcado_em/por`, `rh_bloqueio_status_anterior`, `created_at`, `updated_at`, `updated_by` (FK profiles)
- Sem UNIQUE além do PK

**collaborators**
- `id uuid PK`, `full_name text not null`, `role`, `city`, `unit`, `active bool`, `is_offshore bool`, `created_at`, `updated_at`
- Sem matrícula e sem UNIQUE; o casamento é feito pelo nome normalizado

## 2) Campos vindos do Drake

- `hist_novo_colaboradores`: `matricula`, `nome`, `empresa`, `funcao`, `funcao_operacao`, `ativo`
- `hist_novo_periodos`: `unidade_operacional`, `centro_de_custo`, `bsp`, `tipo` (status do dia: EMB, FO, DDN etc.), datas, `origem='drake'`, `drake_event_key`
- `timesheet_embarques`: derivado do Drake (`source_event_key`), mais `status_entrega` (manual)
- `drake_qualification_workers` / `drake_worker_qualifications`: identidade Drake, cargo, estado, unidade atual, cursos com emissão e vencimento

## 3) Campos vindos do Smartsheet ou manuais

- `collaborators`: `full_name` e `role` vêm do Smartsheet; `city`, `active` e `unit` são manuais
- Smartsheet ao vivo (não persistido): BSP, unidade, especialidade e status, usados na aba Offshore
- `planejamento_embarque`: tudo vem de importação de planilha ou edição manual, incluindo o bloqueio RH (feito via RPC)
- `nomination_nominees`: respostas de SMS/RH/Qualidade, manuais por nomeação

## 4) Identificador estável para upsert

- **Recomendado: `drake_worker_id`** (PK imutável no Drake). Hoje ele só existe em `drake_qualification_workers` e não está ligado a `hist_novo_colaboradores`.
- Alternativa disponível hoje: a chave composta `(empresa, matricula)` de `hist_novo_colaboradores`, que é UNIQUE. Duas condições: tratar `empresa` nula (que o UNIQUE não protege) e nunca usar a matrícula sozinha (163 repetidas).
- Não usar: o `id` uuid local (muda se a linha for recriada no reimport), o nome, nem o `id` de `planejamento_embarque`/`collaborators`.
- Passo prévio sugerido: casar `registration` (Drake) com `matricula` e gravar o `drake_worker_id` no cadastro mestre. Antes disso, medir quantas linhas casam.

## 5) VIEW mínima recomendada (`sms_colaboradores_v`)

Uma linha por colaborador ativo do cadastro mestre:

- `colaborador_key`: `drake_worker_id`, ou `empresa||':'||matricula` como fallback
- `matricula`, `nome`, `empresa`
- `funcao`, `funcao_operacao`
- `ativo`
- `unidade_atual`, `bsp_atual`: período do Drake vigente hoje
- `situacao_hoje`: o código do dia (EMB/FO/BASE…), sem motivo
- `proximo_embarque`, `proximo_desembarque`: do Planejamento, ligado por matrícula
- `atualizado_em`: maior data entre cadastro e período, para sincronização incremental

Opcional, numa segunda VIEW separada: `sms_qualificacoes_v` com chave, nome do curso, emissão e vencimento. É útil para ASO/NR, mas avaliar antes (ver item 7).

Regras da VIEW:
- `WITH (security_barrier = true)`
- Dona dela uma role sem BYPASSRLS
- Sem joins com `profiles`/`auth`
- Colunas explícitas, nunca `SELECT *`

## 6) Riscos de RLS/service role e acesso só leitura

**Riscos**
- Uma VIEW comum roda com os privilégios do dono (normalmente `postgres`), então ignora o RLS das tabelas de base. Isso é aceitável aqui, porque a VIEW em si é o filtro, desde que só ela tenha GRANT.
- Nunca entregar a service role ao SMS: ela lê e escreve tudo.
- Nunca dar GRANT SELECT na VIEW para `anon`/`authenticated`: qualquer usuário do app (ou pessoa com a chave pública) leria pela API.
- Criar a VIEW num schema próprio (ex.: `integracao_sms`) fora do `public`, para não aparecer na API pública.

**Role de leitura (SQL de referência, não executado)**
```sql
create schema integracao_sms;
create view integracao_sms.sms_colaboradores_v with (security_barrier=true) as select ...;
create role sms_reader login password '<gerado>' nosuperuser nocreatedb nocreaterole noinherit;
revoke all on schema public from sms_reader;
grant usage on schema integracao_sms to sms_reader;
grant select on integracao_sms.sms_colaboradores_v to sms_reader;
alter role sms_reader set statement_timeout='30s';
alter role sms_reader connection limit 3;
```

**Limitação da plataforma**
No Lovable Cloud não há acesso ao host direto nem à senha do banco para entregar uma conexão PostgreSQL a terceiros. A role pode ser criada, mas o SMS dificilmente vai conseguir conectar com ela.

O caminho viável, igual ao já usado com o LGP Flow, é um endpoint HTTPS somente leitura:
- protegido por token próprio (ex.: `SMS_SYNC_ACCESS_TOKEN` no cabeçalho)
- lê apenas a VIEW
- devolve JSON, com parâmetro `desde=<atualizado_em>` para sincronização incremental

Assim não há credencial de banco fora do app, e o token pode ser trocado a qualquer momento.

## 7) Dados que NÃO devem ir para o SMS nesta primeira fase

- Bloqueio RH: `rh_bloqueado`, `rh_bloqueio_justificativa` e afins (dado trabalhista/disciplinar)
- `observacoes` livres do Planejamento (podem conter saúde ou motivo pessoal)
- Férias, folga indenizada, atestado e afastamento como motivo (`tipo`/`status` detalhado do dia). Expor só "disponível / embarcado / indisponível".
- Respostas por nomeação: `sms_bloqueio_saude`, `sms_aso_em_dia`, `rh_documentacao_ok`, divergência de aptidão. São dados de saúde; o SMS deve ser a origem deles, não o destino.
- `collaborators.city` (residência), e-mails, telefones, `profiles`, `user_roles`, `updated_by`
- Custos, BSP financeiro, BM, reembolsos, passagens e hospedagem
- Qualificações completas, até haver acordo de finalidade (LGPD). Se forem necessárias, só nome do curso e vencimento.

## Próximos passos (quando decidir implementar)

1. Medir quantas linhas casam entre `registration` (Drake) e `matricula` e decidir a chave.
2. Criar o schema, a VIEW e o endpoint com token.
3. Testar com o SMS em homologação.
