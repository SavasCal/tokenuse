#!/usr/bin/env node
// tokenuse — what your Claude Code usage would cost at API rates, and what that money would have bought.
// Usage: tokenuse [--by model|day|week|month|session] [--since YYYY-MM-DD] [--paid USD_PER_MONTH] [--update-prices] [--test]
// --paid: what you pay per month (e.g. 200 for Max 20x). Prorated over the days in the report. Omit to skip the deduction.
import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Built-in public API prices (USD per MTok, 2026-06). `--update-prices` caches LiteLLM's table, which overrides these.
// [input, output, cache write 5m, cache write 1h, cache read]. Longest prefix wins.
const PRICES = {
  "claude-fable-5-1": [10, 50, 12.5, 20, 0.25],
  "claude-fable-5": [10, 50, 12.5, 20, 1.0],
  "claude-opus-5-5": [4, 20, 5, 8, 0.2],
  "claude-opus-5": [5, 25, 6.25, 10, 0.5],
  "claude-opus-4": [5, 25, 6.25, 10, 0.5],
  "claude-sonnet-5": [2, 10, 2.5, 4, 0.2],
  "claude-sonnet-4": [3, 15, 3.75, 6, 0.3],
  "claude-haiku-4": [1, 5, 1.25, 2, 0.1],
};
const PRICE_CACHE = join(homedir(), ".cache", "tokenuse", "prices.json");
const LITELLM = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
try { Object.assign(PRICES, JSON.parse(readFileSync(PRICE_CACHE, "utf8"))); } catch {}

// LiteLLM per-token prices → our per-MTok tuples. Missing cache prices fall back to Anthropic's multipliers on input.
const perM = (x) => Math.round(x * 1e10) / 1e4;
const fromLiteLLM = (j) => Object.fromEntries(Object.entries(j)
  .filter(([k, v]) => k.startsWith("claude-") && v.input_cost_per_token >= 0 && v.output_cost_per_token >= 0)
  .map(([k, v]) => {
    const i = v.input_cost_per_token;
    return [k, [perM(i), perM(v.output_cost_per_token), perM(v.cache_creation_input_token_cost ?? i * 1.25),
      perM(v.cache_creation_input_token_cost_above_1hr ?? i * 2), perM(v.cache_read_input_token_cost ?? i * 0.1)]];
  }));


const priceFor = (model) =>
  Object.entries(PRICES).sort((a, b) => b[0].length - a[0].length).find(([k]) => model.startsWith(k))?.[1];

const cost = (model, u) => {
  const p = priceFor(model);
  if (!p) return 0;
  return (u.input * p[0] + u.output * p[1] + u.write5m * p[2] + u.write1h * p[3] + u.read * p[4]) / 1e6;
};

// ---- what you could have bought (approx USD) ----
const ITEMS = [
  ["MacBook Pro 14\"", 1999, [
    "          .-------------------------------------.",
    "          |  .-------------------------------.  |",
    "          |  |                               |  |",
    "          |  |  $ tokenuse                   |  |",
    "          |  |                               |  |",
    "          |  |  You saved  {SAVED.......}    |  |",
    "          |  |  That's the same as:          |  |",
    "          |  |                               |  |",
    "          |  |                               |  |",
    "          |  '-------------------------------'  |",
    "          |             ___________             |",
    "     _____|____________/___________\\____________|_____",
    "    |_________________________________________________|",
  ]],
  ["iPhone", 999, [
    "               .---------------------.",
    "               |  .---------------.  |",
    "               |  |  o  ------  o  |  |",
    "               |  |               |  |",
    "               |  |     12:34     |  |",
    "               |  |     Thu 25    |  |",
    "               |  |               |  |",
    "               |  |  [ ] [ ] [ ]  |  |",
    "               |  |  [ ] [ ] [ ]  |  |",
    "               |  |  [ ] [ ] [ ]  |  |",
    "               |  |               |  |",
    "               |  |    _______    |  |",
    "               |  '---------------'  |",
    "               '---------------------'",
  ]],
  ["flight to Tokyo", 900, [
    "                                       __",
    "                                     _|  |_",
    "                          __________|      |__________",
    "     ARN  o - - - - - - -|   o  o  o  o  o  o  o  o   |- - - - - - - o  NRT",
    "                         '----------.        .--------'",
    "                                     \\      /",
    "                                      '----'",
  ]],
  ["PlayStation 5", 499, [
    "        .-----------------------------.",
    "       /  .-------------------------.  \\",
    "      |  |                           |  |",
    "      |  |    |>   P S 5             |  |",
    "      |  |                           |  |",
    "      |  '---------------------------'  |",
    "      |      .-----.       .-----.      |",
    "      |     /  ___  \\     /   ^   \\     |",
    "      |    |  |   |  |   |  [] ()  |    |",
    "      |     \\  ---  /     \\   x   /     |",
    "      '------'-----'-------'-----'------'",
  ]],
  ["Nintendo Switch", 349, [
    "     .-------.-----------------------------------.-------.",
    "     |   ^   |                                   |   X   |",
    "     | <   > |                                   | Y   A |",
    "     |   v   |                                   |   B   |",
    "     |       |     N I N T E N D O   S W I T C H |       |",
    "     |  (o)  |                                   |  (o)  |",
    "     |       |                                   |       |",
    "     |  - +  |                                   |  ...  |",
    "     '-------'-----------------------------------'-------'",
  ]],
  ["AirPods Pro", 249, [
    "            .-------------------------.",
    "            |    _____       _____    |",
    "            |   /     \\     /     \\   |",
    "            |  |   O   |   |   O   |  |",
    "            |   \\     /     \\     /   |",
    "            |    |   |       |   |    |",
    "            |    |   |       |   |    |",
    "            |    '---'       '---'    |",
    "            '-------------------------'",
  ]],
  ["year of Netflix", 190, [
    "      .-------------------------------------.",
    "      |                                     |",
    "      |    NN    NN  EEEEE  TTTTT  FFFFF    |",
    "      |    NNN   NN  EE       T    FF       |",
    "      |    NN N  NN  EEEE     T    FFFF     |",
    "      |    NN  N NN  EE       T    FF       |",
    "      |    NN   NNN  EEEEE    T    FF       |",
    "      |                                     |",
    "      |              [ |> ]                 |",
    "      '-------------------------------------'",
  ]],
  ["pizza", 15, [
    "                  _.--\"\"\"\"\"\"--._",
    "               .-'   o        o  '-.",
    "             .'  o        .        '.",
    "            /       .  o      o   .  \\",
    "           |   o          o          |",
    "           |       .  o       o  .   |",
    "            \\   o        .         /",
    "             '.     o       o   .'",
    "               '-._    o     _.-'",
    "                   '--....--'",
  ]],
  ["beer", 8, [
    "              .~~~~~~~~~~~~~.",
    "             (  ~  ~  ~  ~  ~ )",
    "             |~~~~~~~~~~~~~~~|___",
    "             |               |   \\",
    "             |    ~~~~~~~    |    |",
    "             |    ~~~~~~~    |    |",
    "             |    ~~~~~~~    |___/",
    "             |               |",
    "             '---------------'",
  ]],
  ["coffee", 5, [
    "                  (   (  (",
    "                   )   )  )",
    "                  (   (  (",
    "               .--------------.",
    "               |              |___",
    "               |   ~~~~~~~~   |   \\",
    "               |   ~~~~~~~~   |   |",
    "                \\            /___/",
    "                 '----------'",
  ]],
];

// Greedy: biggest item that fits, repeat down the list. Returns [name, count, art][] (max 3 kinds).
const shop = (usd, maxKinds = 5) => {
  const out = [];
  let left = usd;
  for (const [name, price, art] of ITEMS) {
    if (out.length >= maxKinds) break;
    const n = Math.floor(left / price);
    if (n > 0) { out.push([name, n, art]); left -= n * price; }
  }
  return out;
};

// Local calendar date (YYYY-MM-DD), so a late-night session counts on the day you worked it.
const localDay = (ts) => {
  const d = new Date(ts ?? "");
  return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- self-check ----
if (process.argv.includes("--test")) {
  assert.strictEqual(cost("claude-opus-5", { input: 1e6, output: 0, write5m: 0, write1h: 0, read: 0 }), 5);
  assert.strictEqual(cost("claude-opus-5-5", { input: 0, output: 1e6, write5m: 0, write1h: 0, read: 0 }), 20);
  assert.strictEqual(cost("claude-fable-5-1", { input: 0, output: 0, write5m: 1e6, write1h: 1e6, read: 4e6 }), 33.5);
  assert.strictEqual(cost("deepseek-flash", { input: 1e6, output: 1e6, write5m: 0, write1h: 0, read: 0 }), 0);
  assert.deepStrictEqual(shop(2020).map(([n, c]) => [n, c]), [["MacBook Pro 14\"", 1], ["pizza", 1], ["coffee", 1]]);
  assert.deepStrictEqual(shop(3).map(([n, c]) => [n, c]), []);
  assert.deepStrictEqual(fromLiteLLM({
    "claude-x": { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, cache_creation_input_token_cost: 5e-6, cache_creation_input_token_cost_above_1hr: 8e-6, cache_read_input_token_cost: 2e-7 },
    "claude-y": { input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5 },
    "claude-bad": { input_cost_per_token: "free" }, "gpt-5": { input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
  }), { "claude-x": [4, 20, 5, 8, 0.2], "claude-y": [3, 15, 3.75, 6, 0.3] });
  assert.strictEqual(localDay("2026-09-30T23:30:00Z"), new Date("2026-09-30T23:30:00Z").toLocaleDateString("sv-SE"));
  console.log("ok");
  process.exit(0);
}

if (process.argv.includes("--update-prices")) {
  console.error("Fetching prices from LiteLLM…");
  const res = await fetch(LITELLM).catch((e) => ({ ok: false, statusText: e.message }));
  if (!res.ok) { console.error(`Could not fetch prices: ${res.statusText}. Keeping the current ones.`); process.exit(1); }
  const fresh = fromLiteLLM(await res.json());
  if (!Object.keys(fresh).length) { console.error("No Claude prices in LiteLLM's table. Keeping the current ones."); process.exit(1); }
  mkdirSync(join(PRICE_CACHE, ".."), { recursive: true });
  writeFileSync(PRICE_CACHE, JSON.stringify(fresh, null, 1));
  console.log(`Saved ${Object.keys(fresh).length} Claude model prices to ${PRICE_CACHE}`);
  process.exit(0);
}

// ---- scan logs ----
const sinceArg = process.argv[process.argv.indexOf("--since") + 1];
const since = process.argv.includes("--since") ? sinceArg : "";
const by = process.argv.includes("--by") ? process.argv[process.argv.indexOf("--by") + 1] : "model";
const paidPerMonth = process.argv.includes("--paid") ? Number(process.argv[process.argv.indexOf("--paid") + 1]) : 0;
const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
if (!existsSync(root)) { console.error(`No Claude Code logs at ${root}. Run Claude Code once, or set CLAUDE_CONFIG_DIR.`); process.exit(1); }
const byId = new Map();
// Progress goes to stderr and only to a terminal, so `tokenuse > report.txt` stays clean.
const status = (msg) => process.stderr.isTTY && process.stderr.write(`\r\x1b[K${msg}`);
status(`Finding logs in ${root}…`);
const logs = readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".jsonl"));
const files = logs.length;

for (const [i, rel] of logs.entries()) {
  if (i % 20 === 0) status(`Reading logs ${i}/${files}…`);
  const text = readFileSync(join(root, rel), "utf8");
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d?.message;
    const us = m?.usage;
    if (d?.type !== "assistant" || !us || !m.id) continue;
    const day = localDay(d.timestamp);
    if (since && day < since) continue;
    const cc = us.cache_creation ?? {};
    const write1h = cc.ephemeral_1h_input_tokens ?? 0;
    const u = {
      input: us.input_tokens ?? 0,
      write1h,
      write5m: cc.ephemeral_5m_input_tokens ?? (us.cache_creation_input_tokens ?? 0) - write1h,
      read: us.cache_read_input_tokens ?? 0,
      output: us.output_tokens ?? 0,
    };
    const prev = byId.get(m.id);
    if (!prev || u.output > prev.u.output) byId.set(m.id, { model: m.model ?? "?", u, ts: d.timestamp ?? "", day, session: `${(d.cwd ?? rel).split("/").pop()}/${(d.sessionId ?? "").slice(0, 8)}` });
  }
}

// ---- aggregate ----
const isoWeek = (day) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Thursday of this week
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((+d - +jan1) / 864e5 + 1) / 7)).padStart(2, "0")}`;
};
const keyOf = { model: (e) => e.model, day: (e) => e.day, week: (e) => isoWeek(e.day), month: (e) => e.day.slice(0, 7), session: (e) => e.session }[by];
if (!keyOf) { console.error(`--by must be one of model|day|week|month|session`); process.exit(1); }
const rows = new Map();
let first = "", last = "";
for (const e of byId.values()) {
  const { model, u, ts } = e;
  const key = keyOf(e);
  const r = rows.get(key) ?? { input: 0, write5m: 0, write1h: 0, read: 0, output: 0, cost: 0, n: 0 };
  r.input += u.input; r.write5m += u.write5m; r.write1h += u.write1h; r.read += u.read; r.output += u.output;
  r.cost += cost(model, u); r.n++;
  rows.set(key, r);
  if (ts && (!first || ts < first)) first = ts;
  if (ts > last) last = ts;
}
status("");
if (!byId.size) { console.error(`No usage found in ${root}${since ? ` since ${since}` : ""}.`); process.exit(1); }
const total = [...rows.values()].reduce((s, r) => s + r.cost, 0);
const days = Math.round((Date.parse(localDay(last)) - Date.parse(localDay(first))) / 864e5) + 1;
const paid = (paidPerMonth * days) / 30.44; // prorated: a 3-day report costs 3 days of subscription, not a full month
const saved = total - paid;

// ---- print ----
const cols = [by[0].toUpperCase() + by.slice(1), "Msgs", "Input", "Cache W", "Cache R", "Output", "Cost"];
const sorted = [...rows.entries()].sort((a, b) => (by === "model" || by === "session" ? b[1].cost - a[1].cost : a[0].localeCompare(b[0])));
const shown = by === "session" ? sorted.slice(0, 20) : sorted; // ponytail: top 20 sessions by cost, --by session --all if ever needed
const data = shown.map(([k, r]) => [by === "model" && !priceFor(k) ? `${k} (unpriced)` : k, fmt(r.n), fmt(r.input), fmt(r.write5m + r.write1h), fmt(r.read), fmt(r.output), usd(r.cost)]);
const agg = [...rows.values()].reduce((a, r) => ({ n: a.n + r.n, input: a.input + r.input, w: a.w + r.write5m + r.write1h, read: a.read + r.read, output: a.output + r.output }), { n: 0, input: 0, w: 0, read: 0, output: 0 });
data.push(["TOTAL", fmt(agg.n), fmt(agg.input), fmt(agg.w), fmt(agg.read), fmt(agg.output), usd(total)]);
const widths = cols.map((c, i) => Math.max(c.length, ...data.map((r) => r[i].length)));
const line = (r) => "│ " + r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(" │ ") + " │";
const sep = (l, m, r) => l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;

console.log(`\nClaude Code usage ${localDay(first)} → ${localDay(last)}  (${files} sessions, ${fmt(byId.size)} messages)\n`);
console.log(sep("┌", "┬", "┐"));
console.log(line(cols));
console.log(sep("├", "┼", "┤"));
data.slice(0, -1).forEach((r) => console.log(line(r)));
console.log(sep("├", "┼", "┤"));
console.log(line(data.at(-1)));
console.log(sep("└", "┴", "┘"));
if (shown.length < sorted.length) console.log(`  (top ${shown.length} of ${sorted.length} sessions)`);

console.log(`\n  At API prices you would have paid`.padEnd(41) + usd(total).padStart(11));
if (paidPerMonth) {
  console.log(`  Subscription (${days} days at ${usd(paidPerMonth)}/mo)`.padEnd(39) + "- " + usd(paid).padStart(11));
  console.log(`  ${"─".repeat(49)}`);
  console.log("  You saved".padEnd(40) + usd(saved).padStart(11));
}
console.log(saved > 0 ? "\n  That's the same as:\n" : "\n  The subscription cost more than the API would have. Ouch.\n");
// Items side by side, bottom-aligned with the label underneath, wrapping to the terminal width.
const blocks = shop(saved).map(([name, n, art]) => {
  const indent = Math.min(...art.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  const lines = [...art.map((l) => l.slice(indent).replace("{SAVED.......}", usd(saved).padEnd(14))), "", `${n} × ${name}`];
  return { lines, w: Math.max(...lines.map((l) => l.length)) };
});
const maxW = (process.stdout.columns || 120) - 2;
const rowsOut = [];
for (const b of blocks) {
  const row = rowsOut.at(-1);
  if (row && row.reduce((s, x) => s + x.w + 4, 0) + b.w <= maxW) row.push(b); else rowsOut.push([b]);
}
for (const row of rowsOut) {
  const h = Math.max(...row.map((b) => b.lines.length));
  for (let i = 0; i < h; i++) console.log(("  " + row.map((b) => (b.lines[i - (h - b.lines.length)] ?? "").padEnd(b.w)).join("    ")).trimEnd());
  console.log();
}
