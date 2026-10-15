/**
 * Reconciles Merkurxtip specials with Superbet markets for one fixture.
 *
 * The two books describe the same market in unrelated ways, so both sides are
 * reduced to one canonical entry first:
 *
 *   { scope: ft|h1|h2, stat, subject: match|home|away, line, outcomes }
 *
 * `outcomes` is `{ over, under }`, `{ yes }`, or a map of range labels.
 * Player props are deliberately out of scope - only match and team markets.
 *
 * Only stats Merkur actually offers are mapped: Superbet carries ~1000 markets
 * for a big fixture, and the point is "what differs", not an index of Superbet.
 * The `;` combination markets are a different product and are ignored.
 */

const STAT_LABELS = {
  corners: "Korneri",
  cards: "Kartoni",
  reds: "Crveni kartoni",
  fouls: "Faulovi",
  offsides: "Ofsajdi",
  sot: "Sutevi u okvir gola",
  shots: "Sutevi",
  pens: "Dosudjeni penali",
  saves: "Odbrane golmana",
  cornerrange: "Korneri raspon"
};

const SCOPE_LABELS = { ft: "", h1: "1. poluvreme - ", h2: "2. poluvreme - " };

const TOTAL_STATS = [
  [/^kornera$/, "corners"],
  [/^kartona$/, "cards"],
  [/^crvenih kartona$/, "reds"],
  [/^faulova$/, "fouls"],
  [/^ofsajda$/, "offsides"],
  [/^suteva u okvir gola$/, "sot"],
  [/^suteva$/, "shots"],
  [/^dosudjenih penala$/, "pens"],
  [/^odbrana golmana$/, "saves"]
];

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "dj")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pulls a team name out of a market text; returns `{ side, rest }` or null side. */
function extractTeam(text, teams) {
  for (const [name, side] of teams) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(name)}(?=\\s|$)`);

    if (pattern.test(text)) {
      return { side, rest: text.replace(pattern, " ").replace(/\s+/g, " ").trim() };
    }
  }

  return { side: null, rest: text };
}

function sortedTeams(home, away) {
  return [[normalizeText(home), "home"], [normalizeText(away), "away"]]
    .filter(([name]) => name)
    .sort((a, b) => b[0].length - a[0].length);
}

function statFromTotalText(text) {
  for (const [pattern, stat] of TOTAL_STATS) {
    if (pattern.test(text)) {
      return stat;
    }
  }

  return null;
}

class EntryBook {
  constructor() {
    this.entries = new Map();
  }

  add({ scope, stat, subject, line = null }, outcome, price) {
    if (!Number.isFinite(price) || price <= 1) {
      return;
    }

    const key = [scope, stat, subject, line ?? ""].join("|");
    let entry = this.entries.get(key);

    if (!entry) {
      entry = { scope, stat, subject, line, outcomes: {} };
      this.entries.set(key, entry);
    }

    // First price wins: a duplicate row in the feed should not flip the number.
    if (entry.outcomes[outcome] === undefined) {
      entry.outcomes[outcome] = price;
    }
  }
}

/**
 * `sideOf(merkurTeamName)` maps Merkur's team spelling to Superbet's
 * home/away orientation (the books occasionally list a fixture the other way round).
 */
export function canonicalizeMerkur(fixture, sideOf) {
  const book = new EntryBook();
  const unmapped = new Map();
  const teams = sortedTeams(fixture.home, fixture.away).map(([name]) => [name, sideOf(name)]);
  const miss = (label) => unmapped.set(label, (unmapped.get(label) ?? 0) + 1);

  for (const row of fixture.rows) {
    const home = normalizeText(row.home);
    const away = normalizeText(row.away);

    // Match-level: "1.poluvreme" in the home slot means the market text is in `away`.
    let scope = "ft";
    let text = home;

    if (/^1\.?\s*poluvreme$/.test(home)) {
      scope = "h1";
      text = away;
    }

    if (text === "") {
      miss(row.home);
      continue;
    }

    const { side, rest } = extractTeam(text, teams);

    if (/^korneri raspon$/.test(rest) && side) {
      book.add({ scope, stat: "cornerrange", subject: side }, row.away, Number(row.odds["1"]));
      continue;
    }

    // Gol glavom is priced in-house, so it is not compared (and not "unmapped" either).
    if (rest === "gol glavom") {
      continue;
    }

    const total = rest.match(/^ukupno (.+)$/);
    const stat = total ? statFromTotalText(total[1]) : null;

    if (stat && row.line !== null) {
      const subject = side ?? "match";
      book.add({ scope, stat, subject, line: row.line }, "over", Number(row.odds["227"]));
      book.add({ scope, stat, subject, line: row.line }, "under", Number(row.odds["228"]));
      continue;
    }

    miss(`${row.home} | ${row.away}`);
  }

  return { entries: Array.from(book.entries.values()), unmapped };
}

export function canonicalizeSuperbet(markets, event) {
  const book = new EntryBook();
  const teams = sortedTeams(event.homeTeam, event.awayTeam);

  for (const market of markets) {
    const name = normalizeText(market.marketName);

    if (name.includes(";")) {
      continue;
    }

    let scope = "ft";
    let text = name;
    const half = text.match(/^([12])\.\s*poluvreme\s*-?\s*/);

    if (half) {
      scope = half[1] === "1" ? "h1" : "h2";
      text = text.slice(half[0].length);
    }

    const { side, rest: withoutTeam } = extractTeam(text, teams);
    const rest = withoutTeam.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();

    if (/^korneri raspon$/.test(rest) && side) {
      for (const odd of market.odds) {
        book.add({ scope, stat: "cornerrange", subject: side }, normalizeText(odd.name), odd.price);
      }

      continue;
    }

    const total = rest.match(/^ukupno (.+)$/);
    const stat = total ? statFromTotalText(total[1]) : null;

    if (!stat) {
      continue;
    }

    for (const odd of market.odds) {
      const parsed = parseLineOdd(odd);

      if (parsed) {
        book.add({ scope, stat, subject: side ?? "match", line: parsed.line }, parsed.outcome, odd.price);
      }
    }
  }

  return Array.from(book.entries.values());
}

// "Manje 2.5" / "Vise 2.5" -> { outcome, line }
function parseLineOdd(odd) {
  const match = normalizeText(odd.name).match(/(vise|manje)\s+(?:od\s+)?(\d+(?:\.\d+)?)\s*$/);

  if (match) {
    return { outcome: match[1] === "vise" ? "over" : "under", line: Number(match[2]) };
  }

  return null;
}

// ---- Comparison ------------------------------------------------------------

function groupKey(entry) {
  return [entry.scope, entry.stat, entry.subject].join("|");
}

function entryKey(entry) {
  return `${groupKey(entry)}|${entry.line ?? ""}`;
}

/**
 * Returns one row per canonical market:
 *   status "both"     - same market and line on both books (prices compared)
 *   status "mx"       - Merkur only
 *   status "sb-line"  - Superbet quotes the same market but on another line
 *   status "sb"       - Superbet only, for a stat Merkur offers on this fixture
 */
export function compareFixture(merkurEntries, superbetEntries) {
  const sbByKey = new Map();
  const sbGroups = new Map();

  for (const entry of superbetEntries) {
    sbByKey.set(entryKey(entry), entry);

    const lines = sbGroups.get(groupKey(entry)) ?? [];
    lines.push(entry);
    sbGroups.set(groupKey(entry), lines);
  }

  const rows = [];
  const usedSb = new Set();
  const merkurGroups = new Set();
  const merkurStats = new Set();

  for (const entry of merkurEntries) {
    const key = entryKey(entry);
    const partner = sbByKey.get(key) ?? null;

    merkurGroups.add(groupKey(entry));
    merkurStats.add(`${entry.scope}|${entry.stat}`);

    if (partner) {
      usedSb.add(key);
    }

    const siblingLines = (sbGroups.get(groupKey(entry)) ?? [])
      .map((candidate) => candidate.line)
      .filter((line) => line !== null)
      .sort((a, b) => a - b);

    rows.push({
      ...entry,
      status: partner ? "both" : "mx",
      mx: entry.outcomes,
      sb: partner?.outcomes ?? null,
      sbLines: partner ? [] : siblingLines
    });
  }

  for (const entry of superbetEntries) {
    if (usedSb.has(entryKey(entry)) || !merkurStats.has(`${entry.scope}|${entry.stat}`)) {
      continue;
    }

    rows.push({
      ...entry,
      status: merkurGroups.has(groupKey(entry)) ? "sb-line" : "sb",
      mx: null,
      sb: entry.outcomes,
      sbLines: []
    });
  }

  for (const row of rows) {
    row.maxDelta = maxDelta(row);
  }

  return rows;
}

/** Price difference in percent, Superbet relative to Merkur (positive = Superbet pays more). */
export function outcomeDelta(mxPrice, sbPrice) {
  return (sbPrice / mxPrice - 1) * 100;
}

function maxDelta(row) {
  if (row.status !== "both") {
    return 0;
  }

  let max = 0;

  for (const [outcome, mxPrice] of Object.entries(row.mx)) {
    const sbPrice = row.sb[outcome];

    if (sbPrice !== undefined) {
      max = Math.max(max, Math.abs(outcomeDelta(mxPrice, sbPrice)));
    }
  }

  return max;
}

export function describeMarket(row, fixture) {
  const base = STAT_LABELS[row.stat] ?? row.stat;
  const scope = SCOPE_LABELS[row.scope] ?? "";
  const team = row.subject === "home" ? fixture.home : row.subject === "away" ? fixture.away : "";
  return { title: `${scope}${base}${team ? ` - ${team}` : ""}`, detail: "" };
}
