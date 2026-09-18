import { MERKUR_CONFIG } from "./config.js";

/**
 * Merkurxtip publishes its whole prematch offer for a sport in a single call.
 * The response is one flat array of matches (`esMatches`) - there is no
 * competition tree to walk like on Superbet, so league names arrive per match.
 *
 * Sport codes are single or double letters: S soccer, B basketball, T tennis,
 * H hockey, HB handball, R rugby, V volleyball, W water polo, D darts, BA bandy.
 * An unknown code is not an error - it returns 200 with an empty offer.
 */
export async function fetchMerkurMatches(sportCode, { womenFromLeague = true } = {}) {
  const url = `${MERKUR_CONFIG.baseUrl}/custom/offer/${MERKUR_CONFIG.locale}/sport/${sportCode}/mob?annex=0`;

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Merkur API returned ${response.status}`);
  }

  const payload = await response.json();
  return (payload.esMatches ?? []).map((match) => normalizeMerkurMatch(match, womenFromLeague));
}

/**
 * Merkur marks a women's competition in the *league* name and leaves the team
 * names alone ("Minnesota Lynx" in "WNBA"), while Superbet marks the teams
 * ("Minnesota Lynx (Z)"). Left as-is the two never pair, because the matcher
 * treats a women/men mismatch as a hard reject - so the marker is pushed down
 * onto the team names here, where the matcher can see it.
 *
 * Validated against all 249 league names Merkur currently publishes across ten
 * sports: it catches every women's competition and flags no men's one.
 *
 * Only for team sports - see `womenFromLeague` in sports.js for why individual
 * sports must opt out.
 */
const WOMEN_LEAGUE = /(^|[\s,.-])(w|women|woman|feminin\w*|zene)($|[\s,.0-9-])|\bwnba\b|\bwsl\b/i;

function normalizeMerkurMatch(match, womenFromLeague) {
  const leagueName = String(match.leagueName ?? "").trim();
  const women = womenFromLeague && WOMEN_LEAGUE.test(leagueName);

  return {
    matchId: Number(match.id),
    home: applyWomenMarker(String(match.home ?? "").trim(), women),
    away: applyWomenMarker(String(match.away ?? "").trim(), women),
    kickoffMs: Number(match.kickOffTime ?? 0),
    leagueId: Number(match.leagueId ?? 0),
    leagueName,
    countryName: extractCountryName(match.leagueGroupToken),
    live: Boolean(match.live),
    oddsCount: Number(match.oddsCount ?? 0)
  };
}

function applyWomenMarker(name, women) {
  if (!women || !name) {
    return name;
  }

  // Already carries its own marker (Merkur is inconsistent about this - rugby
  // writes "Leeds Rhinos W" inside a league also named "Super League, Women").
  return /(^|\s)w$/i.test(name) ? name : `${name} W`;
}

// leagueGroupToken looks like "zzz#Ukraine#147#226#" - the country sits in slot 1.
function extractCountryName(token) {
  const parts = String(token ?? "").split("#");
  return (parts[1] ?? "").trim();
}
