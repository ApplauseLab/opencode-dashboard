#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { basename, join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 4173);
const dbPath = process.env.OPENCODE_DB ?? join(process.env.HOME ?? "", ".local/share/opencode/opencode.db");
const publicDir = join(import.meta.dir, "public");

type UsageRow = {
  day: string;
  projectId: string;
  projectName: string | null;
  worktree: string;
  model: string | null;
  sessions: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  storedCost: number;
};

type ModelInfo = {
  id: string;
  providerID: string;
  variant?: string;
};

type Pricing = {
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  source: string;
  sourceUrl?: string;
};

const officialPricing: Record<string, Pricing> = {
  "openai:gpt-5.5": {
    label: "OpenAI GPT-5.5",
    input: 5,
    output: 30,
    cacheRead: 0.5,
    cacheWrite: 5,
    reasoning: 30,
    source: "official-openai",
    sourceUrl: "https://openai.com/api/pricing/",
  },
  "openai:gpt-5.4": {
    label: "OpenAI GPT-5.4",
    input: 2.5,
    output: 15,
    cacheRead: 0.25,
    cacheWrite: 2.5,
    reasoning: 15,
    source: "official-openai",
    sourceUrl: "https://openai.com/api/pricing/",
  },
  "anthropic:claude-opus-4-7": {
    label: "Anthropic Claude Opus 4.7",
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
    reasoning: 25,
    source: "official-anthropic",
    sourceUrl: "https://www.anthropic.com/pricing#api",
  },
};

const builtInPricing: Record<string, Pricing> = {
  "zai-coding-plan": { label: "Z.ai coding plan", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, source: "plan-included" },
};

function loadCustomPricing() {
  const raw = process.env.OPENCODE_PRICING_JSON;
  if (!raw) return {} as Record<string, Pricing>;
  try {
    return JSON.parse(raw) as Record<string, Pricing>;
  } catch (error) {
    console.warn(`Ignoring invalid OPENCODE_PRICING_JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {} as Record<string, Pricing>;
  }
}

const customPricing = loadCustomPricing();

function projectLabel(projectName: string | null, worktree: string) {
  if (projectName?.trim()) return projectName.trim();
  const normalized = normalize(worktree);
  const leaf = basename(normalized);
  if (leaf && leaf !== "/") return leaf;
  return normalized || "Unknown project";
}

function parseModel(model: string | null): ModelInfo {
  if (!model) return { id: "unknown", providerID: "unknown" };
  try {
    const parsed = JSON.parse(model) as Partial<ModelInfo>;
    return {
      id: parsed.id || "unknown",
      providerID: parsed.providerID || "unknown",
      variant: parsed.variant,
    };
  } catch {
    return { id: model, providerID: "unknown" };
  }
}

function pricingFor(model: ModelInfo) {
  return customPricing[`${model.providerID}:${model.id}`] ?? customPricing[model.providerID] ?? officialPricing[`${model.providerID}:${model.id}`] ?? builtInPricing[model.providerID] ?? null;
}

function estimateCost(row: UsageRow, pricing: Pricing | null) {
  if (row.storedCost > 0) return row.storedCost;
  if (!pricing) return null;
  return (
    row.input * pricing.input +
    row.output * pricing.output +
    row.reasoning * pricing.reasoning +
    row.cacheRead * pricing.cacheRead +
    row.cacheWrite * pricing.cacheWrite
  ) / 1_000_000;
}

function costSource(row: UsageRow, pricing: Pricing | null) {
  if (row.storedCost > 0) return "database";
  return pricing?.source ?? "unpriced";
}

function readUsage() {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query<UsageRow, []>(`
        select
          date(s.time_updated / 1000, 'unixepoch', 'localtime') as day,
          s.project_id as projectId,
          p.name as projectName,
          p.worktree as worktree,
          s.model as model,
          count(*) as sessions,
          sum(s.tokens_input) as input,
          sum(s.tokens_output) as output,
          sum(s.tokens_reasoning) as reasoning,
          sum(s.tokens_cache_read) as cacheRead,
          sum(s.tokens_cache_write) as cacheWrite,
          sum(
            s.tokens_input +
            s.tokens_output +
            s.tokens_reasoning +
            s.tokens_cache_read +
            s.tokens_cache_write
          ) as total,
          sum(s.cost) as storedCost
        from session s
        join project p on p.id = s.project_id
        where (
          s.tokens_input +
          s.tokens_output +
          s.tokens_reasoning +
          s.tokens_cache_read +
          s.tokens_cache_write
        ) > 0
        group by day, s.project_id, s.model
        order by day asc, total desc
      `)
      .all();

    const projects = new Map<string, { id: string; name: string; worktree: string; total: number; cost: number; costKnown: boolean; sessions: number }>();
    const daily = new Map<string, { day: string; total: number; cost: number; costKnown: boolean; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; sessions: number }>();
    const providers = new Map<string, { id: string; name: string; total: number; cost: number; costKnown: boolean; sessions: number }>();
    const models = new Map<string, { id: string; providerId: string; name: string; pricingSource: string; total: number; cost: number; costKnown: boolean; sessions: number }>();

    for (const row of rows) {
      const model = parseModel(row.model);
      const pricing = pricingFor(model);
      const cost = estimateCost(row, pricing);
      const name = projectLabel(row.projectName, row.worktree);
      const existing = projects.get(row.projectId) ?? {
        id: row.projectId,
        name,
        worktree: row.worktree,
        total: 0,
        cost: 0,
        costKnown: false,
        sessions: 0,
      };
      existing.total += row.total;
      existing.cost += cost ?? 0;
      existing.costKnown ||= cost !== null;
      existing.sessions += row.sessions;
      projects.set(row.projectId, existing);

      const provider = providers.get(model.providerID) ?? {
        id: model.providerID,
        name: model.providerID === "unknown" ? "Unknown provider" : model.providerID,
        total: 0,
        cost: 0,
        costKnown: false,
        sessions: 0,
      };
      provider.total += row.total;
      provider.cost += cost ?? 0;
      provider.costKnown ||= cost !== null;
      provider.sessions += row.sessions;
      providers.set(model.providerID, provider);

      const modelKey = `${model.providerID}:${model.id}${model.variant ? `:${model.variant}` : ""}`;
      const modelSummary = models.get(modelKey) ?? {
        id: modelKey,
        providerId: model.providerID,
        name: `${pricing?.label ?? `${model.providerID} ${model.id}`}${model.variant ? ` (${model.variant})` : ""}`,
        pricingSource: costSource(row, pricing),
        total: 0,
        cost: 0,
        costKnown: false,
        sessions: 0,
      };
      modelSummary.total += row.total;
      modelSummary.cost += cost ?? 0;
      modelSummary.costKnown ||= cost !== null;
      if (modelSummary.pricingSource === "unpriced" && cost !== null) modelSummary.pricingSource = costSource(row, pricing);
      modelSummary.sessions += row.sessions;
      models.set(modelKey, modelSummary);

      const day = daily.get(row.day) ?? {
        day: row.day,
        total: 0,
        cost: 0,
        costKnown: false,
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        sessions: 0,
      };
      day.total += row.total;
      day.cost += cost ?? 0;
      day.costKnown ||= cost !== null;
      day.input += row.input;
      day.output += row.output;
      day.reasoning += row.reasoning;
      day.cacheRead += row.cacheRead;
      day.cacheWrite += row.cacheWrite;
      day.sessions += row.sessions;
      daily.set(row.day, day);
    }

    return {
      dbPath,
      generatedAt: new Date().toISOString(),
      rows: rows.map((row) => {
        const model = parseModel(row.model);
        const pricing = pricingFor(model);
        return {
          ...row,
          cost: estimateCost(row, pricing),
          costKnown: estimateCost(row, pricing) !== null,
          costSource: costSource(row, pricing),
          model,
          pricing: pricing ?? { label: "Unpriced model", source: "unpriced" },
          projectName: projectLabel(row.projectName, row.worktree),
        };
      }),
      projects: [...projects.values()].sort((a, b) => b.total - a.total),
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
      providers: [...providers.values()].sort((a, b) => Number(b.costKnown) - Number(a.costKnown) || b.cost - a.cost),
      models: [...models.values()].sort((a, b) => Number(b.costKnown) - Number(a.costKnown) || b.cost - a.cost),
      pricingNote: "Costs use session.cost when OpenCode records it; otherwise official public pricing is used for matched models. Unmatched models stay N/A unless configured with OPENCODE_PRICING_JSON.",
    };
  } finally {
    db.close();
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function staticFile(pathname: string) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(publicDir, decodeURIComponent(requested));
  if (!filePath.startsWith(publicDir)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file);
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/usage") {
      try {
        return json(readUsage());
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error), dbPath }, 500);
      }
    }
    return staticFile(url.pathname);
  },
});

console.log(`OpenCode analytics running at http://localhost:${port}`);
console.log(`Reading ${dbPath}`);
