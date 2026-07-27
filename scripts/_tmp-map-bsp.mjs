import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabase = createClient(
  "https://lzahnaekoiervgqxmouv.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6YWhuYWVrb2llcnZncXhtb3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MDIzOTcsImV4cCI6MjA5NjE3ODM5N30.k51qFrlebE1-UnpVPDBq7WymkxeZyUZuWxjNlen5LY8",
);
await supabase.auth.signInWithPassword({ email: process.env.STEP_EMAIL, password: process.env.STEP_PASS });

const norm = (s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const records = JSON.parse(fs.readFileSync(
  "C:/Users/BRUNA~1.ROQ/AppData/Local/Temp/claude/c--Cod-Projetos-logisticapessoalstep-main/801f2988-bdea-4f68-9011-52d4af4315c1/scratchpad/records.json",
  "utf8",
));

const bspByCombo = new Map();
records
  .filter((r) => r.bspMatchOk === true && r.bsp)
  .forEach((r) => {
    const key = `${norm(r.cliente)}|||${norm(r.vessel)}|||${norm(r.funcao)}`;
    if (!bspByCombo.has(key)) bspByCombo.set(key, new Set());
    bspByCombo.get(key).add(r.bsp.trim());
  });

console.log("Combos distintos com BSP mapeado:", bspByCombo.size);

const { data: rates, error } = await supabase.from("rates").select("id, client, vessel, funcao, bsp");
if (error) throw error;
console.log("Total rates na base:", rates.length);

let semBspAtual = 0, encontrados = 0, naoEncontrados = 0;
const paraAtualizar = [];
const semMatch = [];
rates.forEach((r) => {
  if (r.bsp) return; // já tem BSP, não mexe
  semBspAtual++;
  const key = `${norm(r.client)}|||${norm(r.vessel)}|||${norm(r.funcao)}`;
  const bsps = bspByCombo.get(key);
  if (bsps && bsps.size > 0) {
    encontrados++;
    paraAtualizar.push({ id: r.id, client: r.client, vessel: r.vessel, funcao: r.funcao, novoBsp: [...bsps].sort().join(", ") });
  } else {
    naoEncontrados++;
    semMatch.push({ client: r.client, vessel: r.vessel, funcao: r.funcao });
  }
});

console.log("Rates sem BSP atualmente:", semBspAtual);
console.log("Vão poder ser preenchidos:", encontrados);
console.log("Sem nenhuma ocorrência nas planilhas (ficam sem BSP):", naoEncontrados);
console.log("\n--- Exemplos de atualização (primeiros 15) ---");
paraAtualizar.slice(0, 15).forEach((p) => console.log(JSON.stringify(p)));
console.log("\n--- Combos sem nenhuma ocorrência (todos) ---");
semMatch.forEach((p) => console.log(JSON.stringify(p)));

fs.writeFileSync(
  "C:/Users/BRUNA~1.ROQ/AppData/Local/Temp/claude/c--Cod-Projetos-logisticapessoalstep-main/801f2988-bdea-4f68-9011-52d4af4315c1/scratchpad/rates-bsp-update-plan.json",
  JSON.stringify(paraAtualizar, null, 2),
);
console.log("\nPlano salvo em rates-bsp-update-plan.json");
