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

function computeTeamRatings(groups, sportId, oddsOverrides) {
  const ratings = {};
  for (const group of groups) {
    for (const team of group.teams) {
      ratings[team] = 100.0;
    }
  }

  const matchesList = [];
  for (const group of groups) {
    for (const match of group.matches) {
      const override = oddsOverrides[match.eventId];
      const odds = override ? override : getEventWinnerOdds(match, sportId);
      
      let pH = 1 / (odds.home || 3);
      let pA = 1 / (odds.away || 3);
      const sum = pH + pA;
      if (sum > 0) {
        matchesList.push({
          home: match.homeTeam,
          away: match.awayTeam,
          pH: pH / sum,
          pA: pA / sum
        });
      }
    }
  }

  const lr = 10.0;
  for (let iter = 0; iter < 100; iter++) {
    for (const m of matchesList) {
      const rH = ratings[m.home];
      const rA = ratings[m.away];
      const eH = rH / (rH + rA);
      const err = m.pH - eH;
      ratings[m.home] += lr * err;
      ratings[m.away] -= lr * err;
      if (ratings[m.home] < 1.0) ratings[m.home] = 1.0;
      if (ratings[m.away] < 1.0) ratings[m.away] = 1.0;
    }
  }
  return ratings;
}

function assignThirdPlacedTeams(qualifiedGroups, matchConfigs) {
  const assignment = {};
  const used = new Set();
  
  function dfs(matchIdx) {
    if (matchIdx === matchConfigs.length) {
      return true;
    }
    const config = matchConfigs[matchIdx];
    for (const group of qualifiedGroups) {
      if (!used.has(group) && config.allowed.includes(group)) {
        used.add(group);
        assignment[config.matchId] = group;
        if (dfs(matchIdx + 1)) {
          return true;
        }
        used.delete(group);
        delete assignment[config.matchId];
      }
    }
    return false;
  }
  
  if (dfs(0)) {
    return assignment;
  }
  return null;
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

function normalizeFreq(freqMap, iterations) {
  const norm = {};
  for (const [k, v] of Object.entries(freqMap)) {
    norm[k] = v / iterations;
  }
  return norm;
}

function sampleMatchScore(outcome) {
  if (outcome === "home") {
    const r = Math.random() * 100;
    if (r < 25) return [1, 0];
    if (r < 45) return [2, 0];
    if (r < 65) return [2, 1];
    if (r < 75) return [3, 0];
    if (r < 85) return [3, 1];
    if (r < 90) return [3, 2];
    if (r < 93) return [4, 0];
    if (r < 96) return [4, 1];
    if (r < 98) return [4, 2];
    if (r < 99) return [4, 3];
    return [5, 1];
  } else if (outcome === "draw") {
    const r = Math.random() * 100;
    if (r < 25) return [0, 0];
    if (r < 75) return [1, 1];
    if (r < 95) return [2, 2];
    if (r < 99) return [3, 3];
    return [4, 4];
  } else { // outcome === "away"
    const r = Math.random() * 100;
    if (r < 25) return [0, 1];
    if (r < 45) return [0, 2];
    if (r < 65) return [1, 2];
    if (r < 75) return [0, 3];
    if (r < 85) return [1, 3];
    if (r < 90) return [2, 3];
    if (r < 93) return [0, 4];
    if (r < 96) return [1, 4];
    if (r < 98) return [2, 4];
    if (r < 99) return [3, 4];
    return [1, 5];
  }
}

function findTeamOutrightOdd(teamName, outrightOdds) {
  if (!outrightOdds) return null;
  if (outrightOdds[teamName]) return outrightOdds[teamName];

  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const normTeam = norm(teamName);
  
  for (const [name, price] of Object.entries(outrightOdds)) {
    if (norm(name) === normTeam) {
      return price;
    }
  }

  for (const [name, price] of Object.entries(outrightOdds)) {
    const normName = norm(name);
    if (normName.includes(normTeam) || normTeam.includes(normName)) {
      return price;
    }
  }

  return null;
}

/**
 * Runs Monte Carlo simulation for a list of groups.
 * sportId: 5 (soccer), 4 (basketball)
 * oddsOverrides: Map / Object containing eventId -> { home, draw, away }
 */
export function runTournamentSimulation(groups, sportId, oddsOverrides = {}, iterations = 10000, bestThirdCount = null, outrightOdds = null) {
  const stats = {};
  for (const group of groups) {
    for (const team of group.teams) {
      stats[team] = {
        winnerCount: 0, // Finished 1st u grupi
        qualifyCount: 0, // Advanced from group stage (reached R32)
        lastCount: 0, // Finished 4th u grupi
        mostGoalsCount: 0,
        mostConcededCount: 0,
        expectedPoints: 0,
        pointsFreq: {},
        rankFreq: {},
        
        // Group stage wins/draws/goals distributions
        winsGroupFreq: {},
        drawsGroupFreq: {},
        goalsScoredGroupFreq: {},
        goalsConcededGroupFreq: {},
        
        // Group stage conditions
        noLossesCount: 0,
        scoredInAllCount: 0,
        concededInAllCount: 0,
        
        // Knockout phase counts
        tournamentWinnerCount: 0,
        reachedR16Count: 0,
        reachedQFCount: 0,
        reachedSFCount: 0,
        reachedFinalCount: 0,
        eliminatedR32Count: 0,
        eliminatedR16Count: 0,
        eliminatedQFCount: 0,
        eliminatedSFCount: 0,
        eliminatedFinalCount: 0,
        
        // Tournament goals distribution
        tournamentGoalsFreq: {}
      };
    }
  }

  const groupStats = {};
  for (const group of groups) {
    groupStats[group.name] = {
      winnerPointsFreq: {},
      lastPointsFreq: {},
      groupDrawsFreq: {},
      groupGoalsFreq: {},
      matches3PlusFreq: {},
      matches00Freq: {},
      matchesGGFreq: {},
      exactForecastFreq: {},
      topTwoFreq: {},
      any9PtsCount: 0,
      any0PtsCount: 0,
      thirdQualifyCount: 0,
      expectedGoals: 0,
      expectedDraws: 0,
      expected3Plus: 0,
      expected00: 0,
      expectedGG: 0,
      expectedWinnerPoints: 0,
      expectedLastPoints: 0
    };
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

  const isWorldCup = groups.length === 12 && sportId === 5;
  let ratings = {};
  if (isWorldCup) {
    if (outrightOdds && Object.keys(outrightOdds).length > 0) {
      for (const group of groups) {
        for (const team of group.teams) {
          const outrightOdd = findTeamOutrightOdd(team, outrightOdds);
          if (outrightOdd && outrightOdd > 1) {
            ratings[team] = 1000.0 / outrightOdd;
          } else {
            ratings[team] = 10.0;
          }
        }
      }
      for (const team in ratings) {
        if (ratings[team] < 1.0) ratings[team] = 1.0;
      }
    } else {
      ratings = computeTeamRatings(groups, sportId, oddsOverrides);
    }
  }

  // Check if we should apply the 3rd placed team qualification rules
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

    // Group simulations
    for (let groupIndex = 0; groupIndex < groupMatchProbs.length; groupIndex++) {
      const { group, matchProbs } = groupMatchProbs[groupIndex];
      const groupLetter = group.name.replace("Grupa ", "");
      const teams = group.teams;
      
      const points = {};
      const h2h = {};
      const teamGoals = {};
      const teamConceded = {};
      
      const teamWins = {};
      const teamDraws = {};
      const teamLosses = {};
      const teamScoredInAll = {};
      const teamConcededInAll = {};

      let groupTotalGoals = 0;
      let groupDrawsCount = 0;
      let group3PlusCount = 0;
      let group00Count = 0;
      let groupGGCount = 0;

      for (const team of teams) {
        points[team] = 0;
        h2h[team] = {};
        teamGoals[team] = 0;
        teamConceded[team] = 0;
        teamWins[team] = 0;
        teamDraws[team] = 0;
        teamLosses[team] = 0;
        teamScoredInAll[team] = true;
        teamConcededInAll[team] = true;
      }

      for (const item of matchProbs) {
        const { match, p1, pX, p2 } = item;
        const home = match.homeTeam;
        const away = match.awayTeam;
        const r = Math.random();

        let outcome = "";
        if (r < p1) {
          outcome = "home";
          if (sportId === 4) {
            points[home] += 2;
            points[away] += 1;
          } else {
            points[home] += 3;
          }
          h2h[home][away] = home;
          h2h[away][home] = home;
          teamWins[home]++;
          teamLosses[away]++;
        } else if (r < p1 + pX) {
          outcome = "draw";
          points[home] += 1;
          points[away] += 1;
          h2h[home][away] = "draw";
          h2h[away][home] = "draw";
          teamDraws[home]++;
          teamDraws[away]++;
        } else {
          outcome = "away";
          if (sportId === 4) {
            points[away] += 2;
            points[home] += 1;
          } else {
            points[away] += 3;
          }
          h2h[home][away] = away;
          h2h[away][home] = away;
          teamWins[away]++;
          teamLosses[home]++;
        }

        if (sportId === 5) {
          const score = sampleMatchScore(outcome);
          const homeGoals = score[0];
          const awayGoals = score[1];
          teamGoals[home] += homeGoals;
          teamGoals[away] += awayGoals;
          teamConceded[home] += awayGoals;
          teamConceded[away] += homeGoals;

          if (homeGoals === 0) teamScoredInAll[home] = false;
          if (awayGoals === 0) teamScoredInAll[away] = false;
          if (awayGoals === 0) teamConcededInAll[home] = false;
          if (homeGoals === 0) teamConcededInAll[away] = false;

          const totalGoals = homeGoals + awayGoals;
          groupTotalGoals += totalGoals;
          if (totalGoals >= 3) group3PlusCount++;
          if (homeGoals === 0 && awayGoals === 0) group00Count++;
          if (homeGoals > 0 && awayGoals > 0) groupGGCount++;
          if (outcome === "draw") groupDrawsCount++;
        }
      }

      // Sort teams to establish group standings using tie-breakers (Points, GD, GS, H2H)
      const standing = [...teams].sort((a, b) => {
        if (points[b] !== points[a]) {
          return points[b] - points[a];
        }
        if (sportId === 5) {
          const gdA = teamGoals[a] - teamConceded[a];
          const gdB = teamGoals[b] - teamConceded[b];
          if (gdB !== gdA) return gdB - gdA;
          if (teamGoals[b] !== teamGoals[a]) return teamGoals[b] - teamGoals[a];
        }
        const winner = h2h[a][b];
        if (winner === a) return -1;
        if (winner === b) return 1;
        return Math.random() - 0.5;
      });

      // Record ranks and group stats u grupi
      for (let rank = 0; rank < standing.length; rank++) {
        const team = standing[rank];
        stats[team].rankFreq[rank] = (stats[team].rankFreq[rank] || 0) + 1;
      }
      stats[standing[0]].winnerCount++;
      stats[standing[standing.length - 1]].lastCount++;

      // Record expected points sum and points frequency
      for (const team of teams) {
        const pts = points[team];
        stats[team].expectedPoints += pts;
        stats[team].pointsFreq[pts] = (stats[team].pointsFreq[pts] || 0) + 1;
        
        const wins = teamWins[team];
        const draws = teamDraws[team];
        const losses = teamLosses[team];
        const gs = teamGoals[team];
        const gc = teamConceded[team];

        stats[team].winsGroupFreq[wins] = (stats[team].winsGroupFreq[wins] || 0) + 1;
        stats[team].drawsGroupFreq[draws] = (stats[team].drawsGroupFreq[draws] || 0) + 1;
        stats[team].goalsScoredGroupFreq[gs] = (stats[team].goalsScoredGroupFreq[gs] || 0) + 1;
        stats[team].goalsConcededGroupFreq[gc] = (stats[team].goalsConcededGroupFreq[gc] || 0) + 1;

        if (losses === 0) stats[team].noLossesCount++;
        if (teamScoredInAll[team]) stats[team].scoredInAllCount++;
        if (teamConcededInAll[team]) stats[team].concededInAllCount++;
      }

      // Record group most goals/conceded
      let maxGoals = -1;
      let maxConceded = -1;
      for (const team of teams) {
        if (teamGoals[team] > maxGoals) maxGoals = teamGoals[team];
        if (teamConceded[team] > maxConceded) maxConceded = teamConceded[team];
      }
      for (const team of teams) {
        if (teamGoals[team] === maxGoals) stats[team].mostGoalsCount++;
        if (teamConceded[team] === maxConceded) stats[team].mostConcededCount++;
      }

      // Record group stats for this iteration
      const gStats = groupStats[group.name];
      const winPts = points[standing[0]];
      const lstPts = points[standing[standing.length - 1]];
      gStats.winnerPointsFreq[winPts] = (gStats.winnerPointsFreq[winPts] || 0) + 1;
      gStats.lastPointsFreq[lstPts] = (gStats.lastPointsFreq[lstPts] || 0) + 1;

      gStats.expectedWinnerPoints += winPts;
      gStats.expectedLastPoints += lstPts;

      if (sportId === 5) {
        gStats.groupDrawsFreq[groupDrawsCount] = (gStats.groupDrawsFreq[groupDrawsCount] || 0) + 1;
        gStats.groupGoalsFreq[groupTotalGoals] = (gStats.groupGoalsFreq[groupTotalGoals] || 0) + 1;
        gStats.matches3PlusFreq[group3PlusCount] = (gStats.matches3PlusFreq[group3PlusCount] || 0) + 1;
        gStats.matches00Freq[group00Count] = (gStats.matches00Freq[group00Count] || 0) + 1;
        gStats.matchesGGFreq[groupGGCount] = (gStats.matchesGGFreq[groupGGCount] || 0) + 1;

        gStats.expectedGoals += groupTotalGoals;
        gStats.expectedDraws += groupDrawsCount;
        gStats.expected3Plus += group3PlusCount;
        gStats.expected00 += group00Count;
        gStats.expectedGG += groupGGCount;
      }

      const forecastKey = `${standing[0]}|${standing[1]}`;
      gStats.exactForecastFreq[forecastKey] = (gStats.exactForecastFreq[forecastKey] || 0) + 1;

      const sortedTopTwo = [standing[0], standing[1]].sort();
      const topTwoKey = `${sortedTopTwo[0]}|${sortedTopTwo[1]}`;
      gStats.topTwoFreq[topTwoKey] = (gStats.topTwoFreq[topTwoKey] || 0) + 1;

      if (teams.some(t => points[t] === 9)) gStats.any9PtsCount++;
      if (teams.some(t => points[t] === 0)) gStats.any0PtsCount++;

      groupStandings.push({
        standing,
        points,
        teamGoals,
        teamConceded
      });

      if (bestThirdCount > 0 && standing.length >= 3) {
        thirdPlacedTeams.push({
          team: standing[2],
          group: groupLetter,
          groupIndex: groupIndex,
          points: points[standing[2]],
          gd: teamGoals[standing[2]] - teamConceded[standing[2]],
          gs: teamGoals[standing[2]]
        });
      }
    }

    // Determine who qualifies u 1/16 finala
    const qualifiedThirds = [];
    if (bestThirdCount > 0) {
      // 1. Top 2 qualify
      for (const gs of groupStandings) {
        stats[gs.standing[0]].qualifyCount++;
        if (gs.standing.length > 1) {
          stats[gs.standing[1]].qualifyCount++;
        }
      }

      // 2. Rank 3rd placed teams (Points, GD, GS)
      thirdPlacedTeams.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gs !== a.gs) return b.gs - a.gs;
        return Math.random() - 0.5;
      });

      for (let i = 0; i < bestThirdCount && i < thirdPlacedTeams.length; i++) {
        const team = thirdPlacedTeams[i].team;
        stats[team].qualifyCount++;
        qualifiedThirds.push(thirdPlacedTeams[i]);
        
        const gName = groups[thirdPlacedTeams[i].groupIndex].name;
        groupStats[gName].thirdQualifyCount++;
      }
    } else {
      // Default: top 2
      for (const gs of groupStandings) {
        stats[gs.standing[0]].qualifyCount++;
        if (gs.standing.length > 1) {
          stats[gs.standing[1]].qualifyCount++;
        }
      }
    }

    // Knockout phase simulation (Soccer World Cup 48-team only)
    if (isWorldCup) {
      const tournamentGoals = {};
      for (const group of groups) {
        for (const team of group.teams) {
          tournamentGoals[team] = groupStandings.find(gs => gs.standing.includes(team)).teamGoals[team];
        }
      }

      const thirdPlaceMatchConfigs = [
        { matchId: 74, allowed: ["A", "B", "C", "D", "F"] },
        { matchId: 77, allowed: ["C", "D", "F", "G", "H"] },
        { matchId: 81, allowed: ["B", "E", "F", "I", "J"] },
        { matchId: 82, allowed: ["A", "E", "H", "I", "J"] },
        { matchId: 79, allowed: ["C", "E", "F", "H", "I"] },
        { matchId: 80, allowed: ["E", "H", "I", "J", "K"] },
        { matchId: 85, allowed: ["E", "F", "G", "I", "J"] },
        { matchId: 87, allowed: ["D", "E", "I", "J", "L"] }
      ];

      const qualifiedGroups = qualifiedThirds.map(t => t.group).sort();
      const thirdGroupAssignment = assignThirdPlacedTeams(qualifiedGroups, thirdPlaceMatchConfigs) || (() => {
        const fallback = {};
        for (let i = 0; i < thirdPlaceMatchConfigs.length && i < qualifiedThirds.length; i++) {
          fallback[thirdPlaceMatchConfigs[i].matchId] = qualifiedThirds[i].group;
        }
        return fallback;
      })();

      const winners = {};
      const runners = {};
      const thirds = {};
      for (let i = 0; i < groupStandings.length; i++) {
        const gLetter = groups[i].name.replace("Grupa ", "");
        const standing = groupStandings[i].standing;
        winners[gLetter] = standing[0];
        runners[gLetter] = standing[1];
        thirds[gLetter] = standing[2];
      }

      const playKnockoutMatch = (teamA, teamB) => {
        const rA = ratings[teamA] || 100.0;
        const rB = ratings[teamB] || 100.0;
        const pA = rA / (rA + rB);
        
        // Simulate regular time outcome
        const drawProb = 0.28;
        const pWinRegular = (1 - drawProb) * pA;
        const pDrawRegular = drawProb;
        const rVal = Math.random();
        
        let regularOutcome = "draw";
        if (rVal < pWinRegular) regularOutcome = "home";
        else if (rVal < pWinRegular + pDrawRegular) regularOutcome = "draw";
        else regularOutcome = "away";
        
        const goals = sampleMatchScore(regularOutcome);
        tournamentGoals[teamA] += goals[0];
        tournamentGoals[teamB] += goals[1];
        
        let winner;
        if (regularOutcome === "home") {
          winner = teamA;
        } else if (regularOutcome === "away") {
          winner = teamB;
        } else {
          winner = Math.random() < pA ? teamA : teamB;
        }
        return winner;
      };

      // ─── R32 Matchups ───
      const r32Matches = [
        { id: 73, teamA: runners["A"], teamB: runners["B"] },
        { id: 74, teamA: winners["E"], teamB: thirds[thirdGroupAssignment[74]] || thirds["A"] },
        { id: 75, teamA: winners["F"], teamB: runners["C"] },
        { id: 76, teamA: winners["C"], teamB: runners["F"] },
        { id: 77, teamA: winners["I"], teamB: thirds[thirdGroupAssignment[77]] || thirds["C"] },
        { id: 78, teamA: runners["E"], teamB: runners["I"] },
        { id: 79, teamA: winners["A"], teamB: thirds[thirdGroupAssignment[79]] || thirds["E"] },
        { id: 80, teamA: winners["L"], teamB: thirds[thirdGroupAssignment[80]] || thirds["H"] },
        { id: 81, teamA: winners["D"], teamB: thirds[thirdGroupAssignment[81]] || thirds["F"] },
        { id: 82, teamA: winners["G"], teamB: thirds[thirdGroupAssignment[82]] || thirds["G"] },
        { id: 83, teamA: runners["K"], teamB: runners["L"] },
        { id: 84, teamA: winners["H"], teamB: runners["J"] },
        { id: 85, teamA: winners["B"], teamB: thirds[thirdGroupAssignment[85]] || thirds["I"] },
        { id: 86, teamA: winners["J"], teamB: runners["H"] },
        { id: 87, teamA: winners["K"], teamB: thirds[thirdGroupAssignment[87]] || thirds["J"] },
        { id: 88, teamA: runners["D"], teamB: runners["G"] }
      ];

      const r32Winners = {};
      for (const m of r32Matches) {
        const winner = playKnockoutMatch(m.teamA, m.teamB);
        const loser = winner === m.teamA ? m.teamB : m.teamA;
        r32Winners[m.id] = winner;
        stats[loser].eliminatedR32Count++;
        stats[winner].reachedR16Count++;
      }

      // ─── R16 Matchups ───
      const r16Matches = [
        { id: 89, teamA: r32Winners[74], teamB: r32Winners[77] },
        { id: 90, teamA: r32Winners[73], teamB: r32Winners[75] },
        { id: 93, teamA: r32Winners[83], teamB: r32Winners[84] },
        { id: 94, teamA: r32Winners[81], teamB: r32Winners[82] },
        { id: 91, teamA: r32Winners[76], teamB: r32Winners[78] },
        { id: 92, teamA: r32Winners[79], teamB: r32Winners[80] },
        { id: 95, teamA: r32Winners[86], teamB: r32Winners[88] },
        { id: 96, teamA: r32Winners[85], teamB: r32Winners[87] }
      ];

      const r16Winners = {};
      for (const m of r16Matches) {
        const winner = playKnockoutMatch(m.teamA, m.teamB);
        const loser = winner === m.teamA ? m.teamB : m.teamA;
        r16Winners[m.id] = winner;
        stats[loser].eliminatedR16Count++;
        stats[winner].reachedQFCount++;
      }

      // ─── QF Matchups ───
      const qfMatches = [
        { id: 97, teamA: r16Winners[89], teamB: r16Winners[90] },
        { id: 98, teamA: r16Winners[93], teamB: r16Winners[94] },
        { id: 99, teamA: r16Winners[91], teamB: r16Winners[92] },
        { id: 100, teamA: r16Winners[95], teamB: r16Winners[96] }
      ];

      const qfWinners = {};
      const qfLosers = {};
      for (const m of qfMatches) {
        const winner = playKnockoutMatch(m.teamA, m.teamB);
        const loser = winner === m.teamA ? m.teamB : m.teamA;
        qfWinners[m.id] = winner;
        qfLosers[m.id] = loser;
        stats[loser].eliminatedQFCount++;
        stats[winner].reachedSFCount++;
      }

      // ─── SF Matchups ───
      const sfMatches = [
        { id: 101, teamA: qfWinners[97], teamB: qfWinners[98] },
        { id: 102, teamA: qfWinners[99], teamB: qfWinners[100] }
      ];

      const sfWinners = {};
      const sfLosers = {};
      for (const m of sfMatches) {
        const winner = playKnockoutMatch(m.teamA, m.teamB);
        const loser = winner === m.teamA ? m.teamB : m.teamA;
        sfWinners[m.id] = winner;
        sfLosers[m.id] = loser;
        stats[winner].reachedFinalCount++;
      }

      // ─── 3RD Place Match ───
      const thirdPlaceWinner = playKnockoutMatch(sfLosers[101], sfLosers[102]);
      const thirdPlaceLoser = thirdPlaceWinner === sfLosers[101] ? sfLosers[102] : sfLosers[101];
      stats[thirdPlaceWinner].eliminatedSFCount++;
      stats[thirdPlaceLoser].eliminatedSFCount++;

      // ─── FINAL Match ───
      const tournamentWinner = playKnockoutMatch(sfWinners[101], sfWinners[102]);
      const runnerUp = tournamentWinner === sfWinners[101] ? sfWinners[102] : sfWinners[101];
      stats[tournamentWinner].tournamentWinnerCount++;
      stats[runnerUp].eliminatedFinalCount++;

      // Save tournament goals distribution
      for (const group of groups) {
        for (const team of group.teams) {
          const tg = tournamentGoals[team];
          stats[team].tournamentGoalsFreq[tg] = (stats[team].tournamentGoalsFreq[tg] || 0) + 1;
        }
      }
    }
  }

  // Normalize final results
  const teamResults = {};
  for (const group of groups) {
    for (const team of group.teams) {
      const teamStats = stats[team];
      
      const pointsDistribution = {};
      const maxPoints = sportId === 4 ? 6 : 9;
      for (let pts = 0; pts <= maxPoints; pts++) {
        pointsDistribution[pts] = (teamStats.pointsFreq[pts] || 0) / iterations;
      }

      const rankDistribution = {};
      for (let r = 0; r < group.teams.length; r++) {
        rankDistribution[r] = (teamStats.rankFreq[r] || 0) / iterations;
      }

      const winsGroupDistribution = {};
      const drawsGroupDistribution = {};
      for (let i = 0; i <= 3; i++) {
        winsGroupDistribution[i] = (teamStats.winsGroupFreq[i] || 0) / iterations;
        drawsGroupDistribution[i] = (teamStats.drawsGroupFreq[i] || 0) / iterations;
      }

      const goalsScoredGroupDistribution = {};
      const goalsConcededGroupDistribution = {};
      for (let i = 0; i <= 20; i++) {
        goalsScoredGroupDistribution[i] = (teamStats.goalsScoredGroupFreq[i] || 0) / iterations;
        goalsConcededGroupDistribution[i] = (teamStats.goalsConcededGroupFreq[i] || 0) / iterations;
      }

      const totalGoalsTournamentDistribution = {};
      for (let i = 0; i <= 35; i++) {
        totalGoalsTournamentDistribution[i] = (teamStats.tournamentGoalsFreq[i] || 0) / iterations;
      }

      teamResults[team] = {
        pWinner: teamStats.winnerCount / iterations,
        pQualify: teamStats.qualifyCount / iterations,
        pLast: teamStats.lastCount / iterations,
        pMostGoals: (teamStats.mostGoalsCount || 0) / iterations,
        pMostConceded: (teamStats.mostConcededCount || 0) / iterations,
        expectedPoints: teamStats.expectedPoints / iterations,
        pointsDistribution,
        
        // 1st, 2nd, 3rd, 4th place u grupi
        p1stPlace: rankDistribution[0] || 0,
        p2ndPlace: rankDistribution[1] || 0,
        p3rdPlace: rankDistribution[2] || 0,
        p4thPlace: rankDistribution[3] || 0,
        
        // Group stage conditions
        noLossesGroup: teamStats.noLossesCount / iterations,
        scoredInAllGroup: teamStats.scoredInAllCount / iterations,
        concededInAllGroup: teamStats.concededInAllCount / iterations,
        
        // Distributions
        winsGroupDistribution,
        drawsGroupDistribution,
        goalsScoredGroupDistribution,
        goalsConcededGroupDistribution,
        totalGoalsTournamentDistribution,

        // Knockout phase probabilities
        pTournamentWinner: teamStats.tournamentWinnerCount / iterations,
        pReachesR32: teamStats.qualifyCount / iterations,
        pReachesR16: teamStats.reachedR16Count / iterations,
        pReachesQF: teamStats.reachedQFCount / iterations,
        pReachesSF: teamStats.reachedSFCount / iterations,
        pReachesFinal: teamStats.reachedFinalCount / iterations,
        pEliminatedR32: teamStats.eliminatedR32Count / iterations,
        pEliminatedR16: teamStats.eliminatedR16Count / iterations,
        pEliminatedQF: teamStats.eliminatedQFCount / iterations,
        pEliminatedSF: teamStats.eliminatedSFCount / iterations,
        pEliminatedFinal: teamStats.eliminatedFinalCount / iterations
      };
    }
  }

  const groupResults = {};
  for (const group of groups) {
    const name = group.name;
    const gStats = groupStats[name];

    const exactForecast = {};
    for (const k of Object.keys(gStats.exactForecastFreq)) {
      exactForecast[k] = gStats.exactForecastFreq[k] / iterations;
    }

    const topTwo = {};
    for (const k of Object.keys(gStats.topTwoFreq)) {
      topTwo[k] = gStats.topTwoFreq[k] / iterations;
    }

    groupResults[name] = {
      exactForecast,
      topTwo,
      pAny9Pts: gStats.any9PtsCount / iterations,
      pAny0Pts: gStats.any0PtsCount / iterations,
      pThirdQualifies: gStats.thirdQualifyCount / iterations,
      expectedGoals: gStats.expectedGoals / iterations,
      expectedDraws: gStats.expectedDraws / iterations,
      expected3Plus: gStats.expected3Plus / iterations,
      expected00: gStats.expected00 / iterations,
      expectedGG: gStats.expectedGG / iterations,
      expectedWinnerPoints: gStats.expectedWinnerPoints / iterations,
      expectedLastPoints: gStats.expectedLastPoints / iterations,
      
      goalsDistribution: normalizeFreq(gStats.groupGoalsFreq, iterations),
      drawsDistribution: normalizeFreq(gStats.groupDrawsFreq, iterations),
      matches3PlusDistribution: normalizeFreq(gStats.matches3PlusFreq, iterations),
      matches00Distribution: normalizeFreq(gStats.matches00Freq, iterations),
      matchesGGDistribution: normalizeFreq(gStats.matchesGGFreq, iterations),
      winnerPointsDistribution: normalizeFreq(gStats.winnerPointsFreq, iterations),
      lastPointsDistribution: normalizeFreq(gStats.lastPointsFreq, iterations)
    };
  }

  return { teamResults, groupResults };
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
export function calculateOddsForGroup(group, teamResults, groupResults, outrightMultiplier, ouMultiplier) {
  const teamOdds = {};
  
  const makeOutrightPrice = (prob) => {
    if (prob <= 0.0001) return 999.00;
    const fairOdds = 1 / prob;
    return Number((fairOdds * outrightMultiplier).toFixed(2));
  };

  const makeOuPrice = (prob) => {
    if (prob <= 0.0001) return 999.00;
    const fairOdds = 1 / prob;
    return Number((fairOdds * ouMultiplier).toFixed(2));
  };

  for (const team of group.teams) {
    const res = teamResults[team];
    if (!res) continue;

    const winnerOdds = makeOutrightPrice(res.pWinner);
    const qualifyOdds = makeOutrightPrice(res.pQualify);
    const lastOdds = makeOutrightPrice(res.pLast);
    const mostGoalsOdds = makeOutrightPrice(res.pMostGoals);

    // Calculate Points line (closest half-integer)
    const exp = res.expectedPoints;
    const line = Math.floor(exp) + 0.5;

    // Sum probabilities below and above the line
    let pUnder = 0;
    let pOver = 0;

    for (const [ptsStr, prob] of Object.entries(res.pointsDistribution || {})) {
      const pts = Number(ptsStr);
      if (pts < line) {
        pUnder += prob;
      } else {
        pOver += prob;
      }
    }

    const underOdds = makeOuPrice(pUnder);
    const overOdds = makeOuPrice(pOver);

    teamOdds[team] = {
      winnerOdds,
      qualifyOdds,
      lastOdds,
      mostGoalsOdds,
      line,
      underOdds,
      overOdds,
      expectedPoints: res.expectedPoints
    };
  }

  let groupOdds = null;
  const gRes = groupResults ? groupResults[group.name] : null;
  if (gRes) {
    groupOdds = {};

    groupOdds.exactForecast = {};
    for (const [k, prob] of Object.entries(gRes.exactForecast || {})) {
      groupOdds.exactForecast[k] = makeOutrightPrice(prob);
    }

    groupOdds.topTwo = {};
    for (const [k, prob] of Object.entries(gRes.topTwo || {})) {
      groupOdds.topTwo[k] = makeOutrightPrice(prob);
    }

    groupOdds.any9PtsOdds = makeOutrightPrice(gRes.pAny9Pts);
    groupOdds.any0PtsOdds = makeOutrightPrice(gRes.pAny0Pts);
    groupOdds.thirdQualifiesOdds = makeOutrightPrice(gRes.pThirdQualifies);

    const calculateLineOdds = (expectedValue, distribution) => {
      const line = Math.floor(expectedValue) + 0.5;
      let pUnder = 0;
      let pOver = 0;
      for (const [valStr, prob] of Object.entries(distribution || {})) {
        const val = Number(valStr);
        if (val < line) pUnder += prob;
        else pOver += prob;
      }
      return {
        line,
        underOdds: makeOuPrice(pUnder),
        overOdds: makeOuPrice(pOver)
      };
    };

    const getOverUnderOdds = (line, distribution) => {
      let pUnder = 0;
      let pOver = 0;
      for (const [valStr, prob] of Object.entries(distribution || {})) {
        const val = Number(valStr);
        if (val < line) pUnder += prob;
        else pOver += prob;
      }
      return { underOdds: makeOuPrice(pUnder), overOdds: makeOuPrice(pOver) };
    };

    const expGoals = gRes.expectedGoals;
    const line2 = Math.floor(expGoals) + 0.5;
    const line1 = line2 - 1.0;
    const line3 = line2 + 1.0;

    groupOdds.totalGoals = {
      line1,
      odds1: getOverUnderOdds(line1, gRes.goalsDistribution),
      line2,
      odds2: getOverUnderOdds(line2, gRes.goalsDistribution),
      line3,
      odds3: getOverUnderOdds(line3, gRes.goalsDistribution)
    };

    groupOdds.totalDraws = calculateLineOdds(gRes.expectedDraws, gRes.drawsDistribution);
    groupOdds.matches3Plus = calculateLineOdds(gRes.expected3Plus, gRes.matches3PlusDistribution);
    groupOdds.matches00 = calculateLineOdds(gRes.expected00, gRes.matches00Distribution);
    groupOdds.matchesGG = calculateLineOdds(gRes.expectedGG, gRes.matchesGGDistribution);
    groupOdds.winnerPoints = calculateLineOdds(gRes.expectedWinnerPoints, gRes.winnerPointsDistribution);
    groupOdds.lastPoints = calculateLineOdds(gRes.expectedLastPoints, gRes.lastPointsDistribution);
  }

  return { teamOdds, groupOdds };
}
