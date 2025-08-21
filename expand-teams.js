// Expands your existing teamdb/teams.json with top-30 per region from VLR.
//
// Usage:
//   npm i
//   npm run expand:teams
//
// It will read teamdb/teams.json, merge-in new teams, and write back.

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

// ---- Regions (exactly what you asked for) ----
const REGIONS = [
  { code: "EU",   name: "Europe",        url: "https://www.vlr.gg/rankings/europe" },
  { code: "NA",   name: "North America", url: "https://www.vlr.gg/rankings/north-america" },
  { code: "BR",   name: "Brazil",        url: "https://www.vlr.gg/rankings/brazil" },
  { code: "AP",   name: "Asia Pacific",  url: "https://www.vlr.gg/rankings/asia-pacific" },
  { code: "KR",   name: "Korea",         url: "https://www.vlr.gg/rankings/korea" },
  { code: "CN",   name: "China",         url: "https://www.vlr.gg/rankings/china" },
  { code: "JP",   name: "Japan",         url: "https://www.vlr.gg/rankings/japan" },
  { code: "LAS",  name: "LA-S",          url: "https://www.vlr.gg/rankings/la-s" },
  { code: "LAN",  name: "LA-N",          url: "https://www.vlr.gg/rankings/la-n" },
  { code: "OCE",  name: "Oceania",       url: "https://www.vlr.gg/rankings/oceania" },
  { code: "MENA", name: "MENA",          url: "https://www.vlr.gg/rankings/mena" },
  { code: "GC",   name: "GC",            url: "https://www.vlr.gg/rankings/gc" },
  { code: "CG",   name: "Collegiate",    url: "https://www.vlr.gg/rankings/collegiate" }
];

// ---- Helpers ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const latinize = (s) => s.normalize("NFD").replace(/\p{Diacritic}+/gu, "");

function slugify(name) {
  let n = latinize(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // common cleanups
  n = n.replace(/\b(esports|esport|gaming|team|club|gc|valorant)\b/g, "");
  n = n.replace(/-+/g, "-").replace(/^-|-$/g, "");

  // canonical specials
  const specials = {
    "kru": "kru",
    "leviatan": "leviatan",
    "g2": "g2-esports",
    "100-thieves": "100-thieves",
    "team-liquid": "team-liquid",
    "fnatic": "fnatic",
    "cloud9": "cloud9"
  };
  return specials[n] || n;
}

function canonicalNameKey(s) {
  let t = latinize(s).toLowerCase();
  t = t.replace(/\b(esports|esport|gaming|team|club|gc|valorant)\b/g, "");
  t = t.replace(/[^a-z0-9]+/g, "");
  return t.trim();
}

function isRankingLine(txt) {
  // Lines like: "1  Gen.G  #Q1CQ  South Korea"
  const t = txt.replace(/\s+/g, " ").trim();
  return / #[A-Za-z0-9]/.test(t) && !/\d+\s?:\s?\d+/.test(t);
}
function extractTeamName(line) {
  const t = line.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?)\s+#/);
  return (m ? m[1] : t).trim();
}

async function getTop30(regionUrl) {
  const res = await fetch(regionUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${regionUrl}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const candidates = [];

  // grab obvious elements first
  $('[class*=rank], [class*=ranking], a').each((_, el) => {
    const text = $(el).text();
    if (isRankingLine(text)) candidates.push(extractTeamName(text));
  });

  // fallback: scan body text
  if (candidates.length < 30) {
    $("body").text().split("\n").forEach((line) => {
      if (isRankingLine(line)) candidates.push(extractTeamName(line));
    });
  }

  // dedupe in order
  const seen = new Set();
  const ordered = [];
  for (const c of candidates) {
    const name = c.trim();
    const key = canonicalNameKey(name);
    if (!name || !key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(name);
  }

  return ordered.slice(0, 30);
}

// ---- Main expand/merge ----
const JSON_PATH = "teamdb/teams.json";

function readTeamsJson() {
  if (!fs.existsSync(JSON_PATH)) {
    // create a minimal shell if missing
    return { version: 1, updated_at: new Date().toISOString(), teams: [] };
  }
  return JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
}

function writeTeamsJson(obj) {
  obj.updated_at = new Date().toISOString();
  // pretty-print
  fs.mkdirSync("teamdb", { recursive: true });
  fs.writeFileSync(JSON_PATH, JSON.stringify(obj, null, 2), "utf8");
}

function buildSlugIndex(teams) {
  const bySlug = new Map();
  for (const t of teams) {
    const s = t.logo?.match(/logos\/(.+?)\.(?:png|webp|jpg)$/)?.[1] || t.logo || t.slug || slugify(t.names?.[0] || "");
    if (!bySlug.has(s)) bySlug.set(s, t);
  }
  return bySlug;
}

function mergeTeam(bySlug, name) {
  const slug = slugify(name);
  const existing = bySlug.get(slug);
  if (existing) {
    const set = new Set(existing.names || []);
    set.add(name);
    existing.names = Array.from(set).sort((a, b) => a.localeCompare(b));
    // ensure logo path is consistent
    existing.logo = `logos/${slug}.png`;
    return existing;
  } else {
    const entry = {
      logo: `logos/${slug}.png`,
      names: [name]
    };
    bySlug.set(slug, entry);
    return entry;
  }
}

(async () => {
  const db = readTeamsJson();

  // normalize existing structure
  if (!Array.isArray(db.teams)) db.teams = [];
  const bySlug = buildSlugIndex(db.teams);

  // we'll also maintain a regions map for your admin view, but
  // your app can keep using the flat "teams" array safely.
  if (typeof db.regions !== "object" || db.regions === null) db.regions = {};

  for (const region of REGIONS) {
    console.log(`→ ${region.name}`);
    try {
      const names = await getTop30(region.url);
      const regionList = [];
      for (const nm of names) {
        const entry = mergeTeam(bySlug, nm);
        const slug = slugify(nm);
        regionList.push({
          slug,
          names: entry.names,
          logo: `logos/${slug}.png`
        });
      }
      db.regions[region.code] = regionList;
    } catch (err) {
      console.error(`  ✗ Failed ${region.code}: ${err.message}`);
      if (!db.regions[region.code]) db.regions[region.code] = [];
    }
    // be gentle to VLR
    await sleep(800);
  }

  // rebuild flat teams from map (stable order: by slug)
  db.teams = Array.from(bySlug.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([slug, entry]) => ({
      logo: `logos/${slug}.png`,
      names: entry.names
    }));

  writeTeamsJson(db);
  console.log(`✅ Updated ${JSON_PATH}`);
})();
