/**
 * Check if an event matches a knockout or playoff round.
 */
export function isKnockoutMatch(event) {
  const name = (event.matchName || "").toLowerCase();
  const home = (event.homeTeam || "").toLowerCase();
  const away = (event.awayTeam || "").toLowerCase();

  const koKeywords = [
    "pobednik", "porazeni", "poraženi", "winner", "loser",
    "1/8", "1/4", "1/2", "osmina", "cetvrt", "četvrt",
    "polufinale", "finale", "knockout", "playoff", "play-off",
    "kvalifikacije", "qualification", "baraž", "baraz"
  ];

  return koKeywords.some(kw => name.includes(kw) || home.includes(kw) || away.includes(kw));
}

/**
 * Detect groups in the events list using graph connected components.
 * Returns an array of group objects: { name, teams: [...], matches: [...] }
 */
export function detectGroups(events) {
  const adj = {};
  const teamToEvent = {};

  for (const ev of events) {
    const t1 = ev.homeTeam;
    const t2 = ev.awayTeam;
    if (!t1 || !t2) continue;

    // Skip knockout-like placeholder matches
    if (isKnockoutMatch(ev)) continue;

    if (!adj[t1]) adj[t1] = new Set();
    if (!adj[t2]) adj[t2] = new Set();
    adj[t1].add(t2);
    adj[t2].add(t1);

    if (!teamToEvent[t1]) teamToEvent[t1] = [];
    if (!teamToEvent[t2]) teamToEvent[t2] = [];
    teamToEvent[t1].push(ev);
    teamToEvent[t2].push(ev);
  }

  const visited = new Set();
  const groups = [];

  // Sort teams alphabetically to make detection stable
  const teamsList = Object.keys(adj).sort();

  for (const team of teamsList) {
    if (visited.has(team)) continue;

    const component = [];
    const queue = [team];
    visited.add(team);

    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);

      for (const neighbor of adj[current]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // A group must have between 3 and 6 teams playing each other
    if (component.length >= 3 && component.length <= 6) {
      // Find matches where both home and away teams are in this component
      const groupMatches = events.filter(ev => {
        return component.includes(ev.homeTeam) && component.includes(ev.awayTeam) && !isKnockoutMatch(ev);
      });

      if (groupMatches.length > 0) {
        groups.push({
          name: `Grupa ${String.fromCharCode(65 + groups.length)}`, // Grupa A, Grupa B...
          teams: component.sort(),
          matches: groupMatches.sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))
        });
      }
    }
  }

  return groups;
}

/**
 * Read default 1, X, 2 (or 1, 2 for basketball) winner odds from event odds list.
 */
export function getEventWinnerOdds(event, sportId) {
  let home = 1.90, draw = 3.20, away = 1.90;
  let hasOdds = false;

  const oddsList = event.odds || [];

  if (sportId === 4) { // Basketball
    // Find winner odds. Sometimes market is 759 "Pobednik" (uklj. produžetke) or 751.
    // Let's filter odds for outcomes named "1" and "2"
    const odd1 = oddsList.find(o => String(o.name) === "1" || String(o.name).toLowerCase().includes("home") || String(o.name).toLowerCase().includes("domacin"));
    const odd2 = oddsList.find(o => String(o.name) === "2" || String(o.name).toLowerCase().includes("away") || String(o.name).toLowerCase().includes("gost"));
    
    if (odd1 && odd2) {
      home = Number(odd1.price);
      away = Number(odd2.price);
      draw = 0;
      hasOdds = true;
    }
  } else { // Soccer
    const odd1 = oddsList.find(o => String(o.name) === "1" || String(o.name).toLowerCase().includes("home"));
    const oddX = oddsList.find(o => String(o.name) === "X" || String(o.name).toLowerCase().includes("draw") || String(o.name).toLowerCase().includes("nerešeno"));
    const odd2 = oddsList.find(o => String(o.name) === "2" || String(o.name).toLowerCase().includes("away"));

    if (odd1 && oddX && odd2) {
      home = Number(odd1.price);
      draw = Number(oddX.price);
      away = Number(odd2.price);
      hasOdds = true;
    } else if (odd1 && odd2) {
      home = Number(odd1.price);
      draw = 3.20; // fallback
      away = Number(odd2.price);
      hasOdds = true;
    }
  }

  return { home, draw, away, hasOdds };
}

/**
 * Runs Monte Carlo simulation for a list of groups.
 * sportId: 5 (soccer), 4 (basketball)
 * oddsOverrides: Map / Object containing eventId -> { home, draw, away }
 */
export function runTournamentSimulation(groups, sportId, oddsOverrides = {}, iterations = 10000, bestThirdCount = null) {
  const stats = {};
  for (const group of groups) {
    for (const team of group.teams) {
      stats[team] = {
        winnerCount: 0,
        qualifyCount: 0,
        lastCount: 0,
        expectedPoints: 0,
        pointsFreq: {}
      };
    }
  }

  // Pre-calculate/normalize probabilities for all matches in all groups
  const groupMatchProbs = groups.map(group => {
    return {
      group,
      matchProbs: group.matches.map(match => {
        const override = oddsOverrides[match.eventId];
        let odds = override ? override : getEventWinnerOdds(match, sportId);

        let p1, pX, p2;
        if (sportId === 4) { // Basketball
          const ip1 = 1 / odds.home;
          const ip2 = 1 / odds.away;
          const sum = ip1 + ip2;
          p1 = ip1 / sum;
          pX = 0;
          p2 = ip2 / sum;
        } else { // Soccer
          const ip1 = 1 / odds.home;
          const ipX = 1 / odds.draw;
          const ip2 = 1 / odds.away;
          const sum = ip1 + ipX + ip2;
          p1 = ip1 / sum;
          pX = ipX / sum;
          p2 = ip2 / sum;
        }

        return { match, p1, pX, p2 };
      })
    };
  });

  // Check if we should apply the 3rd placed team qualification rules
  // For World Cup (12 groups): top 2 + 8 best 3rd placed qualify
  // For Euro (6 groups): top 2 + 4 best 3rd placed qualify
  if (bestThirdCount === null || bestThirdCount === undefined) {
    if (groups.length === 12) {
      bestThirdCount = 8;
    } else if (groups.length === 6) {
      bestThirdCount = 4;
    } else {
      bestThirdCount = 0;
    }
  }

  // Run simulation loops
  for (let iter = 0; iter < iterations; iter++) {
    const groupStandings = [];
    const thirdPlacedTeams = [];

    for (const { group, matchProbs } of groupMatchProbs) {
      const teams = group.teams;
      const points = {};
      const h2h = {};

      for (const team of teams) {
        points[team] = 0;
        h2h[team] = {};
      }

      for (const item of matchProbs) {
        const { match, p1, pX, p2 } = item;
        const home = match.homeTeam;
        const away = match.awayTeam;
        const r = Math.random();

        if (r < p1) {
          if (sportId === 4) {
            points[home] += 2;
            points[away] += 1;
          } else {
            points[home] += 3;
          }
          h2h[home][away] = home;
          h2h[away][home] = home;
        } else if (r < p1 + pX) {
          points[home] += 1;
          points[away] += 1;
          h2h[home][away] = "draw";
          h2h[away][home] = "draw";
        } else {
          if (sportId === 4) {
            points[away] += 2;
            points[home] += 1;
          } else {
            points[away] += 3;
          }
          h2h[home][away] = away;
          h2h[away][home] = away;
        }
      }

      // Sort teams to establish group standings
      const standing = [...teams].sort((a, b) => {
        if (points[b] !== points[a]) {
          return points[b] - points[a];
        }
        const winner = h2h[a][b];
        if (winner === a) return -1;
        if (winner === b) return 1;
        return Math.random() - 0.5;
      });

      // Record first place
      stats[standing[0]].winnerCount++;
      // Record last place
      stats[standing[standing.length - 1]].lastCount++;

      // Record points frequency and expected points sum
      for (const team of teams) {
        const pts = points[team];
        stats[team].expectedPoints += pts;
        stats[team].pointsFreq[pts] = (stats[team].pointsFreq[pts] || 0) + 1;
      }

      // Save group standings for qualification determination
      groupStandings.push({
        standing,
        points
      });

      if (bestThirdCount > 0 && standing.length >= 3) {
        thirdPlacedTeams.push({
          team: standing[2],
          points: points[standing[2]]
        });
      }
    }

    // Determine who qualifies this iteration
    if (bestThirdCount > 0) {
      // 1. Top 2 from each group qualify automatically
      for (const gs of groupStandings) {
        stats[gs.standing[0]].qualifyCount++;
        if (gs.standing.length > 1) {
          stats[gs.standing[1]].qualifyCount++;
        }
      }

      // 2. Rank the 3rd placed teams and top bestThirdCount qualify
      // Since we don't simulate goal difference, ties in points are resolved randomly
      thirdPlacedTeams.sort((a, b) => {
        if (b.points !== a.points) {
          return b.points - a.points;
        }
        return Math.random() - 0.5;
      });

      for (let i = 0; i < bestThirdCount && i < thirdPlacedTeams.length; i++) {
        stats[thirdPlacedTeams[i].team].qualifyCount++;
      }
    } else {
      // Default rule: top 2 qualify
      for (const gs of groupStandings) {
        stats[gs.standing[0]].qualifyCount++;
        if (gs.standing.length > 1) {
          stats[gs.standing[1]].qualifyCount++;
        }
      }
    }
  }

  // Normalize final results
  const results = {};
  for (const group of groups) {
    for (const team of group.teams) {
      const teamStats = stats[team];
      results[team] = {
        pWinner: teamStats.winnerCount / iterations,
        pQualify: teamStats.qualifyCount / iterations,
        pLast: teamStats.lastCount / iterations,
        expectedPoints: teamStats.expectedPoints / iterations,
        pointsDistribution: {}
      };

      const maxPoints = sportId === 4 ? 6 : 9; // Max possible points
      for (let pts = 0; pts <= maxPoints; pts++) {
        results[team].pointsDistribution[pts] = (teamStats.pointsFreq[pts] || 0) / iterations;
      }
    }
  }

  return results;
}

/**
 * Runs Monte Carlo simulation for a single group.
 * sportId: 5 (soccer), 4 (basketball)
 * oddsOverrides: Map / Object containing eventId -> { home, draw, away }
 */
export function runGroupSimulation(group, sportId, oddsOverrides = {}, iterations = 10000) {
  return runTournamentSimulation([group], sportId, oddsOverrides, iterations);
}


/**
 * Calculates fair odds and dynamic line targets based on simulation outputs, applying the margin.
 */
export function calculateOddsForGroup(group, results, marginMultiplier) {
  const odds = {};

  for (const team of group.teams) {
    const res = results[team];

    // Helper to calculate margin-adjusted price
    const makePrice = (prob) => {
      if (prob <= 0.0001) return 999.00;
      const fairOdds = 1 / prob;
      return Number((fairOdds * marginMultiplier).toFixed(2));
    };

    // Calculate outright prices
    const winnerOdds = makePrice(res.pWinner);
    const qualifyOdds = makePrice(res.pQualify);
    const lastOdds = makePrice(res.pLast);

    // Calculate Points line (closest half-integer)
    const exp = res.expectedPoints;
    const line = Math.floor(exp) + 0.5;

    // Sum probabilities below and above the line
    let pUnder = 0;
    let pOver = 0;

    for (const [ptsStr, prob] of Object.entries(res.pointsDistribution)) {
      const pts = Number(ptsStr);
      if (pts < line) {
        pUnder += prob;
      } else {
        pOver += prob;
      }
    }

    const underOdds = makePrice(pUnder);
    const overOdds = makePrice(pOver);

    odds[team] = {
      winnerOdds,
      qualifyOdds,
      lastOdds,
      line,
      underOdds,
      overOdds,
      expectedPoints: res.expectedPoints
    };
  }

  return odds;
}
