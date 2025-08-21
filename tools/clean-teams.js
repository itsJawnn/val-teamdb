// tools/clean-teams.js
// Cleans teamdb/teams.json: strips rank prefixes, normalizes slugs, de-dupes.

const fs = require("fs");
const path = require("path");

const FILE = path.resolve("teamdb/teams.json");

function stripRankPrefix(s) {
  // remove leading rank numbers like "1 " or "12 " (with optional dot) and extra spaces
  return s.replace(/^\s*\d+\s*\.?\s*/u, "").trim();
}

function toSlug(name) {
  // diacritics -> ascii, lower, keep letters/digits/spaces, then hyphenate
  const ascii = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanLogoPath(p) {
  // logos/1-fnatic.png -> logos/fnatic.png (drop any leading "<digits>-")
  const dir = path.dirname(p);
  const file = path.basename(p, ".png").replace(/^\d+-/, "");
  return `${dir}/${file}.png`;
}

function slugFromLogo(p) {
  return path.basename(cleanLogoPath(p), ".png");
}

function uniq(arr) {
  return [...new Set(arr)];
}

function cleanTeamsArray(teams) {
  const bySlug = new Map();

  for (const t of teams) {
    const names = (t.names ?? []).map(stripRankPrefix).filter(Boolean);
    const primary = names[0] ?? "";
    const slug = toSlug(primary || slugFromLogo(t.logo || ""));

    const entry = bySlug.get(slug) || { logo: `logos/${slug}.png`, names: [] };
    entry.logo = `logos/${slug}.png`;
    entry.names = uniq([...entry.names, ...names]);

    bySlug.set(slug, entry);
  }

  // sort by slug for stability
  return [...bySlug.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);
}

function cleanRegions(regions) {
  if (!regions || typeof regions !== "object") return regions;

  const cleaned = {};
  for (const [region, list] of Object.entries(regions)) {
    const seen = new Set();
    const out = [];

    for (const item of list) {
      const name = stripRankPrefix((item.names && item.names[0]) || item.slug || "");
      const slug = toSlug(name);
      if (seen.has(slug)) continue;

      out.push({
        slug,
        names: [name],
        logo: `logos/${slug}.png`,
      });
      seen.add(slug);
    }

    cleaned[region] = out;
  }
  return cleaned;
}

(function run() {
  const json = JSON.parse(fs.readFileSync(FILE, "utf8"));

  const cleanedTeams = cleanTeamsArray(json.teams || []);
  const cleanedRegions = cleanRegions(json.regions);

  const output = {
    version: (json.version ?? 1),
    updated_at: new Date().toISOString(),
    teams: cleanedTeams,
    regions: cleanedRegions,
  };

  fs.writeFileSync(FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(
    `✅ Cleaned. Teams: ${json.teams?.length ?? 0} -> ${cleanedTeams.length}. Regions kept: ${Object.keys(cleanedRegions || {}).length}`
  );
})();
