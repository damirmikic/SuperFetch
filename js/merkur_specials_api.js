import { MERKUR_CONFIG } from "./config.js";

/**
 * Merkurxtip's specials ("SF") arrive in the same flat `esMatches` shape as a
 * normal sport, but each "match" is really one priced market, and there are two
 * kinds of group, told apart by `leagueName`:
 *
 *   "Lyon - Crystal Palace"    match-level markets: home = market text,
 *                              away = "." (a line in `params.overUnder`), or
 *                              home = "1.poluvreme" / away = market text
 *   "Crystal Palace,Adam W."   one player's props - ignored, player markets are
 *                              out of scope for the comparison
 *
 * Odd keys: `227` over, `228` under (line in `params.overUnder`), `1` the only
 * outcome of a yes/threshold/range market.
 *
 * `round` is the same for the whole offer, so it cannot group anything.
 */
export async function fetchMerkurSpecials() {
  const url = `${MERKUR_CONFIG.baseUrl}/custom/offer/${MERKUR_CONFIG.locale}/sport/SF/mob?annex=0`;

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Merkur specials API returned ${response.status}`);
  }

  const payload = await response.json();
  return groupSpecialsByFixture(payload.esMatches ?? []);
}

export function groupSpecialsByFixture(rows) {
  const fixtures = new Map();

  for (const raw of rows) {
    const row = normalizeRow(raw);

    if (row.kind !== "match") {
      continue;
    }

    const key = `${row.kickoffMs}|${row.leagueName}`;
    let fixture = fixtures.get(key);

    if (!fixture) {
      const [home, away] = splitMatchName(row.leagueName);
      fixture = {
        fixtureId: key,
        matchId: Number(raw.leagueId),
        home,
        away,
        kickoffMs: row.kickoffMs,
        leagueId: Number(raw.leagueGroupId ?? 0),
        leagueName: extractCompetitionName(raw.leagueGroupToken),
        rows: []
      };
      fixtures.set(key, fixture);
    }

    fixture.rows.push(row);
  }

  return { fixtures: Array.from(fixtures.values()) };
}

function normalizeRow(raw) {
  const leagueName = String(raw.leagueName ?? "").trim();
  const base = {
    home: String(raw.home ?? "").trim(),
    away: String(raw.away ?? "").trim(),
    odds: raw.odds ?? {},
    line: raw.params?.overUnder !== undefined ? Number(raw.params.overUnder) : null,
    kickoffMs: Number(raw.kickOffTime ?? 0),
    leagueName
  };

  // "Team,Player" groups are player props - out of scope, and kind "other" skips them.
  if (leagueName.includes(",")) {
    return { ...base, kind: "other" };
  }

  if (leagueName.includes(" - ")) {
    return { ...base, kind: "match" };
  }

  return { ...base, kind: "other" };
}

function splitMatchName(name) {
  const index = name.indexOf(" - ");
  return [name.slice(0, index).trim(), name.slice(index + 3).trim()];
}

// leagueGroupToken looks like "002#Liga Evrope#2521#252#" - the competition sits in slot 1.
function extractCompetitionName(token) {
  const parts = String(token ?? "").split("#");
  return (parts[1] ?? "").trim();
}
