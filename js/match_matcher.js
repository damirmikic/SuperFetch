/**
 * Reconciles the Superbet offer against the Merkurxtip offer.
 *
 * Neither feed exposes a shared external id (Merkur has `brMatchId`, Superbet
 * exposes nothing comparable), so matches are paired on kickoff time plus fuzzy
 * team-name similarity. Names diverge a lot between the two books
 * ("Ch. Odessa" vs "Chernomorets Odesa", "Zhejiang Prof." vs
 * "Zhejiang Professional", "Man Utd W" vs "Manchester United (Z)"), so the
 * comparison happens on normalized token sets rather than whole strings.
 */

// Corporate/legal-form tokens that carry no identifying information.
const NOISE_TOKENS = new Set([
  "fc", "fk", "sc", "sk", "ac", "cf", "afc", "cd", "ca", "cs", "nk", "mfk",
  "as", "ss", "us", "sv", "tsv", "fsv", "vfb", "vfl", "if", "ff", "bk", "ks",
  "club", "clube", "calcio", "de", "del", "la", "el", "al", "the", "1"
]);

const TOKEN_ALIASES = new Map(Object.entries({
  utd: "united",
  wien: "vienna",
  prof: "professional",
  monchengladbach: "gladbach",
  mgladbach: "gladbach",
  st: "saint",
  sankt: "saint",
  atl: "atletico",
  dep: "deportivo",
  sp: "sporting",
  wom: "w",
  women: "w",
  zene: "w"
}));

// Superbet marks women's teams with a parenthesized "(Z)" (originally "(Ž)").
// This has to be caught before punctuation is stripped, because a bare "z"
// token is just as often an abbreviated first word ("Gornik Z." = Zabrze).
const WOMEN_MARKER = /\(\s*[zw]\s*\)/g;

// Suffix markers that change *which* team it is, not just its spelling.
const RESERVE_TOKENS = new Set(["ii", "iii", "b", "r", "am", "res", "reserve", "2", "3"]);
const AGE_TOKEN = /^u\d{2}$/;

export const DEFAULT_MATCH_OPTIONS = {
  // Both books quote the same scheduled kickoff, but occasionally differ by a
  // minute or two on rescheduled fixtures.
  timeToleranceMinutes: 15,
  threshold: 0.72,
  // Applied once a league on one side has been confidently mapped to a league
  // on the other, which makes a weak name pair far more believable.
  leagueBonus: 0.12,
  // Only pairs at or above this score are trusted enough to build the league map.
  leagueMapThreshold: 0.85,
  // [merkurName, superbetName] tuples for sides whose names share no letters -
  // national teams above all, since the two books use different languages.
  // Supplied by the caller, because club aliases are per sport.
  aliasPairs: []
};

function coreKey(name) {
  return normalizeTeamName(name).core.join(" ");
}

/**
 * Turns alias tuples into a lookup keyed on *core* tokens, so a single entry
 * covers a side's senior, reserve, youth and women's variants alike.
 */
export function buildAliasIndex(pairs = []) {
  const index = new Set();

  for (const pair of pairs) {
    const [merkurName, superbetName] = pair;
    const merkurKey = coreKey(merkurName);
    const superbetKey = coreKey(superbetName);

    if (merkurKey && superbetKey) {
      index.add(`${superbetKey}||${merkurKey}`);
    }
  }

  return index;
}

export function normalizeTeamName(name) {
  const ascii = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();

  const isWomen = WOMEN_MARKER.test(ascii);
  WOMEN_MARKER.lastIndex = 0;

  // Merkur abbreviates the tail of a name to its initial ("Havant & W" =
  // Waterlooville), which is indistinguishable from its women's marker. An
  // ampersand means the "W" is an abbreviation, not a marker.
  const ampersand = ascii.includes("&");

  const cleaned = ascii.replace(WOMEN_MARKER, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const rawTokens = cleaned ? cleaned.split(" ") : [];

  const core = [];
  const flags = new Set();

  if (isWomen) {
    flags.add("w");
  }

  for (const rawToken of rawTokens) {
    const token = TOKEN_ALIASES.get(rawToken) ?? rawToken;

    if (token === "w" && !ampersand) {
      flags.add("w");
      continue;
    }

    if (RESERVE_TOKENS.has(token)) {
      flags.add("b");
      continue;
    }

    if (AGE_TOKEN.test(token)) {
      flags.add(token);
      continue;
    }

    if (NOISE_TOKENS.has(token)) {
      continue;
    }

    core.push(token);
  }

  // Everything was stripped ("FC B" and the like) - fall back to raw tokens so
  // the pair still has something to compare.
  if (!core.length && rawTokens.length) {
    core.push(...rawTokens);
  }

  return { core, flags };
}

function tokenSimilarity(a, b) {
  if (a === b) {
    return 1;
  }

  // Abbreviations are the dominant failure mode: "Ch." / "Chernomorets".
  if (a.startsWith(b) || b.startsWith(a)) {
    return Math.min(a.length, b.length) >= 4 ? 0.95 : 0.8;
  }

  // Transliteration differences between the two books are routine
  // ("Zhytomyr"/"Zhytomir" = 0.71, "Gabala"/"Qabala" = 0.80), so the floor sits
  // low deliberately - the fixture-level threshold is what rejects bad pairs.
  // Dropping it further than this buys almost nothing and costs precision.
  const ratio = diceCoefficient(a, b);
  return ratio > 0.55 ? ratio : 0;
}

function diceCoefficient(a, b) {
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const bigrams = new Map();

  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }

  let hits = 0;

  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;

    if (count > 0) {
      bigrams.set(gram, count - 1);
      hits += 1;
    }
  }

  return (2 * hits) / (a.length + b.length - 2);
}

function coreSimilarity(left, right) {
  if (!left.length || !right.length) {
    return 0;
  }

  const directional = (source, target) => {
    let total = 0;

    for (const token of source) {
      let best = 0;

      for (const candidate of target) {
        best = Math.max(best, tokenSimilarity(token, candidate));
      }

      total += best;
    }

    return total / source.length;
  };

  // Directional max, not the average: one side routinely carries extra words
  // ("Hougang" vs "Hougang United") and should not be punished for it.
  return Math.max(directional(left, right), directional(right, left));
}

function flagCompatibility(left, right) {
  const leftWomen = left.has("w");
  const rightWomen = right.has("w");

  // A women's side is never the same team as the men's side of the same club.
  if (leftWomen !== rightWomen) {
    return 0;
  }

  const leftRank = new Set([...left].filter((flag) => flag !== "w"));
  const rightRank = new Set([...right].filter((flag) => flag !== "w"));

  if (leftRank.size === rightRank.size && [...leftRank].every((flag) => rightRank.has(flag))) {
    return 1;
  }

  // One book writes "Zaglebie Lubin II" where the other writes "Zaglebie 2" or
  // "Parnu U21" - related but not identical markers, so soften rather than reject.
  if (!leftRank.size || !rightRank.size) {
    return 0.55;
  }

  return 0.7;
}

export function teamSimilarity(superbetName, merkurName, aliasIndex) {
  const a = normalizeTeamName(superbetName);
  const b = normalizeTeamName(merkurName);
  const flags = flagCompatibility(a.flags, b.flags);

  if (flags === 0) {
    return 0;
  }

  // An explicit alias settles the name question outright; the flag factor still
  // applies, so "Wolves W" stays distinct from "Wolverhampton U21".
  const aliased = aliasIndex?.has(`${a.core.join(" ")}||${b.core.join(" ")}`);
  const core = aliased ? 1 : coreSimilarity(a.core, b.core);
  return flags === 1 ? core : core * (0.75 + 0.25 * flags);
}

export function fixtureSimilarity(superbetEvent, merkurMatch, aliasIndex) {
  const home = teamSimilarity(superbetEvent.homeTeam, merkurMatch.home, aliasIndex);

  if (home === 0) {
    return 0;
  }

  const away = teamSimilarity(superbetEvent.awayTeam, merkurMatch.away, aliasIndex);

  if (away === 0) {
    return 0;
  }

  return (home + away) / 2;
}

function looseTokenSimilarity(a, b) {
  if (a === b) {
    return 1;
  }

  return a.startsWith(b) || b.startsWith(a) ? 0.9 : diceCoefficient(a, b);
}

function looseTeamScore(superbetName, merkurName) {
  const a = normalizeTeamName(superbetName).core;
  const b = normalizeTeamName(merkurName).core;

  if (!a.length || !b.length) {
    return 0;
  }

  const directional = (source, target) =>
    source.reduce((total, token) =>
      total + Math.max(...target.map((other) => looseTokenSimilarity(token, other))), 0) / source.length;

  return Math.max(directional(a, b), directional(b, a));
}

/**
 * Ranks still-unpaired Superbet events as possible partners for one unpaired
 * Merkur match, for human review.
 *
 * Deliberately far more permissive than `fixtureSimilarity()`: it ignores the
 * women/men hard reject and the token floor, because the whole point is to
 * surface the pairs the matcher threw away. Scores from here are a sort order
 * for a person to judge, never grounds to pair automatically.
 */
export function suggestPartners(merkurMatch, superbetEvents, options = {}) {
  const { timeToleranceMinutes = DEFAULT_MATCH_OPTIONS.timeToleranceMinutes, limit = 3 } = options;
  const minute = Math.floor(merkurMatch.kickoffMs / 60000);

  return superbetEvents
    .filter((event) => {
      const kickoff = eventKickoffMs(event);
      return kickoff && Math.abs(Math.floor(kickoff / 60000) - minute) <= timeToleranceMinutes;
    })
    .map((event) => ({
      event,
      score: (looseTeamScore(event.homeTeam, merkurMatch.home)
        + looseTeamScore(event.awayTeam, merkurMatch.away)) / 2
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Pairs the two offers and reports which Superbet events have no Merkur
 * counterpart. Runs in two passes: the first pairs only obvious matches and
 * uses them to learn which Superbet tournament corresponds to which Merkur
 * league, the second re-runs with that mapping as a tie-breaker so that
 * awkwardly-spelled fixtures inside an already-known league still pair up.
 */
export function compareOffers(superbetEvents, merkurMatches, options = {}) {
  const config = { ...DEFAULT_MATCH_OPTIONS, ...options };
  config.aliasIndex = buildAliasIndex(config.aliasPairs);
  const candidates = buildCandidatePairs(superbetEvents, merkurMatches, config);

  const takenEvents = new Set();
  const takenMatches = new Set();
  const pairs = [];

  for (const candidate of candidates) {
    if (candidate.score < config.leagueMapThreshold) {
      break;
    }

    if (takenEvents.has(candidate.event.eventId) || takenMatches.has(candidate.match.matchId)) {
      continue;
    }

    takenEvents.add(candidate.event.eventId);
    takenMatches.add(candidate.match.matchId);
    pairs.push({ ...candidate, finalScore: candidate.score, viaLeague: false });
  }

  const leagueMap = buildLeagueMap(pairs);

  for (const candidate of candidates) {
    if (takenEvents.has(candidate.event.eventId) || takenMatches.has(candidate.match.matchId)) {
      continue;
    }

    const viaLeague = leagueMap.get(candidate.event.tournamentId) === candidate.match.leagueId;
    const finalScore = candidate.score + (viaLeague ? config.leagueBonus : 0);

    if (finalScore < config.threshold) {
      continue;
    }

    takenEvents.add(candidate.event.eventId);
    takenMatches.add(candidate.match.matchId);
    pairs.push({ ...candidate, finalScore, viaLeague });
  }

  return {
    pairs,
    leagueMap,
    missingOnMerkur: superbetEvents.filter((event) => !takenEvents.has(event.eventId)),
    missingOnSuperbet: merkurMatches.filter((match) => !takenMatches.has(match.matchId))
  };
}

function buildCandidatePairs(superbetEvents, merkurMatches, config) {
  const tolerance = Math.max(0, Math.round(config.timeToleranceMinutes));
  const buckets = new Map();

  for (const match of merkurMatches) {
    if (!match.kickoffMs) {
      continue;
    }

    const minute = Math.floor(match.kickoffMs / 60000);

    for (let offset = -tolerance; offset <= tolerance; offset += 1) {
      const key = minute + offset;
      const bucket = buckets.get(key);

      if (bucket) {
        bucket.push(match);
      } else {
        buckets.set(key, [match]);
      }
    }
  }

  const candidates = [];

  for (const event of superbetEvents) {
    const kickoffMs = eventKickoffMs(event);

    if (!kickoffMs) {
      continue;
    }

    for (const match of buckets.get(Math.floor(kickoffMs / 60000)) ?? []) {
      const score = fixtureSimilarity(event, match, config.aliasIndex);

      if (score > 0) {
        candidates.push({ event, match, score });
      }
    }
  }

  // Greedy best-first assignment: a fixture claims its strongest partner before
  // weaker pairs get a chance at it.
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function buildLeagueMap(pairs) {
  const counts = new Map();

  for (const pair of pairs) {
    const tournamentId = pair.event.tournamentId;
    const tally = counts.get(tournamentId) ?? new Map();
    tally.set(pair.match.leagueId, (tally.get(pair.match.leagueId) ?? 0) + 1);
    counts.set(tournamentId, tally);
  }

  const leagueMap = new Map();

  for (const [tournamentId, tally] of counts) {
    let bestLeagueId = null;
    let bestCount = 0;

    for (const [leagueId, count] of tally) {
      if (count > bestCount) {
        bestCount = count;
        bestLeagueId = leagueId;
      }
    }

    if (bestLeagueId !== null) {
      leagueMap.set(tournamentId, bestLeagueId);
    }
  }

  return leagueMap;
}

export function eventKickoffMs(event) {
  if (event.unixDateMillis) {
    return Number(event.unixDateMillis);
  }

  const parsed = Date.parse(event.utcDate ?? event.matchDate ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}
