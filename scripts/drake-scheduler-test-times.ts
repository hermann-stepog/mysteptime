/**
 * Calcula as próximas execuções do scheduler (não executa relatórios).
 * npm run drake:scheduler:test-times
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  getNextDrakeScheduleTimes,
} from "../src/lib/drake/scheduler-times.server";
import { DRAKE_SCHEDULER_TIMEZONE_DEFAULT } from "../src/lib/drake/scheduler-config.server";

function loadEnv() {
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();
const timezone =
  (process.env.DRAKE_SCHEDULER_TIMEZONE ?? DRAKE_SCHEDULER_TIMEZONE_DEFAULT).trim() ||
  DRAKE_SCHEDULER_TIMEZONE_DEFAULT;
const times = getNextDrakeScheduleTimes(new Date(), timezone);
console.log(`Timezone: ${times.timezone}`);
console.log(`Cron 00:00: ${times.cronMidnight}`);
console.log(`Cron 12:30: ${times.cronNoon}`);
console.log("Próximas execuções calculadas:");
console.log(`  meia-noite: ${times.nextMidnight}`);
console.log(`  12:30: ${times.nextNoon}`);
