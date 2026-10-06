# Investigação direta no Drake (ASO / saúde ocupacional): bloqueada no login

## O que foi feito (somente leitura, nada alterado)
- Tentado o login HTTP no Drake com o cliente e as credenciais de ambiente que já existem no projeto, sem exibir usuário, senha, cookies ou tokens.
- O banco do My Step Time não foi consultado.
- Nenhum arquivo do projeto e nenhum dado foi alterado.

## Onde travou
O login passou da etapa da Microsoft, mas o Drake recusou a entrada:
- Na etapa de confirmação de login (`/LoginCallback.ashx`), o Drake devolveu redirecionamento para a tela de login (`/Logon`) em vez de abrir a sessão.
- Mensagem do próprio código: "O Drake nao aceitou o token de autenticacao."
- Por isso não foi possível chegar ao menu (`/api/v2/Authorization/Menu`) nem às telas de ASO, Licença médica, Afastamento, Retorno ao trabalho ou Documentos.

Sem acesso ao menu, nenhum endpoint de ASO foi descoberto. Nenhum campo de ASO pode ser confirmado nesta rodada, e nada foi inventado.

## Causas prováveis (não confirmadas)
1. A conta de serviço do Drake configurada no ambiente de testes está com a senha desatualizada, sem acesso ou exigindo nova confirmação. A sincronização publicada pode estar usando outra sessão já salva.
2. O Drake pode recusar logins vindos do ambiente de testes, por bloqueio de origem ou do provedor Microsoft.

## Próximo passo proposto (precisa de você)
Escolha uma opção:
- **A)** Confirmar ou atualizar as credenciais da conta de serviço do Drake. Com elas valendo, refaço a mesma investigação: menu, telas de SMS/ASO, endpoints só de consulta, contagens e campos reais.
- **B)** Você abre no Drake, pelo navegador, a tela "Gerenciar ASO" e me envia a lista de chamadas de rede da tela (sem cookies), exportada pelo navegador. Com isso mapeio endpoints e campos sem precisar fazer login.

Até ter acesso, a regra continua: só chamadas de consulta. Nenhum Sync, Save, Create, Update ou Delete.
