// Gemini function-calling loop. The model proposes tool calls; we execute the
// allowed tool, feed the result back, and repeat until it returns prose.
import type { AgentDefinition, ToolContext, ToolSource } from "./types.ts";

// gemini-2.0-flash was retired by Google (404 as of 2026-07); overridable so
// the next retirement is a secret change, not a redeploy.
export const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const ENDPOINT = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
const MAX_TURNS = 6;

interface LoopResult {
  answer: string;
  sources: ToolSource[];
  tokensUsed: number;
  toolCalls: string[];
}

// deno-lint-ignore no-explicit-any
type Part = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Content = { role: string; parts: Part[] };

export interface HistoryTurn {
  role: "user" | "model";
  text: string;
}

export async function runToolLoop(
  agent: AgentDefinition,
  userQuery: string,
  ctx: ToolContext,
  apiKey: string,
  history: HistoryTurn[] = [],
): Promise<LoopResult> {
  const functionDeclarations = agent.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  // Multi-turn: prior conversation (prose only — tool exchanges are not
  // replayed; the model re-fetches anything it still needs) + the new message.
  const contents: Content[] = [
    ...history
      .filter((h) => (h.role === "user" || h.role === "model") && typeof h.text === "string" && h.text.trim())
      .slice(-20) // cap context growth
      .map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: userQuery }] },
  ];
  let tokensUsed = 0;
  const toolCalls: string[] = [];
  const maxTurns = agent.maxTurns ?? MAX_TURNS;

  for (let turn = 0; turn < maxTurns; turn++) {
    const body = {
      systemInstruction: { parts: [{ text: agent.systemPrompt }] },
      contents,
      tools: [{ functionDeclarations }],
      generationConfig: { temperature: 0.2 },
    };

    // Transient upstream failures are retried before the run is abandoned.
    // Gemini answers 503 "this model is currently experiencing high demand"
    // often enough that a single one was losing whole assessment narratives,
    // and the caller has no way to distinguish that from a real fault.
    // Backoff is short and capped: an edge function has a wall clock, and a
    // user waiting on a report would rather be told than kept hanging.
    const TRANSIENT = new Set([429, 500, 502, 503, 504]);
    let resp!: Response;
    for (let attempt = 0; ; attempt++) {
      resp = await fetch(ENDPOINT(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) break;
      const retriable = TRANSIENT.has(resp.status) && attempt < 2;
      if (!retriable) {
        const txt = await resp.text();
        throw new Error(`Gemini API ${resp.status}: ${txt.slice(0, 500)}`);
      }
      // Drain the body so the connection is released before sleeping.
      await resp.text().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
    const json = await resp.json();
    tokensUsed += json?.usageMetadata?.totalTokenCount ?? 0;

    const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      // No more tool calls — final answer.
      const answer = parts.map((p) => p.text ?? "").join("").trim();
      return { answer: answer || "(no answer produced)", sources: ctx.sources, tokensUsed, toolCalls };
    }

    // Echo the model turn, then run each requested tool and reply.
    contents.push({ role: "model", parts });
    const responseParts: Part[] = [];
    for (const c of calls) {
      const name = c.functionCall.name as string;
      const tool = agent.tools.find((t) => t.name === name);
      toolCalls.push(name);
      if (!tool) {
        responseParts.push({ functionResponse: { name, response: { error: `Unknown tool ${name}` } } });
        continue;
      }
      if (tool.tier > agent.maxTier) {
        responseParts.push({
          functionResponse: { name, response: { error: `Tool ${name} exceeds the agent's autonomy tier` } },
        });
        continue;
      }
      try {
        const result = await tool.run(c.functionCall.args ?? {}, ctx);
        responseParts.push({ functionResponse: { name, response: { result: result.data, warnings: result.warnings } } });
      } catch (e) {
        responseParts.push({ functionResponse: { name, response: { error: String(e) } } });
      }
    }
    contents.push({ role: "user", parts: responseParts });
  }

  return {
    answer: "Analysis stopped: reached the maximum number of tool-calling steps. Partial results may be available above.",
    sources: ctx.sources,
    tokensUsed,
    toolCalls,
  };
}
