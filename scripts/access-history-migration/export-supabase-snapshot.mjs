import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { writeCsv } from "./lib.mjs";

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

async function selectAll(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.code ?? "erro"} ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const args = argsOf(process.argv.slice(2));
if (args.help || !args.output) {
  console.log("Uso: node --env-file=.env export-supabase-snapshot.mjs --output <diretorio>");
  process.exit(args.help ? 0 : 2);
}

const url = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  throw new Error(
    "A fotografia confiável exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. A chave publishable pode retornar zero por RLS e não é aceita.",
  );
}

const client = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const output = path.resolve(args.output);
await mkdir(output, { recursive: true });

// Este arquivo contém deliberadamente apenas operações SELECT.
const [collaborators, periods, functions] = await Promise.all([
  selectAll(
    client,
    "hist_novo_colaboradores",
    "id,matricula,nome,empresa,funcao,funcao_operacao,ativo,created_at",
  ),
  selectAll(
    client,
    "hist_novo_periodos",
    "id,colaborador_id,unidade_operacional,centro_de_custo,bsp,tipo,data_inicio,data_fim,dias,origem,created_at",
  ),
  selectAll(
    client,
    "colaborador_funcoes_historico",
    "id,colaborador_id,funcao,embarcacao,data_inicio,data_fim,cod_alocacao,criado_em",
  ),
]);

await Promise.all([
  writeCsv(path.join(output, "hist_novo_colaboradores.csv"), collaborators),
  writeCsv(path.join(output, "hist_novo_periodos.csv"), periods),
  writeCsv(path.join(output, "colaborador_funcoes_historico.csv"), functions),
]);

const originCounts = Object.fromEntries(
  Array.from(
    periods.reduce(
      (map, row) => map.set(row.origem ?? "(null)", (map.get(row.origem ?? "(null)") ?? 0) + 1),
      new Map(),
    ),
  ).sort(),
);
const summary = {
  formatVersion: 1,
  capturedAtUtc: new Date().toISOString(),
  readOnly: true,
  counts: {
    collaborators: collaborators.length,
    periods: periods.length,
    functions: functions.length,
  },
  periodRange: {
    min:
      periods
        .map((row) => row.data_inicio)
        .filter(Boolean)
        .sort()[0] ?? null,
    max:
      periods
        .map((row) => row.data_fim)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
  },
  originCounts,
};
await writeFile(
  path.join(output, "snapshot-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ ok: true, output, ...summary.counts }));
