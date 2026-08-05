# Deploy da função `get-bm-smartsheet-data`

## O que será feito
Publicar novamente a função de backend `get-bm-smartsheet-data` (integração Smartsheet para BM), sem alterar o código.

## Detalhes técnicos
- Função: `supabase/functions/get-bm-smartsheet-data/index.ts` (inalterada)
- Ação: deploy via `supabase--deploy_edge_functions` com `["get-bm-smartsheet-data"]`
- Segredos usados já existem: `SMARTSHEET_TOKEN`, `SMARTSHEET_ID_1`, `SMARTSHEET_ID_2`
- Após o deploy: verificar os logs da função para confirmar que subiu sem erro

## Fora do escopo
Nenhuma mudança de código, schema ou frontend.
