-- Troca de senha obrigatória no primeiro acesso quando um operador cria o usuário ou redefine
-- a senha dele (a senha que o operador digita é só provisória) — pedido dela. Quem se cadastra
-- sozinho escolhe a própria senha, então não precisa trocar (fica false por padrão), mas
-- continua com a opção de trocar quando quiser (ver ChangePassword.tsx).
ALTER TABLE public.profiles ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
