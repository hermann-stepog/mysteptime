## Objetivo

Usar a imagem social (plataforma offshore ao pôr do sol) como plano de fundo do painel esquerdo da página de login (`/auth`), substituindo o fundo navy sólido atual.

## Mudanças

1. **Upload da imagem** como Lovable Asset (`src/assets/auth-hero.jpg.asset.json`) a partir do arquivo enviado.
2. **`src/routes/auth.tsx`** — no painel esquerdo (visível em `lg:`):
   - Definir `background-image` com a imagem do asset, `cover` + `center`.
   - Adicionar um overlay escuro com gradient do navy da marca (`from-sidebar/95 via-sidebar/80 to-sidebar/40`) para garantir contraste do logo e do texto.
   - Logo, headline, parágrafo e copyright permanecem como estão, agora sobre a imagem.
3. Nenhuma outra tela é alterada. O painel direito (formulário) permanece igual.

## Detalhes técnicos

- Asset criado via `lovable-assets create` (sem deixar o binário no repo).
- Imagem aplicada como `style={{ backgroundImage: \`url(${heroAsset.url})\` }}` no container `lg:flex` existente, com um `<div>` overlay absolutamente posicionado abaixo do conteúdo.
