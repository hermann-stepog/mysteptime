# Auditoria read-only: dados do My Step Time úteis ao Sistema SMS/SGI

Esta auditoria só consultou dados. Nada foi alterado. Contagens de 06/10/2026.

## Identificador para casar pessoas

- `drake_qualification_workers.drake_worker_id` é o ID imutável do Drake.
- Todos os 629 workers casam com `hist_novo_colaboradores` por `registration = trim(matricula)` (teste por matrícula, sem considerar empresa).
- Recomendação: o SMS guarda `drake_worker_id` junto com o `source_id` (empresa::matrícula) que já sincroniza.

## Inventário priorizado

| Candidato | Origem | Cobertura | Classificação | Motivo / risco LGPD |
|---|---|---|---|---|
| `drake_worker_qualifications`: curso, `indicated_course_name`, `expiration_date` | Drake | 47.640 registros, 629 pessoas, 206 cursos distintos (Política de QSMS, NR 17, NR 26, Percepção de Risco, Proteção Auditiva etc.). `expiration_date` preenchida em 20.521. `issue_date` vazia em 100% | IMPORTAR AGORA | Base direta para Certificações/Treinamentos e vencimentos. Risco baixo: dado profissional. Limitação: não há data de emissão |
| `drake_qualification_workers`: `drake_worker_id`, `job_name`, `worker_state`, `worker_type`, `current_operational_unit_name` | Drake | 629 (628 ativos), última sincronização em 05/08/2026 | IMPORTAR AGORA | Melhor chave e unidade atual. Atenção: o snapshot está há cerca de 2 meses sem atualizar |
| `hist_novo_periodos`: `unidade_operacional`, `centro_de_custo`, `bsp`, `tipo`, datas | Drake | 20.210 períodos, 912 pessoas, de 03/2022 a 02/2030. Unidade em 18.103, centro de custo em 13.481 | IMPORTAR DEPOIS (só `unidade`/`centro_de_custo`/embarcado sim ou não) | Útil para GHE/exposição offshore, PT e LAIPR (quem estava a bordo). `tipo` inclui férias, atestado e folga: não enviar o motivo |
| `timesheet_embarques`: unidade, BSP, `funcao_embarque`, datas | Derivado do Drake | 7.419 embarques, 518 pessoas | IMPORTAR DEPOIS | Histórico de exposição por unidade/função. Risco baixo |
| `colaborador_funcoes_historico`: `funcao`, `embarcacao`, datas, `cod_alocacao` | Histórico de alocação (ligado ao cadastro mestre) | 1.012 registros, 238 pessoas | IMPORTAR DEPOIS | Função histórica para GHE. Cobertura parcial |
| `drake_qualification_options` (unidades/funções) | Drake | 1.137 opções | IMPORTAR DEPOIS | Catálogo de unidades e funções. Sem dado pessoal |
| `drake_qualification_requirements` / `contexts` | Drake | 0 linhas (vazias) | NÃO IMPORTAR | Sem dados hoje. A matriz é consultada ao vivo |
| `planejamento_embarque`: status, datas, unidade, BSP | Planilha/manual | 272 linhas, 257 matrículas | NÃO IMPORTAR agora | Operacional, manual, com férias e bloqueio RH. LGPD: alto |
| `nomination_nominees`: `sms_aso_em_dia`, `sms_bloqueio_saude`, aptidão, `quality_apto_solda` | Manual, por nomeação | 53 linhas | NÃO IMPORTAR | Dado de saúde (sensível). O SMS deve ser a origem, não o destino |
| `documents.expires_at` | Manual (app colaborador) | Pouco uso | NÃO IMPORTAR | Sem tipo padronizado. Avaliar depois |

## O que NÃO existe no My Step Time hoje

- Data de admissão (nenhum campo, em nenhuma fonte)
- Data de emissão de curso (a coluna existe, mas está 100% vazia)
- ASO como registro próprio: tipo, data, validade, médico. Só existem as marcações sim/não da nomeação
- Exames médicos, EPI/entregas, GHE, acidentes/incidentes, PT, LAIPR, inspeções, auditorias, licenças e planos de ação
- CPF, data de nascimento, contato pessoal dos colaboradores

## LGPD (resumo)

- Enviar só dado profissional: identidade funcional, função, unidade e cursos com vencimento.
- Nunca enviar: motivo de ausência (férias/atestado), bloqueio RH, observações livres, respostas de saúde das nomeações.
- Registrar a finalidade (gestão de SMS/SGI) e a base legal (obrigação legal/execução de contrato) antes de ampliar.

## Próximo passo sugerido (pedido separado)

Ampliar a integração read-only com `drake_worker_id` e um endpoint de qualificações (curso + vencimento). Antes, atualizar a sincronização do Drake.
