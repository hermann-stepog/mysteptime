# Chave real de public.drake_worker_qualifications (somente leitura)

Nada foi alterado.

## Constraints
- **PRIMARY KEY (drake_worker_id, qualification_id)**, com índice único `drake_worker_qualifications_pkey`
- FOREIGN KEY `drake_worker_id` -> `drake_qualification_workers(drake_worker_id)` ON DELETE CASCADE
- Índices comuns (não únicos) em `drake_worker_id` e em `qualification_id`

## Respostas
- **Existe no máximo uma linha por (drake_worker_id, qualification_id)?** Sim. A PK garante isso, e os dados confirmam: 47.640 linhas e 47.640 pares distintos.
- **qualification_id sozinho pode repetir entre trabalhadores?** Sim. Ele identifica o curso, não a linha. Há 206 qualification_id distintos, e 201 deles aparecem em mais de um trabalhador.

## Implicação para a integração SMS
A chave de upsert no SMS deve ser o par `(drake_worker_id, qualification_id)`, nunca `qualification_id` sozinho.
