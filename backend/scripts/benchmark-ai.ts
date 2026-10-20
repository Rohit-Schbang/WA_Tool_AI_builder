// AI pipeline benchmark: plan + build every sample draw.io file through the
// REAL generator (real Gemini calls, no database writes) and record cost,
// speed and quality (the fidelity report) so changes can be compared.
//
//   node --import tsx scripts/benchmark-ai.ts <label> [fileFilter]
//
// Thinking caps come from the AI_THINKING_* env vars (see infra/config.ts);
// set them to "default" to measure the uncapped baseline.
import fs from "fs";
import path from "path";
import { onAiUsage, type AiUsage } from "../src/modules/runtime/aiProvider.js";
import { planOnly, generateJourney } from "../src/modules/workflows/generator.js";
import { config } from "../src/infra/config.js";

const label = process.argv[2] ?? "run";
const filter = process.argv[3] ?? "";
const samplesDir = path.resolve(process.cwd(), "..", "samples");
const outDir = path.resolve(process.cwd(), "scripts", "bench-results");
fs.mkdirSync(outDir, { recursive: true });

interface StepTotals { calls: number; prompt: number; thought: number; output: number; total: number; ms: number; failed: number }
const sum = (list: AiUsage[]): StepTotals => list.reduce(
  (t, u) => ({ calls: t.calls + 1, prompt: t.prompt + u.promptTokens, thought: t.thought + u.thoughtTokens, output: t.output + u.outputTokens, total: t.total + u.totalTokens, ms: t.ms + u.ms, failed: t.failed + (u.ok ? 0 : 1) }),
  { calls: 0, prompt: 0, thought: 0, output: 0, total: 0, ms: 0, failed: 0 }
);

async function runOne(file: string) {
  const xml = fs.readFileSync(path.join(samplesDir, file), "utf8");
  const usage: AiUsage[] = [];
  const off = onAiUsage((u) => usage.push(u));
  const t0 = Date.now();
  let planMs = 0, buildMs = 0, error: string | null = null, report: any = null, planStages = 0, nodes = 0;
  try {
    const { plan } = await planOnly("", xml);
    planMs = Date.now() - t0;
    planStages = plan.length;
    const t1 = Date.now();
    const res = await generateJourney("", xml, plan as any, undefined, []);
    buildMs = Date.now() - t1;
    report = res.report ?? null;
    nodes = res.definition?.nodes.length ?? 0;
  } catch (err: any) {
    error = String(err?.message ?? err);
  } finally {
    off();
  }
  const s = report?.summary;
  return {
    file,
    error,
    planStages,
    nodes,
    seconds: { plan: planMs / 1000, build: buildMs / 1000, total: (Date.now() - t0) / 1000 },
    tokens: {
      all: sum(usage),
      byStep: Object.fromEntries([...new Set(usage.map((u) => u.step))].map((st) => [st, sum(usage.filter((u) => u.step === st))])),
    },
    quality: report ? {
      status: report.status,
      failedChecks: report.items.filter((i: any) => i.status === "failed").length,
      warnings: report.items.filter((i: any) => i.status === "warning").length,
      connections: `${s.connectionsVerified}/${s.connectionsTotal}`,
      messages: `${s.messagesVerified}/${s.messagesTotal}`,
      questions: `${s.questionsVerified}/${s.questionsTotal}`,
      branches: `${s.branchesVerified}/${s.branchesTotal}`,
      events: `${s.eventsVerified}/${s.eventsTotal}`,
      sim: `${s.testsPassed} pass / ${s.testsFailed} fail / ${s.testsNotRun} n/t`,
      shapesMapped: `${s.mappedShapes}/${s.sourceShapes}`,
      repairs: s.repairAttempts,
      failedItems: report.items.filter((i: any) => i.status === "failed").map((i: any) => `[${i.category}] ${i.message}`),
    } : null,
  };
}

async function main() {
  const files = fs.readdirSync(samplesDir).filter((f) => f.endsWith(".drawio") && f.includes(filter)).sort();
  console.log(`[bench] ${label}: model=${config.GEMINI_MODEL} thinking plan=${config.AI_THINKING_PLAN} build=${config.AI_THINKING_BUILD} repair=${config.AI_THINKING_REPAIR}/${config.AI_THINKING_REPAIR_FINAL}`);
  const results = [];
  for (const f of files) {
    console.log(`[bench] ${f} …`);
    const r = await runOne(f);
    results.push(r);
    console.log(`[bench] ${f}: ${r.error ? `ERROR ${r.error}` : `${r.seconds.total.toFixed(0)}s, ${r.tokens.all.calls} calls, think=${r.tokens.all.thought}, total=${r.tokens.all.total}, status=${r.quality?.status}, failed=${r.quality?.failedChecks}`}`);
    fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ label, model: config.GEMINI_MODEL, thinking: { plan: config.AI_THINKING_PLAN, build: config.AI_THINKING_BUILD, repair: config.AI_THINKING_REPAIR, repairFinal: config.AI_THINKING_REPAIR_FINAL }, results }, null, 2));
  }
  console.log("[bench] done");
  process.exit(0);
}

main();
