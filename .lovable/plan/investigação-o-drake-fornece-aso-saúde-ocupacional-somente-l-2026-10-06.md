# Investigação: o Drake fornece ASO/saúde ocupacional? (somente leitura, nada alterado)

## Resposta curta
Não. A integração com o Drake que o My Step Time usa hoje não traz ASO, exame médico nem aptidão médica. Os campos de ASO, saúde e aptidão das Nomeações são marcados à mão no My Step Time.

## (a) O que vem do Drake
- **Escala/períodos** (`hist_novo_periodos`): códigos de presença (E, F, AT, LM, AFA…). AT e LM indicam ausência (atestado/licença), não aptidão nem ASO.
- **Cadastro** (`hist_novo_colaboradores`, `drake_qualification_workers`): matrícula, nome, função, unidade, situação. Nenhum campo de saúde.
- **Qualificações** (`drake_worker_qualifications`): cursos/treinamentos com data de validade.
  - Nenhum registro é de exame ASO.
  - Há cursos com "saúde" no nome. São treinamentos de normas (NR 18, NR 20, NR 33…) ou procedimentos internos, como "ITSMS-005 Avaliação de Saúde" e "ITSMS-006 Agendamento e Controle de ASO".
  - São cursos sobre o procedimento, não o resultado do exame do colaborador.
- **"fit / fit-with-warnings / unfit"** (aba Aptidão): resultado calculado no app comparando as qualificações exigidas pela função com as que o colaborador tem no Drake. Mede qualificação e treinamento, não aptidão médica.
- Na busca no código da integração por ASO, health, medical, occupational e exam não apareceu nenhum campo de saúde.

## (b) O que é manual no fluxo do My Step Time (Nomeações)
Todos estes campos ficam em `nomination_nominees` e são preenchidos por botões na tela de Nomeações:
- `sms_bloqueio_saude`: SMS responde Sim/Não em "Bloqueio de saúde?".
- `sms_aso_em_dia`: SMS responde Sim/Não em "ASO em dia?".
- `sms_aso_checked` (+ `_at`, `_by`): marcado automaticamente quando o SMS responde as duas perguntas. Também há uma marcação direta pelo operador, que grava data e autor.
- `aptidao_checked` (+ `_at`, `_by`): campo antigo de checklist, sem integração com o Drake.
- `aptidao_divergence`, `aptidao_divergence_text`, `aptidao_divergence_flagged_at`: o DP/RH sinaliza e resolve uma divergência à mão, digitando o texto.

Nenhum desses campos é preenchido ou atualizado pela sincronização com o Drake.

## Conclusão para o Sistema SMS
- Hoje, ASO, exame médico e aptidão médica só existem no My Step Time como respostas manuais do SMS durante uma nomeação. Isso já está no conjunto `nomination_sms_checks`, sem o campo de bloqueio de saúde.
- Para trazer ASO do Drake seria preciso confirmar com a equipe Drake se existe outro módulo ou relatório de saúde ocupacional. Ele não faz parte da integração atual.
- Nada foi alterado nesta investigação.
