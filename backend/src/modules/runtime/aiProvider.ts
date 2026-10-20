import { config } from "../../infra/config";

// ---------------------------------------------------------------------------
// Gemini client.
//
// Every call is tagged with the pipeline STEP it belongs to. The step decides
// the thinking cap (see AI_THINKING_* in config.ts) and is used in the usage
// log, so token cost and latency can be measured per step.
// ---------------------------------------------------------------------------

export type AiStep = "plan" | "build" | "repair" | "repair_final" | "fix" | "patch" | "reply";

export interface AiUsage {
  step: AiStep;
  model: string;
  thinking: string;            // what was requested ("low", "1024", "default"…)
  promptTokens: number;
  cachedTokens: number;
  thoughtTokens: number;
  outputTokens: number;
  totalTokens: number;
  ms: number;
  ok: boolean;
}

// Usage listeners (benchmarks / metrics). Each call also prints one log line.
const listeners = new Set<(u: AiUsage) => void>();
export function onAiUsage(fn: (u: AiUsage) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function thinkingSettingFor(step: AiStep): string {
  switch (step) {
    case "plan": return config.AI_THINKING_PLAN;
    case "build": return config.AI_THINKING_BUILD;
    case "repair": case "fix": case "patch": return config.AI_THINKING_REPAIR;
    case "repair_final": return config.AI_THINKING_REPAIR_FINAL;
    case "reply": return config.AI_THINKING_REPLY;
  }
}

const LEVEL_BUDGET: Record<string, number> = { minimal: 0, low: 1024, medium: 4096, high: 16384 };

// Translate a setting into the request field the model understands:
// Gemini 3+ -> thinkingLevel, Gemini 2.x -> thinkingBudget. "default" -> none.
export function thinkingConfigFor(model: string, setting: string): Record<string, unknown> | undefined {
  const s = String(setting ?? "default").trim().toLowerCase();
  if (!s || s === "default") return undefined;
  const isGemini2 = /gemini-2(\.|-)/.test(model);
  const asNumber = /^-?\d+$/.test(s) ? Number(s) : null;
  if (isGemini2) {
    const budget = asNumber ?? LEVEL_BUDGET[s];
    return budget === undefined ? undefined : { thinkingBudget: budget };
  }
  if (asNumber !== null) {
    // Budgets map onto the nearest level for level-based models.
    const level = asNumber <= 0 ? "minimal" : asNumber <= 2048 ? "low" : asNumber <= 8192 ? "medium" : "high";
    return { thinkingLevel: level };
  }
  return LEVEL_BUDGET[s] !== undefined ? { thinkingLevel: s } : undefined;
}

// Thinking tokens count against maxOutputTokens, so the answer gets room on
// top of the thinking cap (prevents truncated JSON caused by long thinking).
function outputLimit(base: number, thinking: Record<string, unknown> | undefined): number {
  if (!thinking) return base; // uncapped thinking: keep the old behaviour
  const budget = typeof thinking?.thinkingBudget === "number"
    ? Math.max(0, thinking.thinkingBudget as number)
    : LEVEL_BUDGET[String(thinking?.thinkingLevel ?? "")] ?? 16384;
  return Math.min(base + budget, 65536);
}

async function callGemini(
  step: AiStep,
  prompt: string,
  generationConfig: Record<string, unknown>,
  maxOutputTokens: number
): Promise<any> {
  if (!config.GEMINI_API_KEY) throw new Error("AI API Key is not configured");
  const model = config.GEMINI_MODEL;
  const setting = thinkingSettingFor(step);
  let thinking = thinkingConfigFor(model, setting);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const send = (withThinking: Record<string, unknown> | undefined) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          ...generationConfig,
          maxOutputTokens: outputLimit(maxOutputTokens, withThinking),
          ...(withThinking ? { thinkingConfig: withThinking } : {}),
        },
      }),
    });

  const started = Date.now();
  let response = await send(thinking);
  // A model that rejects this thinking setting still answers (uncapped)
  // instead of failing the whole build.
  if (response.status === 400 && thinking) {
    const errText = await response.text();
    if (/thinking/i.test(errText)) {
      console.warn(`[ai] ${model} rejected thinkingConfig ${JSON.stringify(thinking)}; retrying without it`);
      thinking = undefined;
      response = await send(undefined);
    } else {
      emit(step, model, setting, null, Date.now() - started, false);
      throw new Error(`AI API Error: 400 ${errText}`);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    emit(step, model, setting, null, Date.now() - started, false);
    throw new Error(`AI API Error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  emit(step, model, thinking ? setting : "default", data?.usageMetadata, Date.now() - started, true);
  return data;
}

function emit(step: AiStep, model: string, thinking: string, u: any, ms: number, ok: boolean) {
  const usage: AiUsage = {
    step, model, thinking, ms, ok,
    promptTokens: u?.promptTokenCount ?? 0,
    cachedTokens: u?.cachedContentTokenCount ?? 0,
    thoughtTokens: u?.thoughtsTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    totalTokens: u?.totalTokenCount ?? 0,
  };
  console.log(
    `[ai] ${step} thinking=${thinking} in=${usage.promptTokens} (cached ${usage.cachedTokens}) ` +
    `think=${usage.thoughtTokens} out=${usage.outputTokens} ${(ms / 1000).toFixed(1)}s${ok ? "" : " FAILED"}`
  );
  for (const fn of listeners) {
    try { fn(usage); } catch { /* listener errors never break a call */ }
  }
}

function textOf(candidate: any): string {
  // Join all text parts (long answers can be split across several); skip
  // thought-summary parts if the API ever includes them.
  return (candidate?.content?.parts ?? [])
    .filter((p: any) => !p?.thought)
    .map((p: any) => p?.text ?? "")
    .join("");
}

// AI generative reply (AI Reply node in live conversations).
export async function generateAiReply(prompt: string): Promise<string> {
  const data = await callGemini("reply", prompt, {}, 2048);
  const text = textOf(data?.candidates?.[0]);
  if (!text) throw new Error("AI returned no text");
  return text.trim();
}

// Ask Gemini for a JSON response (AI journey generator). Uses JSON response
// mode, and strips any stray code fences before parsing.
export async function generateJson(
  prompt: string,
  opts: { temperature?: number; maxOutputTokens?: number; step?: AiStep } = {}
): Promise<any> {
  const data = await callGemini(
    opts.step ?? "build",
    prompt,
    { responseMimeType: "application/json", temperature: opts.temperature ?? 0.4 },
    // Room for the ANSWER; the thinking cap is added on top in callGemini.
    opts.maxOutputTokens ?? 32768
  );
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error("AI_OUTPUT_TRUNCATED: the generated flow was too long and got cut off");
  }
  let text = textOf(candidate);
  if (!text) throw new Error("AI returned no text");

  // Strip ```json fences if the model added them despite JSON mode.
  text = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}
