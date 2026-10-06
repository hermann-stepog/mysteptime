# Significado dos códigos de hist_novo_periodos.tipo (somente leitura)

Nada foi alterado. Fonte principal: `TIPO_LABEL` em `src/lib/histogramaNovo.ts` (linhas 96-125).

| Código | Significado |
|---|---|
| E | Embarcado |
| DES | Desembarque |
| STB | Standby |
| F | Folga |
| HTL | Hotel (inclui Hotel Pré-Embarque e Quarentena Hotel, pelo mapa do Access) |
| DB | Dobra |
| CANC | Embarque Cancelado (inclui Hotel Embarque Cancelado) |
| DDN | Desembarque em Dia Não Útil (contado como Folga) |
| AT | Atestado (médico) |
| TE | Trabalho Externo |
| FI | Folga Indenizada |
| FE | Férias |
| FIH | Folga Indenizada Hotel |
| BASE | Na Base (trabalhando em terra) |
| FIF | Folga Indenizada Férias |
| FIC | Folga Indenizada Cancelamento |
| AFA | Afastamento |
| TR | Treinamento (inclui Integração) |
| FT | Falta |
| NS | No Show |
| FIE | Folga Indenizada Trabalho Externo |
| FIT | Folga Indenizada Treinamento |

Outros códigos que existem no mesmo mapa mas não foram pedidos: P (Programado), EC (Empresa em Casa), DI (Disponível), LM/LMV (Licença Médica), AD (À Disposição).

## Onde é usado
- `src/lib/histogramaNovo.ts`: rótulos (`TIPO_LABEL`), cores do Histograma e da legenda, e siglas curtas na grade (ex.: BASE → "B", CANC → "EC").
- `src/lib/histograma/drake-snapshot.ts` e `import-drake.ts`: conversão dos eventos do Drake nesses códigos (DDN é preservado e tratado como Folga).
- `scripts/access-history-migration/access-history.config.json`: mapa do legado Access, rótulo → código.
- `src/lib/smartsheet.ts`: tradução de BASE para "IND" na visão do Smartsheet.
- Usados nos KPIs do Histograma Offshore, no Timesheet e no BM (`bmDayGrid`), e nos próximos eventos (`upcoming-events.ts`).

## Atenção LGPD para o SMS
AT, AFA, FE, FI*, FT e NS revelam motivo de ausência (saúde, faltas). Se forem expostos ao SMS, recomenda-se agrupar em embarcado / disponível / indisponível.
