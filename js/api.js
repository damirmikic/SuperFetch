import { SUPERBET_CONFIG } from "./config.js";

function endpoint(path) {
  const base = `${SUPERBET_CONFIG.baseUrl}/${SUPERBET_CONFIG.locale}`;
  return `${base}${path}`;
}

export async function fetchCompetitions(sportId) {
  const response = await fetch(endpoint(`/sport/${sportId}/tournaments`), {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Superbet API returned ${response.status}`);
  }

  const payload = await response.json();

  if (payload.error) {
    throw new Error("Superbet API returned an error payload");
  }

  return normalizeCompetitionTree(payload.data ?? []);
}

export function fetchSoccerCompetitions() {
  return fetchCompetitions(SUPERBET_CONFIG.soccerSportId);
}

export function fetchBasketballCompetitions() {
  return fetchCompetitions(SUPERBET_CONFIG.basketballSportId);
}

let euroleagueStatsCache = null;

export async function fetchEuroleagueClubsStats() {
  if (euroleagueStatsCache) {
    return euroleagueStatsCache;
  }
  const response = await fetch("https://ycpcq74tr3.execute-api.eu-central-1.amazonaws.com/prod/league/euroleague/clubs-full-stats", {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Euroleague stats API returned ${response.status}`);
  }

  const payload = await response.json();
  euroleagueStatsCache = payload;
  return payload;
}

export async function fetchPrematchEventsForCompetition(tournamentId, date = new Date()) {
  const startDate = formatApiDate(startOfDay(date));
  const params = new URLSearchParams({
    currentStatus: "active",
    offerState: "prematch",
    tournamentIds: String(tournamentId),
    startDate
  });

  const response = await fetch(endpoint(`/events/by-date?${params}`), {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Superbet events API returned ${response.status}`);
  }

  if (payload.error) {
    throw new Error("Superbet events API returned an error payload");
  }

  return (payload.data ?? []).map(normalizeEvent);
}

export async function fetchMarketsForEvent(event) {
  let odds = await fetchEventOdds(event.eventId);

  if (!odds.length) {
    const seedMarketId = event.odds?.[0]?.marketId ?? 547;
    odds = await fetchEventOdds(event.eventId, seedMarketId);
  }

  if (!odds.length && event.odds?.length) {
    odds = event.odds;
  }

  return normalizeMarkets(odds);
}


async function fetchEventOdds(eventId, marketId) {
  const eventData = await fetchEventDetails(eventId, marketId);
  return eventData?.odds ?? [];
}

async function fetchEventDetails(eventId, marketId) {
  const params = marketId ? `?${new URLSearchParams({ marketIds: String(marketId) })}` : "";
  const response = await fetch(endpoint(`/events/${eventId}${params}`), {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Superbet markets API returned ${response.status}`);
  }

  if (payload.error) {
    throw new Error("Superbet markets API returned an error payload");
  }

  const eventData = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  return eventData;
}

function normalizeCompetitionTree(categories) {
  return categories
    .map((category) => ({
      sportId: Number(category.sportId),
      categoryId: Number(category.categoryId),
      categoryName: getLocalName(category.localNames),
      competitions: (category.competitions ?? []).map((competition) => ({
        sportId: Number(category.sportId),
        categoryId: Number(category.categoryId),
        categoryName: getLocalName(category.localNames),
        tournamentId: Number(competition.tournamentId),
        tournamentName: getLocalName(competition.localNames)
      }))
    }))
    .filter((category) => category.competitions.length > 0);
}

function getLocalName(localNames = {}) {
  return localNames[SUPERBET_CONFIG.locale] ?? Object.values(localNames)[0] ?? "Unnamed";
}

function normalizeEvent(event) {
  const teams = String(event.matchName ?? "").split("·");

  return {
    eventId: Number(event.eventId),
    tournamentId: Number(event.tournamentId),
    categoryId: Number(event.categoryId),
    matchName: event.matchName ?? "Unnamed event",
    homeTeam: teams[0] ?? "",
    awayTeam: teams[1] ?? "",
    matchDate: event.matchDate ?? event.utcDate ?? "",
    marketCount: Number(event.marketCount ?? 0),
    oddsCount: Number(event.counts?.odds?.["1"] ?? event.odds?.length ?? 0),
    odds: (event.odds ?? []).slice(0, 3).map((odd) => ({
      uuid: odd.uuid,
      marketId: Number(odd.marketId),
      marketName: odd.marketName ?? "",
      outcomeId: Number(odd.outcomeId),
      name: odd.name ?? odd.code ?? "",
      price: Number(odd.price)
    }))
  };
}


function normalizeMarkets(odds) {
  const marketMap = new Map();

  for (const odd of odds) {
    const key = odd.marketUuid ?? `${odd.marketId}-${odd.marketName}-${odd.specialBetValue ?? ""}`;
    const playerInfo = extractOddPlayerInfo(odd);

    if (!marketMap.has(key)) {
      marketMap.set(key, {
        uuid: key,
        marketId: Number(odd.marketId),
        marketName: cleanDisplayText(odd.marketName ?? "Unnamed market"),
        specialBetValue: odd.specialBetValue ?? "",
        odds: []
      });
    }

    marketMap.get(key).odds.push({
      uuid: odd.uuid,
      outcomeId: Number(odd.outcomeId),
      name: cleanDisplayText(odd.name ?? odd.code ?? ""),
      marketName: cleanDisplayText(odd.marketName ?? "Unnamed market"),
      specialBetValue: odd.specialBetValue ?? "",
      playerName: playerInfo.name,
      playerTeam: playerInfo.team,
      price: Number(odd.price),
      status: odd.status ?? ""
    });
  }

  return Array.from(marketMap.values());
}

function extractOddPlayerInfo(odd) {
  const specifiers = odd.specifiers ?? {};

  for (const [key, value] of Object.entries(specifiers)) {
    if (!String(key).includes("player") || !value) {
      continue;
    }

    const side = String(key).includes("_h_") ? "home" : String(key).includes("_a_") ? "away" : "";
    return {
      name: cleanDisplayText(value),
      team: side || extractTeamSideFromOdd(odd)
    };
  }

  for (const component of odd.oddComponents ?? []) {
    const player = component?.specifiers?.player;

    if (player) {
      return {
        name: cleanDisplayText(player),
        team: component.extra?.team === "1" ? "home" : component.extra?.team === "2" ? "away" : extractTeamSideFromOdd(odd)
      };
    }
  }

  return {
    name: "",
    team: extractTeamSideFromOdd(odd)
  };
}

function extractTeamSideFromOdd(odd) {
  if (odd.extra?.team === "1") {
    return "home";
  }

  if (odd.extra?.team === "2") {
    return "away";
  }

  const tagText = [
    odd.tags,
    odd.extra?.tags,
    odd.extra?.filterTags,
    odd.marketName,
    odd.name
  ].join(" ");

  if (/\bHome\b/i.test(tagText)) {
    return "home";
  }

  if (/\bAway\b/i.test(tagText)) {
    return "away";
  }

  return "";
}

function cleanDisplayText(value) {
  return String(value).replace(/\s*\([0-9a-f-]{12,}[^)]*\)\s*/gi, " ").replace(/\s+/g, " ").trim();
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatApiDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
