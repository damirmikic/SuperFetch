import { MERKUR_CONFIG } from "./config.js";
import { WOMEN_LEAGUE, applyWomenMarker } from "./books.js";

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


// leagueGroupToken looks like "zzz#Ukraine#147#226#" - the country sits in slot 1.
function extractCountryName(token) {
  const parts = String(token ?? "").split("#");
  return (parts[1] ?? "").trim();
}
