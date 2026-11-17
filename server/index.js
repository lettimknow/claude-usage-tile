#!/usr/bin/env node
/*
 * Claude Code usage tile - a tiny local MCP server.
 *
 * Reads Claude Code session transcripts (~/.claude/projects) and returns
 * per-day usage totals for the tile artifact. No dependencies; runs on the
 * Node.js that ships with Claude Desktop. Speaks MCP over stdio
 * (newline-delimited JSON-RPC 2.0).
 *
 * Run `node server/index.js --print` to see the numbers in the terminal.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_NAME = "claude-usage-tile";
const SERVER_VERSION = "0.5.0";
const TOOL_NAME = "get_usage_stats";
const CACHE_VERSION = 5;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function cacheFile() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, SERVER_NAME, "cache.json");
}

function log(message) {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

// ------------------------------------------------------------------ parsing

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isTranscriptLine(line) {
  return line.includes('"type":"user"') || line.includes('"type":"assistant"') ||
    line.includes('"type": "user"') || line.includes('"type": "assistant"');
}

/*
 * Aggregate one transcript file the way the Claude Desktop start-screen card
 * did: a main transcript is one session; its user and assistant entries are
 * messages; tokens come from main and subagent transcripts alike, summed over
 * every assistant line (Claude Code writes one line per content block, each
 * repeating the message's usage, and the card counted each of them).
 */
function parseTranscript(file, isSubagent) {
  const text = fs.readFileSync(file, "utf8");
  const entries = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!isTranscriptLine(line)) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || (entry.type !== "user" && entry.type !== "assistant")) continue;
    if (!isSubagent && entry.isSidechain) continue;
    const when = new Date(entry.timestamp);
    if (typeof entry.timestamp !== "string" || Number.isNaN(when.getTime())) continue;
    entries.push([when, entry]);
  }
  if (entries.length === 0) return null;

  const days = {}; // date -> [messages, toolCalls, {model: tokens}, {model: [input, output]}]
  const day = (date) => (days[date] ||= [0, 0, {}, {}]);

  for (const [when, entry] of entries) {
    const date = localDate(when);
    if (!isSubagent) day(date)[0] += 1;
    if (entry.type !== "assistant") continue;
    const message = entry.message || {};
    if (!isSubagent && Array.isArray(message.content)) {
      day(date)[1] += message.content.filter((b) => b && b.type === "tool_use").length;
    }
    const usage = message.usage;
    const model = message.model || "unknown";
    if (!usage || typeof usage !== "object" || model === "<synthetic>") continue;
    const count = (key) => {
      const value = Number(usage[key]);
      return Number.isFinite(value) ? value : 0;
    };
    const input = count("input_tokens");
    const output = count("output_tokens");
    const tokens = input + output + count("cache_read_input_tokens") + count("cache_creation_input_tokens");
    if (tokens) {
      const [, , perModel, io] = day(date);
      perModel[model] = (perModel[model] || 0) + tokens;
      const pair = (io[model] ||= [0, 0]);
      pair[0] += input;
      pair[1] += output;
    }
  }

  const record = { days };
  if (!isSubagent) {
    const first = entries[0][0];
    const last = entries[entries.length - 1][0];
    record.session = [localDate(first), first.getHours(), last - first, entries.length];
  }
  return record;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function transcriptFiles(root) {
  const files = [];
  const projects = path.join(root, "projects");
  for (const project of listDir(projects)) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(projects, project.name);
    for (const item of listDir(projectDir)) {
      if (item.isFile() && item.name.endsWith(".jsonl") &&
          !item.name.includes(".superseded-") && !item.name.endsWith(".filling.jsonl")) {
        files.push([path.join(projectDir, item.name), false]);
      } else if (item.isDirectory()) {
        const subDir = path.join(projectDir, item.name, "subagents");
        for (const sub of listDir(subDir)) {
          if (sub.isFile() && sub.name.startsWith("agent-") && sub.name.endsWith(".jsonl")) {
            files.push([path.join(subDir, sub.name), true]);
          }
        }
      }
    }
  }
  return files;
}

// -------------------------------------------------------------------- cache

/*
 * An older cache keeps its records: files still on disk are parsed again for the
 * new fields, and files since cleaned up keep the history they had.
 */
function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    if (data && data.files && typeof data.files === "object" && Number.isInteger(data.version)) {
      if (data.version === CACHE_VERSION) return data;
      if (data.version >= 4 && data.version < CACHE_VERSION) {
        for (const item of Object.values(data.files)) if (item) item.mtime = -1;
        return { version: CACHE_VERSION, files: data.files };
      }
    }
  } catch {
    // no cache yet, or unreadable: rebuild
  }
  return { version: CACHE_VERSION, files: {} };
}

function saveCache(cache) {
  const file = cacheFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  } catch (error) {
    log(`cache not saved: ${error.message}`); // the numbers still go out; the next call parses again
  }
}

/*
 * Refresh the per-file cache and return the tile payload. Only new or
 * changed transcripts are parsed. Files Claude Code has since cleaned up
 * stay in the cache, so history outlives them.
 */
function collect() {
  const started = Date.now();
  const cache = loadCache();
  const known = cache.files;
  let parsed = 0;
  for (const [file, isSubagent] of transcriptFiles(configDir())) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const cached = known[file];
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) continue;
    try {
      known[file] = { mtime: stat.mtimeMs, size: stat.size, rec: parseTranscript(file, isSubagent) };
      parsed += 1;
    } catch (error) {
      log(`skip ${file}: ${error.message}`);
    }
  }
  if (parsed) saveCache(cache);

  const days = {};
  // sessions: started that day; activeSessions: had messages that day
  const row = (date) => (days[date] ||= { date, messages: 0, sessions: 0, activeSessions: 0, toolCalls: 0, tokens: {}, io: {} });
  const sessions = [];
  for (const item of Object.values(known)) {
    const record = item && item.rec;
    if (!record) continue;
    for (const [date, [messages, toolCalls, tokens, io = {}]] of Object.entries(record.days)) {
      const r = row(date);
      r.messages += messages;
      r.toolCalls += toolCalls;
      if (record.session && messages > 0) r.activeSessions += 1;
      for (const [model, count] of Object.entries(tokens)) r.tokens[model] = (r.tokens[model] || 0) + count;
      for (const [model, [input, output]] of Object.entries(io)) {
        const pair = (r.io[model] ||= [0, 0]);
        pair[0] += input;
        pair[1] += output;
      }
    }
    if (record.session) {
      sessions.push(record.session);
      row(record.session[0]).sessions += 1;
    }
  }
  sessions.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const seconds = (Date.now() - started) / 1000;
  log(`collected: ${Object.keys(known).length} files, ${parsed} parsed, ${seconds.toFixed(1)}s`);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    days: Object.keys(days).sort().map((d) => days[d]),
    sessions, // [startDate, startHour, durationMs, messages]
    scan: { files: Object.keys(known).length, parsed, seconds: Number(seconds.toFixed(2)) },
  };
}

// ---------------------------------------------------------------------- MCP

const TOOL = {
  name: TOOL_NAME,
  title: "Claude Code usage stats",
  description:
    "Daily Claude Code usage from local session transcripts: messages, sessions started and " +
    "active, tool calls and tokens per model, plus one row per session (start date, start " +
    "hour, duration in ms, messages). Read-only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function handle(request) {
  const params = request.params || {};
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: [TOOL] };
    case "tools/call": {
      if (params.name !== TOOL_NAME) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
      let payload;
      try {
        payload = collect();
      } catch (error) {
        log(`collect failed: ${error.stack || error}`);
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
    }
    default:
      throw new RpcError(-32601, `Method not found: ${request.method}`);
  }
}

function serve() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      if (!request || typeof request !== "object" || !("id" in request)) continue; // notifications
      const reply = { jsonrpc: "2.0", id: request.id };
      try {
        reply.result = handle(request);
      } catch (error) {
        reply.error = { code: error.code || -32603, message: error.message };
      }
      process.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  });
  // Exit once the last reply is flushed: on macOS a pipe write is asynchronous, and an
  // early exit cuts a long reply at the 64 KB pipe buffer.
  process.stdin.on("end", () => process.stdout.write("", () => process.exit(0)));
}

function printSummary() {
  const data = collect();
  const tokens = {};
  for (const row of data.days) {
    for (const [model, count] of Object.entries(row.tokens)) tokens[model] = (tokens[model] || 0) + count;
  }
  const total = Object.values(tokens).reduce((a, b) => a + b, 0);
  const active = data.days.filter((r) => r.messages > 0);
  console.log(`Sessions      ${data.sessions.length}`);
  console.log(`Messages      ${data.days.reduce((a, r) => a + r.messages, 0)}`);
  console.log(`Total tokens  ${(total / 1e9).toFixed(2)}B`);
  console.log(`Active days   ${active.length} (${active.length ? active[0].date : "-"} .. ${active.length ? active[active.length - 1].date : "-"})`);
  Object.entries(tokens).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .forEach(([model, count]) => console.log(`  ${model.padEnd(28)} ${(count / 1e9).toFixed(2)}B`));
  console.log(`Scan          ${data.scan.files} files, ${data.scan.parsed} parsed, ${data.scan.seconds}s`);
}

if (process.argv.includes("--print")) printSummary();
else serve();
