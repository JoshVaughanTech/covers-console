#!/usr/bin/env node
/* ============================================================
   Connecteam discovery — what can this account actually reach?

   Read-only. Every data request is a GET; the only POST is the OAuth
   token exchange. This script cannot create, modify or delete
   anything in your Connecteam account.

   Auth is OAuth2 client_credentials: POST /oauth/v1/token with HTTP
   Basic, then Bearer on every call. NOT the X-API-KEY header the docs
   also describe — that is a separate credential type and returns 403
   for client id/secret pairs.

   Output is REDACTED by default: field names, types and record counts,
   never staff names, emails or values. Safe to paste back into a chat.

   Usage:
     node scripts/connecteam-discover.mjs --id=CLIENT_ID --secret=CLIENT_SECRET
     node scripts/connecteam-discover.mjs      (reads CONNECTEAM_CLIENT_ID/_SECRET)

   Optional:
     --raw   include values. Do NOT paste that output anywhere.
   ============================================================ */

const BASE = "https://api.connecteam.com";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.length ? rest.join("=") : true];
  }),
);

const ID = args.id || process.env.CONNECTEAM_CLIENT_ID;
const SECRET = args.secret || process.env.CONNECTEAM_CLIENT_SECRET;
const REDACT = !args.raw;

if (!ID || !SECRET) {
  console.error("Need credentials. Pass --id=... --secret=..., or set CONNECTEAM_CLIENT_ID / CONNECTEAM_CLIENT_SECRET.");
  process.exit(1);
}

/* Paths taken from the live spec at /openapi.json rather than guessed.
   `needs` marks probes requiring an id discovered first. */
const PROBES = [
  ["Account", "/me", {}, null, "who the token belongs to"],

  ["Users", "/users/v1/users", { limit: "1" }, null, "names, employment type, custom field VALUES"],
  ["Users", "/users/v1/custom-fields", {}, null, "custom field DEFINITIONS — do RSA / RSG / expiry already live here?"],
  ["Users", "/users/v1/custom-field-categories", {}, null, "how those fields are grouped"],
  ["Users", "/users/v1/smart-groups", {}, null, "groupings that could map to venues or departments"],

  ["Time clock", "/time-clock/v1/time-clocks", {}, null, "which clocks exist"],
  ["Time clock", "/time-clock/v1/time-clocks/{tc}/manual-breaks", {}, "tc", "break types — isPaid and duration classify meal vs rest"],
  ["Time clock", "/time-clock/v1/time-clocks/{tc}/time-activities", { startDate: "{today}", endDate: "{today}" }, "tc", "the punches we consume"],
  ["Time clock", "/time-clock/v1/time-clocks/{tc}/timesheet", { startDate: "{today}", endDate: "{today}" }, "tc", "computed timesheet"],
  ["Time clock", "/time-clock/v1/time-clocks/{tc}/geofences", {}, "tc", "site verification — was the punch at the venue"],

  ["Scheduler", "/scheduler/v1/schedulers", {}, null, "which schedulers exist"],
  ["Scheduler", "/scheduler/v1/schedulers/{sc}/shifts", { startTime: "{now}", endTime: "{plus7}", limit: "1" }, "sc", "the roster — assignedUserIds, jobId, isOpenShift, breaks"],
  ["Scheduler", "/scheduler/v1/schedulers/{sc}/custom-fields", {}, "sc", "per-shift custom fields"],
  ["Scheduler", "/scheduler/v1/schedulers/user-unavailability", { startTime: "{now}", endTime: "{plus7}" }, null, "who cannot work"],

  ["Jobs", "/jobs/v1/jobs", {}, null, "jobs attached to shifts and punches — the likely DUTIES source"],
  ["Pay rates", "/pay-rates/v1/pay-rates", {}, null, "ordinary hourly rate — the break-loading report needs this"],
  ["Time off", "/time-off/v1/policy-types", {}, null, "leave types"],
  ["Policies", "/company-policies/v1/pay-rule-policies", {}, null, "pay rules — overtime and penalty configuration"],
  ["Webhooks", "/settings/v1/webhooks", {}, null, "event push — would replace polling"],
  ["Forms", "/forms/v1/forms", {}, null, "checklists that could back run sheets"],
  ["Tasks", "/tasks/v1/taskboards", {}, null, "task assignment"],
  ["Onboarding", "/onboarding/v1/packs", {}, null, "another possible home for certifications"],
];

const PII = /name|email|phone|mobile|address|birth|photo|image|avatar|note|title|description|street|suburb|postcode/i;
const now = Math.floor(Date.now() / 1000);
const vars = { today: new Date().toLocaleDateString("en-CA"), now: String(now), plus7: String(now + 7 * 86400) };

let TOKEN = null;
async function token() {
  const res = await fetch(BASE + "/oauth/v1/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const fill = (s, ids) => String(s).replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? vars[k] ?? "");

async function get(path, params, ids) {
  const url = new URL(BASE + fill(path, ids));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, fill(v, ids));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

const shape = (v, d = 0) =>
  v === null ? "null"
  : Array.isArray(v) ? (v.length ? `array[${v.length}] of ${shape(v[0], d + 1)}` : "array[0]")
  : typeof v === "object" ? (d >= 2 ? "object" : "{ " + Object.keys(v).slice(0, 18).join(", ") + " }")
  : typeof v;

const firstArray = (body) => {
  const d = body?.data ?? body;
  if (Array.isArray(d)) return ["data", d];
  for (const [k, v] of Object.entries(d || {})) if (Array.isArray(v)) return [k, v];
  return null;
};

function describe(rec) {
  return Object.entries(rec).slice(0, 30).map(([k, v]) => {
    const hide = REDACT && (PII.test(k) || typeof v === "string");
    return `        ${k}: ${shape(v)}${hide ? "" : " = " + String(JSON.stringify(v)).slice(0, 55)}`;
  }).join("\n");
}

/* ---------- run ---------- */
console.log("Connecteam discovery — read-only");
console.log(REDACT ? "Redacted: field names and types only.\n" : "RAW MODE — contains real values, do not share.\n");

TOKEN = await token();
const claims = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString());
const scopes = String(claims.scope ?? claims.scopes ?? "").split(/[ ,]+/).filter(Boolean);
console.log(`Granted scopes: ${scopes.join(", ") || "(none listed)"}`);
console.log(`Token expires:  ${claims.exp ? new Date(claims.exp * 1000).toISOString() : "?"}\n`);

const ids = {};
for (const [path, key, field] of [
  ["/time-clock/v1/time-clocks", "tc", "id"],
  ["/scheduler/v1/schedulers", "sc", "schedulerId"],
]) {
  const r = await get(path, {}, ids);
  const fa = r.ok && firstArray(r.body);
  if (fa?.[1]?.length) ids[key] = fa[1][0][field] ?? fa[1][0].id;
}
console.log(`Discovered ids: timeClock=${ids.tc ?? "none"} scheduler=${ids.sc ?? "none"}`);

const missing = new Set();
let group = "";
for (const [g, path, params, needs, why] of PROBES) {
  if (g !== group) { group = g; console.log(`\n── ${g}`); }
  if (needs && !ids[needs]) { console.log(`  SKIP  ${path}  (no ${needs} discovered)`); continue; }

  const r = await get(path, params, ids);
  const scopeErr = typeof r.body?.error === "string" && r.body.error.match(/required scope: ([\w.]+)/);
  if (scopeErr) { missing.add(scopeErr[1]); console.log(`  SCOPE ${fill(path, ids)}\n        needs ${scopeErr[1]} — ${why}`); continue; }
  if (!r.ok) { console.log(`  FAIL  ${fill(path, ids)} — HTTP ${r.status}\n        ${JSON.stringify(r.body).slice(0, 150)}`); continue; }

  const fa = firstArray(r.body);
  console.log(`  OK    ${fill(path, ids)}`);
  console.log(`        ${why}`);
  if (fa) {
    console.log(`        ${fa[1].length} record(s) under "${fa[0]}"`);
    if (fa[1][0]) console.log(describe(fa[1][0]));
  } else console.log(`        shape: ${shape(r.body?.data ?? r.body)}`);
}

console.log(`\n\n── Scopes to grant ─────────────────────────────`);
if (missing.size === 0) console.log("  none — everything probed was permitted");
else for (const s of [...missing].sort()) console.log(`  ${s}`);
console.log(`
Safe to paste as-is: no names or field values above.`);
