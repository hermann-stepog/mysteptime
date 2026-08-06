# Aba "Timesheets" no BM (cópia editável do Timesheet Offshore)

Nova aba no módulo Boletim de Medição que traz uma **cópia** dos timesheets do Timesheet Offshore, editável apenas dentro do BM. Nada do que for alterado aqui volta para o Timesheet Offshore.

## Fluxo

```text
Período selecionado
   ↓
Cartões das BSPs do período
   ↓
BSP selecionada
   ↓
Colaboradores daquela BSP
   ↓
Timesheets em lista editável (estilo planilha)
```

## Como funciona

1. **Filtro de período** no topo da aba (data inicial e final), independente de qualquer BM já criado — mesmo padrão da aba Logística Mob/Desmob.
2. Ao abrir o período, o sistema **copia automaticamente** para o BM os dias de timesheet do intervalo que ainda não foram copiados. Dias já copiados e editados ficam intactos — a cópia nunca sobrescreve ajustes da Medição.
3. **Cartões de BSP**: um cartão por BSP presente no período, com número da BSP, quantidade de colaboradores e de dias. Clicar seleciona a BSP.
4. Dentro da BSP: lista agrupada por colaborador (nome + função), e abaixo os dias em formato de planilha compacta.
5. **Todos os campos são editáveis** na própria linha: data, dia da semana, evento, BSP do dia, descrição/número da tarefa, hora entrada/saída, entrada/saída extra, horas normais, horas extras, total de horas, adicional noturno e feriado. Salvamento automático ao sair do campo, com indicação visual da linha alterada em relação ao original.
6. Ações de apoio: "Restaurar original" por linha (volta ao valor vindo do Timesheet Offshore) e busca por colaborador.
7. **Efeito no cálculo**: a geração de Mão de Obra do BM passa a usar esta cópia editada como fonte, em vez de ler os dias direto do Timesheet Offshore. Dias ainda não copiados continuam entrando pelo valor original.

## Detalhes técnicos

- **Nova tabela `public.bm_timesheet_dias`** (migration aditiva, com GRANTs e RLS restrita a operador logístico, mesmo padrão das demais tabelas de BM):
  - `source_dia_id` (uuid, único) — referência ao `timesheet_dias.id` de origem, usada para não duplicar na cópia automática;
  - denormalizados para não depender do Timesheet Offshore depois de copiado: `colaborador_id`, `colaborador_nome`, `funcao`, `unidade_operacional`, `bsp`, `data`;
  - todos os campos do dia: `dia_semana`, `evento`, `descricao_tarefa`, `numero_tarefa`, `hora_entrada`, `hora_saida`, `hora_entrada_extra`, `hora_saida_extra`, `horas_normais`, `horas_extras`, `total_horas`, `adicional_noturno`, `feriado`;
  - snapshot do original em `original` (jsonb) para o "Restaurar original" e para destacar o que foi alterado;
  - `created_at` / `updated_at` com trigger.
- **Novo componente** `src/components/bm/TimesheetsTab.tsx` com o filtro, os cartões de BSP e a grade editável; registrado como quarta aba em `src/routes/admin/bm.tsx`.
- Leitura/cópia/gravação via TanStack Query + client Supabase, seguindo o padrão já usado em `MobDesmobTab`.
- No wizard (`GerarBmWizard`), a query `bm-dias` passa a preferir a linha correspondente em `bm_timesheet_dias` quando ela existir, mantendo o restante da agregação (`aggregateMaoDeObra`) inalterado.
- Nenhuma escrita em `timesheet_dias`, `timesheet_semanas` ou `timesheet_embarques`.
