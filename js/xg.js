const TARGET_TOTAL_LINES = [2.5, 3.5, 4.5];
const MAX_GOALS = 12;
const BALANCED_LINE_THRESHOLD = 0.12;
const BALANCE_IMPROVEMENT_THRESHOLD = 0.08;

export function calculateSoccerXg(markets, event) {
  const winnerMarket = findWinnerMarket(markets);

  if (!winnerMarket) {
    return {
      ok: false,
      reason: "Nedostaje 1X2 market."
    };
  }

  const oneXTwo = shinNormalize(winnerMarket.odds.map((odd) => odd.price));
  if (!oneXTwo) {
    return { ok: false, reason: "1X2 kvote nisu validne za xG obračun." };
  }

  const totalMarket = findBestTotalGoalsMarket(markets, event, oneXTwo);
  if (!totalMarket) {
    return {
      ok: false,
      reason: "Nedostaje O/U 2.5, 3.5 ili 4.5."
    };
  }

  const totals = shinNormalize([totalMarket.under.price, totalMarket.over.price]);

  if (!totals) {
    return { ok: false, reason: "Kvote nisu validne za xG obračun." };
  }

  const targets = {
    home: oneXTwo[0],
    draw: oneXTwo[1],
    away: oneXTwo[2],
    under: totals[0],
    over: totals[1],
    line: totalMarket.line
  };
  const fit = fitDixonColesTargets(targets);

  return {
    ok: true,
    homeTeam: event?.homeTeam || "Domaćin",
    awayTeam: event?.awayTeam || "Gost",
    lambdaHome: fit.lambdaHome,
    lambdaAway: fit.lambdaAway,
    rho: fit.rho,
    line: totalMarket.line,
    marketName: totalMarket.market.marketName,
    sourceOdds: {
      underName: totalMarket.under.name,
      underPrice: totalMarket.under.price,
      overName: totalMarket.over.name,
      overPrice: totalMarket.over.price
    },
    balancedDiff: totalMarket.balance,
    targets,
    fitted: fit.probs,
    error: fit.error
  };
}

function findWinnerMarket(markets) {
  const candidates = markets
    .filter((market) => market.odds?.length === 3)
    .map((market) => {
      const one = findOddByExactName(market.odds, "1");
      const draw = findOddByExactName(market.odds, "X");
      const two = findOddByExactName(market.odds, "2");
      if (!one || !draw || !two) return null;
      const normName = normalizeText(market.marketName);
      const score = normName.includes("konacan") || normName.includes("ishod") || normName.includes("pobednik") ? 0 : 1;
      return { market, odds: [one, draw, two], score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);

  return candidates[0] || null;
}

function findBestTotalGoalsMarket(markets, event, oneXTwo) {
  const candidates = [];
  const homeTeam = normalizeText(event?.homeTeam);
  const awayTeam = normalizeText(event?.awayTeam);

  for (const market of markets) {
    if (!market.odds || market.odds.length < 2) continue;

    const normName = normalizeText(market.marketName);
    const looksLikeGoals = normName.includes("gol") || normName.includes("goal");
    const looksLikeTotal = normName.includes("ukup") || normName.includes("total") || looksLikeGoals;
    const looksLikeMatchTotal = !/\b(poluvreme|half|tim|ekipa|domacin|gost|igrac|player)\b/.test(normName);
    if (!looksLikeGoals || !looksLikeTotal) continue;
    if (!looksLikeMatchTotal) continue;
    if ((homeTeam && normName.includes(homeTeam)) || (awayTeam && normName.includes(awayTeam))) continue;

    const line = extractTotalLine(market);
    if (!TARGET_TOTAL_LINES.includes(line)) continue;

    const { under, over } = findOverUnderOdds(market.odds, line);
    if (!under || !over) continue;

    const probs = shinNormalize([under.price, over.price]);
    if (!probs) continue;

    candidates.push({
      market,
      under,
      over,
      line,
      score: scoreTotalGoalsCandidate(market, under, over),
      modelPenalty: scoreModelConsistency(oneXTwo, probs, line),
      balance: Math.abs(probs[0] - probs[1])
    });
  }

  return chooseTotalGoalsCandidate(candidates);
}

function chooseTotalGoalsCandidate(candidates) {
  if (!candidates.length) return null;

  const sortedByLinePreference = [...candidates].sort((a, b) => {
    const lineDiff = TARGET_TOTAL_LINES.indexOf(a.line) - TARGET_TOTAL_LINES.indexOf(b.line);
    return lineDiff || b.score - a.score || a.modelPenalty - b.modelPenalty || a.balance - b.balance;
  });
  const baseline = sortedByLinePreference.find((candidate) => candidate.line === 2.5);
  if (!baseline) {
    return [...candidates].sort((a, b) => b.score - a.score || a.modelPenalty - b.modelPenalty || a.balance - b.balance || TARGET_TOTAL_LINES.indexOf(a.line) - TARGET_TOTAL_LINES.indexOf(b.line))[0];
  }

  const bestAlternative = candidates
    .filter((candidate) => candidate.line !== 2.5)
    .sort((a, b) => b.score - a.score || a.modelPenalty - b.modelPenalty || a.balance - b.balance || TARGET_TOTAL_LINES.indexOf(a.line) - TARGET_TOTAL_LINES.indexOf(b.line))[0];

  if (
    bestAlternative &&
    baseline.balance > BALANCED_LINE_THRESHOLD &&
    baseline.balance - bestAlternative.balance >= BALANCE_IMPROVEMENT_THRESHOLD
  ) {
    return bestAlternative;
  }

  return baseline;
}

function scoreModelConsistency(oneXTwo, totalProbs, line) {
  const fit = fitDixonColesTargets({
    home: oneXTwo[0],
    draw: oneXTwo[1],
    away: oneXTwo[2],
    under: totalProbs[0],
    over: totalProbs[1],
    line
  });
  return Math.abs(fit.rho) + fit.error * 1000;
}

function scoreTotalGoalsCandidate(market, under, over) {
  const normName = normalizeText(market.marketName);
  const underName = normalizeText(under.name);
  const overName = normalizeText(over.name);
  let score = 0;

  if (normName === "ukupno golova" || normName === "total goals") score += 5;
  if (!normName.includes("-") && !normName.includes(";")) score += 2;
  if (underName.startsWith("manje") || underName.startsWith("under")) score += 1;
  if (overName.startsWith("vise") || overName.startsWith("over")) score += 1;
  if (/\b2[,.]5\b/.test(underName) && /\b2[,.]5\b/.test(overName)) score += 1;

  return score;
}

function findOddByExactName(odds, name) {
  return odds.find((odd) => normalizeText(odd.name).toUpperCase() === name);
}

function findOverUnderOdds(odds, line) {
  let under = odds.find((odd) => {
    const norm = normalizeText(odd.name);
    return norm.includes("manje") || norm.includes("under") || norm.includes("ispod");
  });
  let over = odds.find((odd) => {
    const norm = normalizeText(odd.name);
    return norm.includes("vise") || norm.includes("over") || norm.includes("iznad") || norm.includes("preko");
  });

  if (under && over) return { under, over };

  for (const odd of odds) {
    const side = inferTotalSideFromOutcome(odd.name, line);
    if (side === "under" && !under) under = odd;
    if (side === "over" && !over) over = odd;
  }

  return { under, over };
}

function inferTotalSideFromOutcome(name, line) {
  const norm = normalizeText(name).replace(",", ".");
  const thresholdUnder = Math.floor(line);
  const thresholdOver = Math.ceil(line);

  const plus = norm.match(/\b(\d+)\s*\+/);
  if (plus && Number(plus[1]) >= thresholdOver) return "over";

  const range = norm.match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (max <= thresholdUnder) return "under";
    if (min >= thresholdOver) return "over";
  }

  return null;
}

function extractTotalLine(market) {
  const parts = [market.specialBetValue, market.marketName, ...(market.odds ?? []).flatMap((odd) => [odd.specialBetValue, odd.name])];
  for (const part of parts) {
    const match = String(part ?? "").replace(",", ".").match(/\b([2-4]\.5)\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

function shinNormalize(prices) {
  const implied = prices.map((price) => 1 / Number(price));
  if (implied.some((p) => !Number.isFinite(p) || p <= 0)) return null;

  const total = implied.reduce((sum, p) => sum + p, 0);
  if (total <= 1) return implied.map((p) => p / total);

  let low = 0;
  let high = 0.999999;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const sum = shinProbabilities(implied, mid).reduce((acc, p) => acc + p, 0);
    if (sum > 1) low = mid;
    else high = mid;
  }

  const probs = shinProbabilities(implied, (low + high) / 2);
  const probSum = probs.reduce((sum, p) => sum + p, 0);
  return probs.map((p) => p / probSum);
}

function shinProbabilities(implied, z) {
  const total = implied.reduce((sum, p) => sum + p, 0);
  return implied.map((p) => {
    if (z <= 1e-12) return p / Math.sqrt(total);
    return (Math.sqrt((z * z) + (4 * (1 - z) * p * p / total)) - z) / (2 * (1 - z));
  });
}

function fitDixonColesTargets(targets) {
  const initialTotal = Math.max(0.4, inversePoissonTotalMean(targets.under, targets.line));
  const initialHomeShare = clamp(0.5 + (targets.home - targets.away) * 0.8, 0.2, 0.8);
  let best = evaluateParams(initialTotal * initialHomeShare, initialTotal * (1 - initialHomeShare), -0.05, targets);
  const starts = [
    [initialTotal * initialHomeShare, initialTotal * (1 - initialHomeShare), -0.05],
    [1.35, 1.05, -0.05],
    [1.05, 1.05, 0],
    [1.7, 0.8, -0.08],
    [0.8, 1.7, -0.08]
  ];

  for (const start of starts) {
    let current = evaluateParams(start[0], start[1], start[2], targets);
    let steps = [0.32, 0.32, 0.08];

    for (let pass = 0; pass < 42; pass += 1) {
      let improved = false;
      for (let idx = 0; idx < 3; idx += 1) {
        for (const dir of [-1, 1]) {
          const next = [current.lambdaHome, current.lambdaAway, current.rho];
          next[idx] += dir * steps[idx];
          const candidate = evaluateParams(next[0], next[1], next[2], targets);
          if (candidate.error < current.error) {
            current = candidate;
            improved = true;
          }
        }
      }
      if (!improved) steps = steps.map((step) => step * 0.58);
    }

    if (current.error < best.error) best = current;
  }

  return best;
}

function evaluateParams(lambdaHome, lambdaAway, rho, targets) {
  const h = clamp(lambdaHome, 0.05, 5.5);
  const a = clamp(lambdaAway, 0.05, 5.5);
  const r = clamp(rho, -0.35, 0.35);
  const probs = dixonColesProbabilities(h, a, r, targets.line);
  const error =
    square(probs.home - targets.home) * 1.4 +
    square(probs.draw - targets.draw) * 1.4 +
    square(probs.away - targets.away) * 1.4 +
    square(probs.under - targets.under) +
    square(probs.over - targets.over);

  return { lambdaHome: h, lambdaAway: a, rho: r, probs, error };
}

function dixonColesProbabilities(lambdaHome, lambdaAway, rho, totalLine) {
  const homePmf = poissonPmf(lambdaHome, MAX_GOALS);
  const awayPmf = poissonPmf(lambdaAway, MAX_GOALS);
  let home = 0;
  let draw = 0;
  let away = 0;
  let under = 0;
  let totalMass = 0;

  for (let h = 0; h <= MAX_GOALS; h += 1) {
    for (let a = 0; a <= MAX_GOALS; a += 1) {
      const adjusted = homePmf[h] * awayPmf[a] * dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      totalMass += adjusted;
      if (h > a) home += adjusted;
      else if (h === a) draw += adjusted;
      else away += adjusted;
      if (h + a < totalLine) under += adjusted;
    }
  }

  home /= totalMass;
  draw /= totalMass;
  away /= totalMass;
  under /= totalMass;
  return { home, draw, away, under, over: 1 - under };
}

function dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {
  if (homeGoals === 0 && awayGoals === 0) return Math.max(0.01, 1 - lambdaHome * lambdaAway * rho);
  if (homeGoals === 0 && awayGoals === 1) return Math.max(0.01, 1 + lambdaHome * rho);
  if (homeGoals === 1 && awayGoals === 0) return Math.max(0.01, 1 + lambdaAway * rho);
  if (homeGoals === 1 && awayGoals === 1) return Math.max(0.01, 1 - rho);
  return 1;
}

function poissonPmf(lambda, maxGoals) {
  const pmf = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maxGoals; goals += 1) {
    pmf[goals] = pmf[goals - 1] * lambda / goals;
  }
  return pmf;
}

function inversePoissonTotalMean(targetUnder, line) {
  const threshold = Math.floor(line);
  let bestMean = 2.5;
  let bestDiff = Infinity;
  for (let mean = 0.2; mean <= 6.5; mean += 0.01) {
    let cdf = 0;
    let term = Math.exp(-mean);
    cdf += term;
    for (let goals = 1; goals <= threshold; goals += 1) {
      term *= mean / goals;
      cdf += term;
    }
    const diff = Math.abs(cdf - targetUnder);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMean = mean;
    }
  }
  return bestMean;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function square(value) {
  return value * value;
}
