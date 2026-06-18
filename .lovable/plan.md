## Objetivo

Garantir que você consiga entrar imediatamente como admin (Operador de Logística) sem precisar passar pelo fluxo de "Criar conta".

## O que será feito

1. **Criar/forçar a conta admin via migration** usando a Auth Admin API do backend:
   - E-mail: `hermann.siqueira@step-og.com`
   - Senha inicial: `StepAdmin@2026` (você troca depois em Configurações)
   - E-mail já confirmado (sem necessidade de verificação)
   - Nome completo: `Hermann Siqueira`

2. **Garantir o papel `logistics_operator`** em `user_roles` (idempotente — se a conta já existir, apenas atualiza o papel e a senha).

3. **Trigger `handle_new_user` permanece** como fallback para qualquer novo cadastro com esse e-mail.

## Como acessar depois

- URL: tela de login do app
- Aba: **Entrar**
- E-mail: `hermann.siqueira@step-og.com`
- Senha: `StepAdmin@2026`
- Recomendo trocar a senha no primeiro acesso.

## Sobre Microsoft SSO

O login via Microsoft / Azure AD requer SAML SSO (não está no fluxo OAuth gerenciado). Posso configurar em uma etapa separada quando você tiver os metadados do Azure AD em mãos (URL de metadata do tenant + domínios permitidos). Por enquanto, mantemos e-mail/senha conforme combinado na v1.

## Detalhes técnicos

- Uma migration SQL idempotente chama funções do schema `auth` para criar o usuário se não existir, ou atualizar a senha se já existir, e em seguida garante a linha em `public.user_roles` com papel `logistics_operator` e a linha em `public.profiles`.
- Nenhum código de aplicação muda — apenas dados de bootstrap.
