import { calculateSoccerXg } from "./xg.js";
import { getEplTeamAlias } from "./epl_team_names.js";

const MAX_GOALS = 12;
const DEFAULT_APPEARANCE_POINTS = 2;

const GOAL_POINTS = { GK: 10, DEF: 6, MID: 5, FWD: 4 };
const ASSIST_POINTS = 3;
const CLEAN_SHEET_POINTS = { GK: 4, DEF: 4, MID: 1, FWD: 0 };
const CONCEDED_PENALTY_POSITIONS = new Set(["GK", "DEF"]);
const YELLOW_CARD_POINTS = -1;
const RED_CARD_POINTS = -3;

const UNMODELED_COMPONENTS = ["bonus", "saves", "cbiTackles", "recoveries", "penaltySaveMiss", "ownGoals"];

export function buildFixtureModel(event, markets) {
  const xg = calculateSoccerXg(markets, event);
  return { event, markets, xg };
}

export function matchFplPlayersToFixture(fixtureModel, fplPlayers) {
  const homeTeamName = getEplTeamAlias(fixtureModel.event.homeTeam) || fixtureModel.event.homeTeam;
  const awayTeamName = getEplTeamAlias(fixtureModel.event.awayTeam) || fixtureModel.event.awayTeam;

  const homeSquad = fplPlayers.filter((player) => player.teamName === homeTeamName);
  const awaySquad = fplPlayers.filter((player) => player.teamName === awayTeamName);

  const results = [];
  for (const market of fixtureModel.markets) {
    if (market.marketName.includes(";")) continue;
    for (const odd of market.odds || []) {
      if (!odd.playerTeam) continue;
      const rawName = odd.playerName && !String(odd.playerName).startsWith("sr:player:")
        ? odd.playerName
        : extractPlayerNameFromOddText(odd.name);
      if (!rawName) continue;
      const squad = odd.playerTeam === "home" ? homeSquad : awaySquad;
      const match = findFplPlayerMatch(rawName, squad);
      if (!match) continue;
      if (!results.some((entry) => entry.fplPlayer.id === match.id)) {
        results.push({ fplPlayer: match, team: odd.playerTeam });
      }
    }
  }
  return results;
}

function findFplPlayerMatch(oddPlayerName, squad) {
  const target = normalizeText(oddPlayerName);
  if (!target) return null;

  for (const player of squad) {
    if (normalizeText(player.webName) === target) return player;
    if (normalizeText(`${player.firstName} ${player.secondName}`) === target) return player;
    if (normalizeText(`${player.secondName}, ${player.firstName}`) === target) return player;
  }

  for (const player of squad) {
    const webNorm = normalizeText(player.webName);
    if (webNorm.length > 3 && (target.includes(webNorm) || webNorm.includes(target))) return player;
    const lastNorm = normalizeText(player.secondName);
    if (lastNorm.length > 3 && target.includes(lastNorm)) return player;
  }

  return null;
}

export function buildPlayerExpectedPoints(fixtureModel, playerMatch) {
  const { fplPlayer, team } = playerMatch;
  const position = fplPlayer.position;
  const opponentLambda = fixtureModel.xg?.ok
    ? (team === "home" ? fixtureModel.xg.lambdaAway : fixtureModel.xg.lambdaHome)
    : null;

  const goalModel = buildAnytimeProbabilityModel(fixtureModel.markets, fplPlayer, team, GOAL_MARKET_KEYWORDS);
  const assistModel = buildAnytimeProbabilityModel(fixtureModel.markets, fplPlayer, team, ASSIST_MARKET_KEYWORDS);
  const cardModel = buildCardProbabilityModel(fixtureModel.markets, fplPlayer, team);

  const hasAnyMarket = Boolean(goalModel || assistModel || cardModel);

  const appearance = hasAnyMarket ? DEFAULT_APPEARANCE_POINTS : 0;

  const goalPointsPerGoal = GOAL_POINTS[position] ?? 0;
  const goalsLambda = goalModel ? goalModel.lambda : 0;
  const goalPoints = goalsLambda * goalPointsPerGoal;

  const assistsLambda = assistModel ? assistModel.lambda : 0;
  const assistPoints = assistsLambda * ASSIST_POINTS;

  let cleanSheetPoints = 0;
  let goalsConcededPenalty = 0;
  if (Number.isFinite(opponentLambda)) {
    const pCleanSheet = Math.exp(-Math.max(opponentLambda, 0));
    cleanSheetPoints = pCleanSheet * (CLEAN_SHEET_POINTS[position] ?? 0);
    if (CONCEDED_PENALTY_POSITIONS.has(position)) {
      goalsConcededPenalty = -0.5 * opponentLambda;
    }
  }

  const cardsPenalty = cardModel
    ? cardModel.yellowLambda * YELLOW_CARD_POINTS + cardModel.redLambda * RED_CARD_POINTS
    : 0;

  const breakdown = {
    appearance,
    goals: goalPoints,
    assists: assistPoints,
    cleanSheet: cleanSheetPoints,
    goalsConcededPenalty,
    cardsPenalty
  };

  const expectedPoints = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    playerId: fplPlayer.id,
    playerName: `${fplPlayer.firstName} ${fplPlayer.secondName}`.trim(),
    webName: fplPlayer.webName,
    team: fplPlayer.teamName,
    position,
    eventId: fixtureModel.event.eventId,
    fixtureName: `${fixtureModel.event.homeTeam} - ${fixtureModel.event.awayTeam}`,
    expectedPoints,
    breakdown,
    unmodeled: UNMODELED_COMPONENTS,
    hasAnyMarket
  };
}

const GOAL_MARKET_KEYWORDS = ["postiz", "gol"];
const ASSIST_MARKET_KEYWORDS = ["asistencij"];

function buildAnytimeProbabilityModel(markets, fplPlayer, team, keywords) {
  const candidates = [];

  for (const market of markets) {
    const marketNorm = normalizeText(market.marketName);
    if (market.marketName.includes(";")) continue;
    if (!keywords.some((kw) => marketNorm.includes(kw))) continue;

    for (const odd of market.odds || []) {
      if (odd.playerTeam && odd.playerTeam !== team) continue;
      if (isNoOdd(odd.name)) continue;
      if (!oddBelongsToPlayer(odd, fplPlayer)) continue;
      const no = (market.odds || []).find((other) => isNoOdd(other.name));
      candidates.push({ market, yes: odd, no });
    }
  }

  if (!candidates.length) return null;
  const { yes, no } = candidates[0];

  let pEvent = 1 / yes.price;
  if (no) {
    const probs = normalizeImplied([yes.price, no.price]);
    if (probs) pEvent = probs[0];
  }
  const pClamped = clamp(pEvent, 0.01, 0.99);
  const lambda = -Math.log(Math.max(1 - pClamped, 0.001));
  return { lambda, probability: pClamped, source: yes.market?.marketName ?? "" };
}

function buildCardProbabilityModel(markets, fplPlayer, team) {
  let yellowLambda = 0;
  let redLambda = 0;
  let found = false;

  for (const market of markets) {
    if (market.marketName.includes(";")) continue;
    const marketNorm = normalizeText(market.marketName);
    if (!marketNorm.includes("karton")) continue;
    const isRed = marketNorm.includes("crveni");

    for (const odd of market.odds || []) {
      if (odd.playerTeam && odd.playerTeam !== team) continue;
      if (isNoOdd(odd.name)) continue;
      if (!oddBelongsToPlayer(odd, fplPlayer)) continue;
      const no = (market.odds || []).find((other) => isNoOdd(other.name));
      let pEvent = 1 / odd.price;
      if (no) {
        const probs = normalizeImplied([odd.price, no.price]);
        if (probs) pEvent = probs[0];
      }
      const pClamped = clamp(pEvent, 0.01, 0.99);
      const lambda = -Math.log(Math.max(1 - pClamped, 0.001));
      if (isRed) redLambda += lambda; else yellowLambda += lambda;
      found = true;
    }
  }

  return found ? { yellowLambda, redLambda } : null;
}

function oddBelongsToPlayer(odd, fplPlayer) {
  if (isSamePlayer(odd.playerName, fplPlayer)) return true;
  const extracted = extractPlayerNameFromOddText(odd.name);
  return isSamePlayer(extracted, fplPlayer);
}

function extractPlayerNameFromOddText(text) {
  const match = String(text ?? "").match(/^([^-]+?)\s*-\s*/);
  return match ? match[1].trim() : String(text ?? "").trim();
}

function isSamePlayer(candidateName, fplPlayer) {
  const target = normalizeText(candidateName);
  if (!target || target.startsWith("sr:player:")) return false;
  return (
    normalizeText(fplPlayer.webName) === target ||
    normalizeText(`${fplPlayer.firstName} ${fplPlayer.secondName}`) === target ||
    normalizeText(`${fplPlayer.secondName}, ${fplPlayer.firstName}`) === target ||
    (normalizeText(fplPlayer.webName).length > 3 && target.includes(normalizeText(fplPlayer.webName)))
  );
}

function isNoOdd(name) {
  const norm = normalizeText(name);
  return norm === "ne" || norm === "no";
}

function normalizeImplied(prices) {
  const implied = prices.map((price) => 1 / Number(price));
  if (implied.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const total = implied.reduce((sum, value) => sum + value, 0);
  return implied.map((value) => value / total);
}

function normalizeText(value) {
  return toAscii(String(value ?? ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toAscii(value) {
  return String(value)
    .replace(/[\u00a0\u2007\u2008\u2009\u202f\u205f\u3000]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/Đ/g, "Dj");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
