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
  sessions: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

function projectLabel(projectName: string | null, worktree: string) {
  if (projectName?.trim()) return projectName.trim();
  const normalized = normalize(worktree);
  const leaf = basename(normalized);
  if (leaf && leaf !== "/") return leaf;
  return normalized || "Unknown project";
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
          ) as total
        from session s
        join project p on p.id = s.project_id
        where (
          s.tokens_input +
          s.tokens_output +
          s.tokens_reasoning +
          s.tokens_cache_read +
          s.tokens_cache_write
        ) > 0
        group by day, s.project_id
        order by day asc, total desc
      `)
      .all();

    const projects = new Map<string, { id: string; name: string; worktree: string; total: number; sessions: number }>();
    const daily = new Map<string, { day: string; total: number; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; sessions: number }>();

    for (const row of rows) {
      const name = projectLabel(row.projectName, row.worktree);
      const existing = projects.get(row.projectId) ?? {
        id: row.projectId,
        name,
        worktree: row.worktree,
        total: 0,
        sessions: 0,
      };
      existing.total += row.total;
      existing.sessions += row.sessions;
      projects.set(row.projectId, existing);

      const day = daily.get(row.day) ?? {
        day: row.day,
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        sessions: 0,
      };
      day.total += row.total;
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
      rows: rows.map((row) => ({
        ...row,
        projectName: projectLabel(row.projectName, row.worktree),
      })),
      projects: [...projects.values()].sort((a, b) => b.total - a.total),
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
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
