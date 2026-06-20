import { calculateSoccerXg } from "./xg.js?v=20260614-6";

export const DAILY_CSV_COLUMNS = ["Datum", "Vreme", "Sifra", "Domacin", "Gost", "1", "X", "2", "GR", "U", "O", "Yes", "No"];

const MAX_GOALS = 18;
const MAX_STATS = 160;
const DEFAULT_OUTRIGHT_MARGIN = 0.92;
const DEFAULT_OU_MARGIN = 0.92;

const DAILY_TOTALS = [
  { key: "goals", label: "ukupno golova", kind: "goals" },
  { key: "corners", label: "ukupno kornera", kind: "stat", keywords: ["korner", "corner"] },
  { key: "cards", label: "ukupno kartona", kind: "stat", keywords: ["karton", "card"], reject: ["crveni", "red", "zuti", "žuti", "yellow", "poen", "bod", "booking"] },
  { key: "penalties", label: "ukupno penala", kind: "stat", keywords: ["penal", "penalty"] },
  { key: "redCards", label: "ukupno crvenih kartona", kind: "stat", exactNames: ["ukupno crvenih kartona"], keywords: ["crveni karton", "red card"] },
  { key: "fouls", label: "ukupno faulova", kind: "stat", keywords: ["faul", "foul"] },
  { key: "offsides", label: "ukupno ofsajda", kind: "stat", keywords: ["ofsajd", "offside"] }
];

export function buildMatchModel(event, markets) {
  const xg = calculateSoccerXg(markets, event);
  return {
    event,
    markets,
    xg,
    homeGoalDist: xg.ok ? poissonPmf(xg.lambdaHome, MAX_GOALS) : null,
    awayGoalDist: xg.ok ? poissonPmf(xg.lambdaAway, MAX_GOALS) : null,
    matchGoalDist: xg.ok ? poissonPmf(xg.lambdaHome + xg.lambdaAway, MAX_GOALS * 2) : null
  };
}

export function buildDailyTotals(matchModels, period, multipliers = {}) {
  const rows = [];
  for (const config of DAILY_TOTALS) {
    const row = config.kind === "goals"
      ? buildDailyGoalsRow(matchModels, period, multipliers.ouMultiplier)
      : buildDailyStatRow(matchModels, period, config, multipliers.ouMultiplier);
    rows.push(row);
  }
  return rows;
}

export function collectPlayerOptions(matchModels) {
  const options = [];
  for (const model of matchModels) {
    const players = new Map();
    for (const market of model.markets) {
      for (const odd of market.odds || []) {
        const name = normalizePlayerName(odd.playerName) || extractPlayerFromText(`${market.marketName} ${odd.name}`);
        if (!name) continue;
        players.set(normalizeText(name), name);
      }
    }
    options.push({
      eventId: model.event.eventId,
      eventName: formatMatchName(model.event),
      players: Array.from(players.values()).sort((a, b) => a.localeCompare(b))
    });
  }
  return options;
}

export function buildPlayerVsTeamRow({ matchModel, playerName, teamSide, period, multiplier = DEFAULT_OUTRIGHT_MARGIN, ouMultiplier = DEFAULT_OU_MARGIN }) {
  const teamDist = teamSide === "home" ? matchModel.homeGoalDist : matchModel.awayGoalDist;
  const teamName = teamSide === "home" ? matchModel.event.homeTeam : matchModel.event.awayTeam;
  const teamLambda = teamSide === "home" ? matchModel.xg?.lambdaHome : matchModel.xg?.lambdaAway;
  const playerModel = buildPlayerGoalModel(matchModel.markets, playerName);

  if (!teamDist || !playerModel.dist) {
    return {
      ok: false,
      type: "player",
      label: `${formatPlayerName(playerName)} vs ${teamName || ""}`,
      reason: !teamDist ? "Nedostaje xG za tim." : "Nedostaje gol market za igraca."
    };
  }

  const compare = compareDistributions(playerModel.dist, teamDist);
  const totalDist = convolve(playerModel.dist, teamDist, MAX_GOALS * 2);
  const line = chooseLine(expectedValue(totalDist), 0.5);
  const ou = overUnderOdds(totalDist, line, ouMultiplier);
  const outright = {
    one: probabilityToOdds(compare.aGreater, multiplier),
    draw: probabilityToOdds(compare.equal, multiplier),
    two: probabilityToOdds(compare.bGreater, multiplier)
  };

  return {
    ok: true,
    type: "player",
    date: period.dateLabel,
    time: period.from,
    host: formatPlayerName(playerName),
    guest: teamName || "",
    one: formatPrice(outright.one),
    draw: formatPrice(outright.draw),
    two: formatPrice(outright.two),
    line: formatLine(line),
    under: formatPrice(ou.under),
    over: formatPrice(ou.over),
    playerGoalOdd: formatPrice(playerModel.goalOdd),
    teamGoalOdd: formatPrice(probabilityToOdds(atLeastOneProbability(teamLambda), DEFAULT_OUTRIGHT_MARGIN)),
    note: playerModel.source
  };
}

export function buildTeamDuelRow({ matchModels, leftTeams, rightTeams, period, multiplier = DEFAULT_OUTRIGHT_MARGIN, ouMultiplier = DEFAULT_OU_MARGIN }) {
  const leftDist = buildTeamGroupGoalDist(matchModels, leftTeams);
  const rightDist = buildTeamGroupGoalDist(matchModels, rightTeams);
  const leftNames = teamRefsToNames(matchModels, leftTeams);
  const rightNames = teamRefsToNames(matchModels, rightTeams);
  if (!leftDist || !rightDist) {
    return {
      ok: false,
      type: "duel",
      label: `${leftNames.join("/")} vs ${rightNames.join("/")}`,
      reason: "Nedostaje xG za jedan ili vise timova."
    };
  }

  const compare = compareDistributions(leftDist, rightDist);
  const totalDist = convolve(leftDist, rightDist, MAX_GOALS * 4);
  const line = chooseLine(expectedValue(totalDist), 0.5);
  const ou = overUnderOdds(totalDist, line, ouMultiplier);

  return {
    ok: true,
    type: "duel",
    date: period.dateLabel,
    time: period.from,
    host: leftNames.join("/"),
    guest: rightNames.join("/"),
    one: formatPrice(probabilityToOdds(compare.aGreater, multiplier)),
    draw: formatPrice(probabilityToOdds(compare.equal, multiplier)),
    two: formatPrice(probabilityToOdds(compare.bGreater, multiplier)),
    line: formatLine(line),
    under: formatPrice(ou.under),
    over: formatPrice(ou.over)
  };
}

export function buildDailyCsv({ period, selectedCount, totalRows, playerRows, duelRows }) {
  const lines = [
    formatCsvRow(DAILY_CSV_COLUMNS),
    formatCsvRow([`MATCH_NAME:Dnevni Specijal`]),
    formatCsvRow([`LEAGUE_NAME:${buildDailyLeagueName(period, selectedCount)}`])
  ];

  for (const row of totalRows) {
    if (row.ok) lines.push(formatDataRow(row));
  }

  const validPlayers = playerRows.filter((row) => row.ok);
  if (validPlayers.length) {
    lines.push(formatCsvRow([`LEAGUE_NAME:igrac vs tim`]));
    for (const row of validPlayers) lines.push(formatDataRow(row));
  }

  const validDuels = duelRows.filter((row) => row.ok);
  if (validDuels.length) {
    lines.push(formatCsvRow([`LEAGUE_NAME:dueli timova`]));
    for (const row of validDuels) lines.push(formatDataRow(row));
  }

  return lines.join("\r\n");
}

export function formatPeriodLabel(period) {
  return `${period.shortDate}.${period.from.replace(":", "h")}-${period.endShortDate}.${period.to.replace(":", "h")}`;
}

export function formatLocalEventDate(value) {
  const date = parseApiDate(value);
  const parts = new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dateLabel: `${Number(get("day"))}.${Number(get("month"))}.${get("year")}`,
    shortDate: `${Number(get("day"))}.${Number(get("month"))}`,
    time: `${get("hour")}:${get("minute")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute"))
  };
}

export function isEventInPeriod(event, period) {
  const local = formatLocalEventDate(event.matchDate);
  const start = localDateTimeToMs(period.dateFrom, period.from);
  const end = localDateTimeToMs(period.dateToResolved, period.to);
  const eventMs = localDateTimeToMs(local.date, local.time);
  return eventMs >= start && eventMs <= end;
}

export function createPeriod(dateFrom, dateTo, from, to) {
  const fromMinutes = timeToMinutes(from);
  const toMinutes = timeToMinutes(to);
  let dateToResolved = dateTo || dateFrom;
  if (dateToResolved === dateFrom && toMinutes <= fromMinutes) {
    dateToResolved = addDaysIso(dateFrom, 1);
  }
  const startParts = dateFrom.split("-").map(Number);
  const endParts = dateToResolved.split("-").map(Number);
  return {
    dateFrom,
    dateTo: dateTo || dateFrom,
    dateToResolved,
    from,
    to,
    dateLabel: `${startParts[2]}.${startParts[1]}.${startParts[0]}`,
    shortDate: `${startParts[2]}.${startParts[1]}`,
    endShortDate: `${endParts[2]}.${endParts[1]}`
  };
}

export function getTeamOptions(matchModels) {
  const options = [];
  for (const model of matchModels) {
    if (model.event.homeTeam) options.push({ value: `${model.event.eventId}|home`, label: model.event.homeTeam });
    if (model.event.awayTeam) options.push({ value: `${model.event.eventId}|away`, label: model.event.awayTeam });
  }
  return options;
}

function buildDailyGoalsRow(matchModels, period, multiplier = DEFAULT_OU_MARGIN) {
  const available = matchModels.filter((model) => model.matchGoalDist);
  if (!available.length) {
    return { ok: false, label: "ukupno golova", reason: "Nedostaju xG modeli." };
  }
  const lambda = available.reduce((sum, model) => sum + model.xg.lambdaHome + model.xg.lambdaAway, 0);
  const dist = poissonPmf(lambda, MAX_GOALS * Math.max(2, available.length));
  return buildOuResult("ukupno golova", dist, period, multiplier, available.length, matchModels.length);
}

function buildDailyStatRow(matchModels, period, config, multiplier = DEFAULT_OU_MARGIN) {
  let lambda = 0;
  let count = 0;
  for (const model of matchModels) {
    const stat = inferStatDistribution(model.markets, model.event, config);
    if (stat) { lambda += stat.mean; count++; }
  }
  if (!count) {
    return { ok: false, label: config.label, reason: "Nema odgovarajucih O/U marketa." };
  }
  const maxVal = Math.max(MAX_STATS, Math.ceil(lambda * 1.5) + 50);
  const dist = poissonPmf(lambda, maxVal);
  return buildOuResult(config.label, dist, period, multiplier, count, matchModels.length);
}

function buildOuResult(label, dist, period, multiplier, available, total) {
  const exp = expectedValue(dist);
  const line = chooseLine(exp, 0.5);
  const odds = overUnderOdds(dist, line, multiplier);
  return {
    ok: true,
    type: "total",
    date: period.dateLabel,
    time: period.from,
    host: label,
    guest: `${total} meca`,
    line: formatLine(line),
    under: formatPrice(odds.under),
    over: formatPrice(odds.over),
    coverage: `${available}/${total}`
  };
}

function inferStatDistribution(markets, event, config) {
  const candidate = findTotalOuMarket(markets, event, config);
  if (!candidate) return null;

  if (config.key === "redCards") {
    const underPrice = Number(candidate.under.price);
    if (!Number.isFinite(underPrice) || underPrice < 1.01) return null;
    const pNoRed = clamp(DEFAULT_OU_MARGIN / underPrice, 0.01, 0.99);
    return {
      mean: 1 - pNoRed,
      market: candidate.market.marketName,
      line: candidate.line
    };
  }

  const probs = normalizeImplied([candidate.under.price, candidate.over.price]);
  if (!probs) return null;
  const mean = inferPoissonMeanFromUnder(candidate.line, probs[0]);
  return {
    mean,
    market: candidate.market.marketName,
    line: candidate.line
  };
}

function findTotalOuMarket(markets, event, config) {
  const home = normalizeText(event.homeTeam);
  const away = normalizeText(event.awayTeam);
  const candidates = [];
  for (const market of markets) {
    const norm = normalizeText(market.marketName);
    if (config.exactNames?.length && config.exactNames.some((name) => norm === normalizeText(name))) {
      const ou = config.key === "redCards" ? findRedCardsOverUnder(market) : findOverUnder(market);
      if (!ou) continue;
      candidates.push({ market, ...ou, score: 100 });
      continue;
    }
    if (config.key === "redCards") {
      if (!config.keywords.some((kw) => norm.includes(normalizeText(kw)))) continue;
    } else {
      if (!config.keywords.some((kw) => norm.includes(normalizeText(kw)))) continue;
      if ((config.reject || []).some((kw) => norm.includes(normalizeText(kw)))) continue;
    }
    if (norm.includes("igrac") || norm.includes("player")) continue;
    if ((home && norm.includes(home)) || (away && norm.includes(away))) continue;

    const ou = findOverUnder(market);
    if (!ou) continue;
    const score = scoreStatCandidate(norm);
    candidates.push({ market, ...ou, score });
  }
  candidates.sort((a, b) => b.score - a.score || oddsAsymmetry(a) - oddsAsymmetry(b));
  return candidates[0] || null;
}

function findRedCardsOverUnder(market) {
  const odds = market.odds || [];
  const line = 0.5;
  let under = odds.find((odd) => {
    const norm = normalizeText(odd.name).replace(",", ".");
    return norm === "0" || norm === "0.0" || norm.includes("manje") || norm.includes("under") || norm.includes("bez");
  });
  let over = odds.find((odd) => {
    const norm = normalizeText(odd.name).replace(",", ".");
    return norm === "1+" || norm === "+1" || norm.includes("vise") || norm.includes("over") || /\b1\s*\+/.test(norm);
  });

  if (!under) {
    under = odds
      .filter((odd) => Number.isFinite(Number(odd.price)) && Number(odd.price) > 1)
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
  }
  if (!over) {
    over = odds.find((odd) => odd !== under);
  }

  if (!under || !Number.isFinite(Number(under.price))) return null;
  return { under, over, line };
}

function oddsAsymmetry(candidate) {
  const u = Number(candidate.under?.price);
  const o = Number(candidate.over?.price);
  if (!Number.isFinite(u) || !Number.isFinite(o) || u <= 0 || o <= 0) return 999;
  return Math.abs(1 / u - 1 / o);
}

function scoreStatCandidate(norm) {
  let score = 0;
  if (norm.includes("ukupno")) score += 4;
  if (!norm.includes("-")) score += 2;
  if (!norm.includes("poluvreme") && !norm.includes("half")) score += 2;
  return score;
}

function buildPlayerGoalModel(markets, playerName) {
  const playerNorm = normalizeText(playerName);
  const candidates = [];

  for (const market of markets) {
    const marketNorm = normalizeText(market.marketName);
    if (!marketNorm.includes("gol") && !marketNorm.includes("postiz") && !marketNorm.includes("score")) continue;
    const fullNorm = normalizeText(`${market.marketName} ${(market.odds || []).map((o) => `${o.name} ${o.playerName || ""}`).join(" ")}`);
    if (!fullNorm.includes(playerNorm)) continue;

    const yes = (market.odds || []).find((odd) => {
      const normOddName = normalizeText(odd.name);
      return isYesOdd(odd.name) ||
        normOddName.includes(playerNorm) ||
        normalizeText(odd.playerName || "") === playerNorm ||
        (normOddName.length > 3 && playerNorm.startsWith(normOddName));
    });
    if (!yes) continue;
    const no = (market.odds || []).find((odd) => isNoOdd(odd.name));

    let score = 0;
    if (marketNorm.includes("igrac") || marketNorm.includes("player")) score += 10;
    if (marketNorm.includes("postiz")) score += 5;
    candidates.push({ market, yes, no, score });
  }

  if (!candidates.length) return { dist: null, source: "" };
  candidates.sort((a, b) => b.score - a.score);
  const { market, yes, no } = candidates[0];

  let pGoal = 1 / yes.price;
  if (no) {
    const probs = normalizeImplied([yes.price, no.price]);
    if (probs) pGoal = probs[0];
  }
  const pClamped = clamp(pGoal, 0.01, 0.99);
  const lambdaPlayer = -Math.log(Math.max(1 - pClamped, 0.001));
  return {
    dist: poissonPmf(lambdaPlayer, MAX_GOALS),
    goalOdd: probabilityToOdds(pClamped, DEFAULT_OUTRIGHT_MARGIN),
    source: market.marketName
  };
}

function buildTeamGroupGoalDist(matchModels, teamRefs) {
  let combined = null;
  for (const ref of teamRefs) {
    const [eventId, side] = ref.split("|");
    const model = matchModels.find((item) => String(item.event.eventId) === eventId);
    if (!model) return null;
    const dist = side === "home" ? model.homeGoalDist : model.awayGoalDist;
    if (!dist) return null;
    combined = combined ? convolve(combined, dist, MAX_GOALS * Math.max(2, teamRefs.length)) : dist;
  }
  return combined;
}

function teamRefsToNames(matchModels, teamRefs) {
  return teamRefs.map((ref) => {
    const [eventId, side] = ref.split("|");
    const model = matchModels.find((item) => String(item.event.eventId) === eventId);
    if (!model) return ref;
    return side === "home" ? model.event.homeTeam : model.event.awayTeam;
  }).filter(Boolean);
}

function findOverUnder(market) {
  const odds = market.odds || [];
  let under = odds.find((odd) => isUnderOdd(odd.name));
  let over = odds.find((odd) => isOverOdd(odd.name));
  let line = extractLine(market.specialBetValue) || extractLine(market.marketName);

  for (const odd of odds) {
    if (!line) line = extractLine(odd.specialBetValue) || extractLine(odd.name);
  }

  if (!under || !over) {
    for (const odd of odds) {
      const norm = normalizeText(odd.name).replace(",", ".");
      if (!under && (norm.includes("0-") || norm.includes("manje"))) under = odd;
      if (!over && (/\d+\+/.test(norm) || norm.includes("vise"))) over = odd;
    }
  }

  if (!under || !over || !Number.isFinite(line)) return null;
  return { under, over, line };
}

function compareDistributions(a, b) {
  let aGreater = 0;
  let equal = 0;
  let bGreater = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      const p = (a[i] || 0) * (b[j] || 0);
      if (i > j) aGreater += p;
      else if (i === j) equal += p;
      else bGreater += p;
    }
  }
  return { aGreater, equal, bGreater };
}

function overUnderOdds(dist, line, multiplier) {
  let under = 0;
  let over = 0;
  for (let i = 0; i < dist.length; i += 1) {
    if (i < line) under += dist[i] || 0;
    else over += dist[i] || 0;
  }
  return {
    under: probabilityToOdds(under, multiplier),
    over: probabilityToOdds(over, multiplier)
  };
}

function probabilityToOdds(probability, multiplier = 1) {
  if (!Number.isFinite(probability) || probability <= 0.0001) return 999;
  return Math.min(999, (1 / probability) * multiplier);
}

function atLeastOneProbability(lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  return 1 - Math.exp(-lambda);
}

function poissonPmf(lambda, max) {
  const safeLambda = clamp(lambda, 0.001, 700);
  const limit = Math.max(1, Math.min(max, 1500));
  const pmf = [Math.exp(-safeLambda)];
  for (let i = 1; i <= limit; i += 1) {
    pmf[i] = pmf[i - 1] * safeLambda / i;
  }
  const sum = pmf.reduce((acc, p) => acc + p, 0);
  return pmf.map((p) => p / sum);
}

function convolve(a, b, max) {
  const out = Array(Math.min(max + 1, a.length + b.length - 1)).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      const idx = i + j;
      if (idx >= out.length) {
        out[out.length - 1] += (a[i] || 0) * (b[j] || 0);
      } else {
        out[idx] += (a[i] || 0) * (b[j] || 0);
      }
    }
  }
  const sum = out.reduce((acc, p) => acc + p, 0);
  return out.map((p) => p / sum);
}

function inferPoissonMeanFromUnder(line, pUnder) {
  const target = clamp(pUnder, 0.01, 0.99);
  const threshold = Math.floor(line);
  let low = 0.01;
  let high = Math.max(120, line * 2 + 50);
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const cdf = poissonCdf(threshold, mid);
    if (cdf > target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function poissonCdf(k, lambda) {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    sum += term;
  }
  return sum;
}

function expectedValue(dist) {
  return dist.reduce((sum, p, index) => sum + p * index, 0);
}

function chooseLine(expected, minLine = 0.5) {
  if (!Number.isFinite(expected)) return minLine;
  return Math.max(minLine, Math.floor(expected) + 0.5);
}

function normalizeImplied(prices) {
  const implied = prices.map((price) => 1 / Number(price));
  if (implied.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const total = implied.reduce((sum, value) => sum + value, 0);
  return implied.map((value) => value / total);
}

function isUnderOdd(name) {
  const norm = normalizeText(name);
  return norm.includes("manje") || norm.includes("under") || norm.includes("ispod");
}

function isOverOdd(name) {
  const norm = normalizeText(name);
  return norm.includes("vise") || norm.includes("over") || norm.includes("iznad") || norm.includes("preko");
}

function isYesOdd(name) {
  const norm = normalizeText(name);
  return norm === "da" || norm === "yes" || norm.includes("postize") || norm.includes("score");
}

function isNoOdd(name) {
  const norm = normalizeText(name);
  return norm === "ne" || norm === "no";
}

function extractLine(value) {
  const match = String(value ?? "").replace(",", ".").match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : NaN;
}

function extractPlayerFromText(text) {
  const match = String(text).match(/\b([A-Z][a-zA-Z'.-]+,\s*[A-Z][a-zA-Z'.-]+|[A-Z][a-zA-Z'.-]+\s+[A-Z]\.)\b/);
  return match ? match[1] : "";
}

function normalizePlayerName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatPlayerName(value) {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(value || "").trim();
}

function formatMatchName(event) {
  if (event.homeTeam && event.awayTeam) return `${event.homeTeam} - ${event.awayTeam}`;
  return event.matchName || "Unnamed event";
}

function buildDailyLeagueName(period, count) {
  return `Ukupno u danu ${formatPeriodLabel(period)}(${count} meca)`;
}

function formatDataRow(row) {
  return formatCsvRow([
    row.date,
    row.time,
    "",
    row.host,
    row.guest,
    row.one || "",
    row.draw || "",
    row.two || "",
    row.line || "",
    row.under || "",
    row.over || "",
    "",
    ""
  ]);
}

function formatCsvRow(row) {
  return DAILY_CSV_COLUMNS.map((_, index) => escapeCsvValue(row[index] ?? "")).join(";");
}

function escapeCsvValue(value) {
  const text = toAscii(String(value));
  if (/[;\r\n"]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatPrice(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, "") : "";
}

function formatLine(value) {
  return Number.isFinite(value) ? Number(value).toFixed(1) : "";
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
    .replace(/\u0111/g, "dj")
    .replace(/\u0110/g, "Dj");
}

function parseApiDate(value) {
  const date = value ? new Date(String(value).replace(" ", "T") + "Z") : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function localDateTimeToMs(date, time) {
  return new Date(`${date}T${time}:00`).getTime();
}

function addDaysIso(date, days) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
