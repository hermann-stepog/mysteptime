-- Cargo/perfil da pessoa (ex.: "Diretor", "Gerente de Operações") — texto livre, opcional,
-- diferente do "papel" (user_roles.role, que controla permissão de acesso). Aparece no
-- cabeçalho ao lado do nome ("Nome - Perfil") em todos os ambientes.
ALTER TABLE public.profiles ADD COLUMN perfil TEXT;
