import { BALKANBET_CONFIG } from "./config.js";
import { WOMEN_LEAGUE, applyWomenMarker } from "./books.js";

/**
 * Balkanbet runs on NSoft's Seven platform, so the offer comes from NSoft's
 * distribution API rather than from balkanbet.rs. Two calls cover everything:
 *
 *   /api/v1/events - the whole prematch offer. Dropping `filter[sportId]`
 *     returns all 26 sports in one ~650KB response, exactly like Superbet's
 *     by-date, so the page fetches it once and slices per sport.
 *   /api/v1/meta - the sport/category/tournament name lookups. Events carry
 *     only ids, so this is needed both for grouping and for spotting women's
 *     competitions.
 *
 * `shortProps=1` abbreviates every key (`j` is the event name, `n` the kickoff,
 * `p` the competitors); the response ships a `_mapping` describing them, but
 * the handful this module reads are spelled out in SHORT below.
 *
 * The endpoint needs no auth and sends `access-control-allow-origin: *`, so
 * like Merkur it works straight from the browser.
 */

// From the payload's own `_mapping`, for the fields this module reads.
const SHORT = {
  id: "a",
  sportId: "b",
  tournamentId: "f",
  name: "j",
  startsAt: "n",
  competitors: "p"
};
const COMPETITOR = { type: "c", name: "d" };
const HOME = 1;
const AWAY = 2;

let cache = null;

export function resetBalkanbetCache() {
  cache = null;
}

/**
 * Returns the offer for one sport. The underlying fetch covers every sport and
 * is shared, so calling this per sport tab costs nothing after the first.
 */
export async function fetchBalkanbetMatches(sportId, { womenFromLeague = true } = {}) {
  const offer = await loadOffer();

  return offer.events
    .filter((event) => Number(event[SHORT.sportId]) === Number(sportId))
    .map((event) => normalizeEvent(event, offer.tournamentsById, womenFromLeague));
}

export async function fetchBalkanbetTournaments() {
  return (await loadOffer()).tournamentsById;
}

async function loadOffer() {
  if (!cache) {
    // Kept as one in-flight promise so concurrent sport tabs share the fetch.
    cache = Promise.all([requestEvents(), requestMeta()])
      .then(([events, meta]) => ({ events, tournamentsById: buildTournamentLookup(meta) }))
      .catch((error) => {
        cache = null;
        throw error;
      });
  }

  return cache;
}

function endpoint(path, params) {
  const search = new URLSearchParams({
    companyUuid: BALKANBET_CONFIG.companyUuid,
    deliveryPlatformId: "3",
    timezone: BALKANBET_CONFIG.timezone,
    language: JSON.stringify({ default: BALKANBET_CONFIG.locale }),
    offerTemplate: "WEB_OVERVIEW",
    ...params
  });

  return `${BALKANBET_CONFIG.baseUrl}${path}?${search}`;
}

async function requestJson(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Balkanbet ${label} API returned ${response.status}`);
  }

  return response.json();
}

async function requestEvents() {
  // `filter[from]` is required; midnight local keeps today's early kickoffs in.
  const payload = await requestJson(endpoint("/events", {
    dataFormat: JSON.stringify({ default: "object", events: "array", outcomes: "array" }),
    "filter[from]": startOfDayIso(),
    shortProps: "1"
  }), "events");

  return payload.data?.events ?? [];
}

async function requestMeta() {
  const payload = await requestJson(endpoint("/meta", {
    dataFormat: JSON.stringify({ default: "object", events: "object", markets: "object", marketGroups: "array" }),
    dataStructure: "flat",
    "filter[from]": startOfDayIso()
  }), "meta");

  return payload.data ?? {};
}

function buildTournamentLookup(meta) {
  const categories = meta.categories ?? {};
  const lookup = new Map();

  for (const [id, tournament] of Object.entries(meta.tournaments ?? {})) {
    const category = categories[String(tournament.categoryId)];

    lookup.set(Number(id), {
      name: tournament.name ?? "",
      categoryName: category?.name ?? ""
    });
  }

  return lookup;
}

function normalizeEvent(event, tournamentsById, womenFromLeague) {
  const tournamentId = Number(event[SHORT.tournamentId] ?? 0);
  const tournament = tournamentsById.get(tournamentId);
  const leagueName = tournament?.name ?? "";
  const women = womenFromLeague && WOMEN_LEAGUE.test(leagueName);
  const { home, away } = extractTeams(event);

  return {
    matchId: Number(event[SHORT.id]),
    home: applyWomenMarker(home, women),
    away: applyWomenMarker(away, women),
    kickoffMs: Date.parse(event[SHORT.startsAt] ?? "") || 0,
    leagueId: tournamentId,
    leagueName: tournament?.categoryName ? `${tournament.categoryName} - ${leagueName}` : leagueName
  };
}

/**
 * Prefers the `competitors` entries over splitting the event name. They are
 * more abbreviated ("Boca J. 2" against "Boca Juniors"), but they are
 * unambiguous, whereas splitting the name misfires on any side whose own name
 * contains " - ". Measured over a full day, competitors also pair better:
 * soccer 89% vs 87%, basketball 69% vs 64%, hockey 95% vs 94%.
 */
function extractTeams(event) {
  const competitors = Object.values(event[SHORT.competitors] ?? {});
  const home = competitors.find((side) => side[COMPETITOR.type] === HOME)?.[COMPETITOR.name];
  const away = competitors.find((side) => side[COMPETITOR.type] === AWAY)?.[COMPETITOR.name];

  if (home && away) {
    return { home: String(home).trim(), away: String(away).trim() };
  }

  const parts = String(event[SHORT.name] ?? "").split(/\s+-\s+/);
  return { home: (parts[0] ?? "").trim(), away: (parts[1] ?? "").trim() };
}

function startOfDayIso() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00`;
}
