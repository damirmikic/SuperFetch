export const CSV_COLUMNS = ["Datum", "Vreme", "Sifra", "Domacin", "Gost", "1", "X", "2", "GR", "U", "O", "Yes", "No"];

export function buildSingleOddCsvRow({ event, marketName, odd }) {
  const mapped = mapOddToCsvMarket({ marketName }, odd);
  if (!mapped) return "";
  const { date, time } = formatEventDateTime(event.matchDate);
  return formatCsvRow([date, time, "", mapped.market, mapped.answer, formatPrice(odd.price), "", "", "", "", "", "", ""]);
}

/**
 * Build a full specijali block (headers + row) for one odd from a combo market.
 * MATCH_NAME: Specijali, LEAGUE_NAME: <home> - <away> (or matchName)
 */
export function buildSpecijaliBlock({ event, marketName, odd }) {
  const row = buildSpecijalRow({ event, marketName, odd });
  if (!row) return "";
  const eventName = formatMatchName(event);
  return [
    formatCsvRow([`MATCH_NAME:Specijal`]),
    formatCsvRow([`LEAGUE_NAME:${eventName}`]),
    row
  ].join("\r\n");
}

/**
 * Build a single CSV row for an entire statistika market.
 * Maps Under → U column, Over → O column; extracts the line value from odd names.
 */
export function buildStatistikaMarketCsvRow({ event, market }) {
  const { date, time } = formatEventDateTime(event.matchDate);
  const marketName = String(market.marketName).trim();
  if (!marketName) return "";

  const marketNorm = normalizeSearchText(marketName);
  const isSpecialYesNo = (marketNorm.includes("oba tima") || marketNorm.includes("svaki tim"))
    && marketNorm.includes("vise od")
    && (marketNorm.includes("karton") || marketNorm.includes("sutev") && marketNorm.includes("okvir") || marketNorm.includes("korner"));

  if (isSpecialYesNo) {
    const selectedOdd = market.odds.find((odd) => /\b(da|yes)\b/i.test(String(odd.name))) || market.odds[0];
    const lineMatch = selectedOdd && String(selectedOdd.name).match(/(?:više od|vise od|over)\s*(\d+(?:[.,]\d+)?)/i);
    const boundaryLabel = lineMatch ? lineMatch[1].replace(",", ".") : "";

    let formattedMarketName = toAsciiMarketName(marketName)
      .replace(/\s*[-–]\s*(da|yes)\s*$/i, "")
      .trim();

    if (boundaryLabel) {
      formattedMarketName = formattedMarketName.replace(/\bX\b/, boundaryLabel);
    }

    const answer = selectedOdd && /\b(da|yes)\b/i.test(String(selectedOdd.name))
      ? "DA"
      : toAsciiMarketName(String(selectedOdd?.name || "DA").trim());

    return formatCsvRow([date, time, "", formattedMarketName, answer, formatPrice(selectedOdd?.price), "", "", "", "", "", "", ""]);
  }

  let line = "";
  let underPrice = "";
  let overPrice = "";

  for (const odd of market.odds) {
    const norm = normalizeSearchText(odd.name);
    if (!line) {
      const m = String(odd.name).match(/(\d+(?:[.,]\d+)?)/);
      if (m) line = m[1].replace(",", ".");
    }
    if (norm.includes("manje") || norm.includes("under")) {
      underPrice = formatPrice(odd.price);
    } else if (norm.includes("vise") || norm.includes("over")) {
      overPrice = formatPrice(odd.price);
    }
  }

  const dashIdx = marketName.indexOf(" - ");
  const domacin = dashIdx !== -1
    ? toAsciiMarketName(marketName.slice(0, dashIdx).trim())
    : toAsciiMarketName(marketName);
  const gost = dashIdx !== -1 ? toAsciiMarketName(marketName.slice(dashIdx + 3).trim()) : "";

  return formatCsvRow([date, time, "", domacin, gost, "", "", "", line, underPrice, overPrice, "", ""]);
}

/**
 * Build a single CSV data row for a specijali odd (no header lines).
 */
export function buildSpecijalRow({ event, marketName, odd }) {
  const oddNameLower = String(odd.name).toLowerCase().trim();
  if (oddNameLower === "ne" || oddNameLower === "no") return "";

  const { date, time } = formatEventDateTime(event.matchDate);
  const market = toAsciiMarketName(String(marketName).trim());
  const rawAnswer = toAsciiMarketName(String(odd.name).trim());
  let answer = rawAnswer && rawAnswer !== market ? rawAnswer : "DA";

  const marketNorm = normalizeSearchText(marketName);
  if (
    (marketNorm.includes("osvaja tacno") && marketNorm.includes("set")) ||
    marketNorm.includes("barem jedan set sa nulom")
  ) {
    const ansLower = String(answer).toLowerCase();
    if (ansLower === "da" || ansLower === "yes") {
      answer = "";
    }
  }

  if (!market) return "";
  return formatCsvRow([date, time, "", market, answer, formatPrice(odd.price), "", "", "", "", "", "", ""]);
}

function formatMatchName(event) {
  if (event.homeTeam && event.awayTeam) return `${event.homeTeam} - ${event.awayTeam}`;
  return event.matchName || "";
}

export function generatePlayerBlock({ event, markets, playerName }) {
  const rows = [];
  const playerRows = buildPlayerRows({ event, markets, playerName });
  if (!playerRows.length) return "";
  rows.push([`MATCH_NAME:${getPlayerTeamName(playerName, markets, event)}`]);
  rows.push([`LEAGUE_NAME:${formatPlayerName(playerName)}`]);
  rows.push(...playerRows);
  return rows.map(formatCsvRow).join("\r\n");
}

export function generateOddsCsv({ event, markets, player }) {
  const players = player ? [player] : extractPlayersFromMarkets(markets);
  const rows = [CSV_COLUMNS];

  for (const playerName of players) {
    const playerRows = buildPlayerRows({ event, markets, playerName });

    if (!playerRows.length) {
      continue;
    }

    rows.push([`MATCH_NAME:${getPlayerTeamName(playerName, markets, event)}`]);
    rows.push([`LEAGUE_NAME:${formatPlayerName(playerName)}`]);
    rows.push(...playerRows);
  }

  return rows.map(formatCsvRow).join("\r\n");
}

export function countCsvRows(csv) {
  return csv.split(/\r?\n/).filter((row) => row.trim()).length;
}

/**
 * Remove a player-prop data row. Cleans up the owning LEAGUE_NAME: line when
 * that player's block becomes empty, and removes the single MATCH_NAME: header
 * only when no LEAGUE_NAME lines remain at all.
 */
export function removePlayerOddFromCsv(csv, rowToRemove) {
  if (!rowToRemove || !csv) return csv;

  const lines = csv.split(/\r?\n/);
  const idx = lines.indexOf(rowToRemove);
  if (idx === -1) return csv;

  lines.splice(idx, 1);

  // Walk back to find the owning LEAGUE_NAME: header
  let leagueStart = -1;
  for (let i = Math.min(idx - 1, lines.length - 1); i >= 0; i--) {
    if (lines[i].startsWith("LEAGUE_NAME:")) { leagueStart = i; break; }
    if (lines[i].startsWith("MATCH_NAME:")) break;
  }

  if (leagueStart !== -1) {
    // Player block ends at next LEAGUE_NAME/MATCH_NAME or EOF
    let blockEnd = lines.length;
    for (let i = leagueStart + 1; i < lines.length; i++) {
      if (lines[i].startsWith("LEAGUE_NAME:") || lines[i].startsWith("MATCH_NAME:")) {
        blockEnd = i;
        break;
      }
    }

    const dataRows = lines.slice(leagueStart + 1, blockEnd).filter((l) => l.trim());
    if (dataRows.length === 0) {
      lines.splice(leagueStart, 1);

      // If no LEAGUE_NAME lines remain, remove the MATCH_NAME header too
      if (!lines.some((l) => l.startsWith("LEAGUE_NAME:"))) {
        const matchIdx = lines.findIndex((l) => l.startsWith("MATCH_NAME:"));
        if (matchIdx !== -1) lines.splice(matchIdx, 1);
      }
    }
  }

  return lines.filter((l) => l.trim()).join("\r\n");
}

/**
 * Replace one data row (exact string match) with another in a CSV string.
 */
export function replaceCsvRow(csv, oldRow, newRow) {
  if (!oldRow || !csv) return csv;
  const lines = csv.split(/\r?\n/);
  const idx = lines.indexOf(oldRow);
  if (idx === -1) return csv;
  lines[idx] = newRow;
  return lines.join("\r\n");
}

/**
 * Remove a single data row (exact string match) from a CSV string.
 */
export function removeCsvRow(csv, rowToRemove) {
  if (!rowToRemove || !csv) return csv;
  const lines = csv.split(/\r?\n/);
  const idx = lines.indexOf(rowToRemove);
  if (idx === -1) return csv;
  lines.splice(idx, 1);
  return lines.filter((l) => l.trim()).join("\r\n");
}

/**
 * Remove a specijali data row from the CSV string.
 * If the surrounding MATCH_NAME:Specijali block becomes empty after removal,
 * the two orphaned header lines (MATCH_NAME + LEAGUE_NAME) are also stripped.
 */
export function removeSpecijalRowFromCsv(csv, rowToRemove) {
  if (!rowToRemove || !csv) return csv;

  const lines = csv.split(/\r?\n/);
  const idx = lines.indexOf(rowToRemove);
  if (idx === -1) return csv;

  // Remove the target data row
  lines.splice(idx, 1);

  // Walk backwards from the (now-shifted) position to find the owning MATCH_NAME:Specijali header
  let matchStart = -1;
  for (let i = Math.min(idx - 1, lines.length - 1); i >= 0; i--) {
    if (lines[i].startsWith("MATCH_NAME:Specijal")) {
      matchStart = i;
      break;
    }
    if (lines[i].startsWith("MATCH_NAME:")) break;
  }

  if (matchStart !== -1) {
    // Find where this block ends (next MATCH_NAME or EOF)
    let blockEnd = lines.length;
    for (let i = matchStart + 1; i < lines.length; i++) {
      if (lines[i].startsWith("MATCH_NAME:")) { blockEnd = i; break; }
    }

    // Data rows are everything after the two header lines (MATCH_NAME + LEAGUE_NAME)
    const dataRows = lines.slice(matchStart + 2, blockEnd).filter((l) => l.trim());

    if (dataRows.length === 0) {
      // Orphaned block — remove the two header lines
      lines.splice(matchStart, 2);
    }
  }

  const result = lines.filter((l) => l.trim()).join("\r\n");
  return result;
}

export function makeCsvFilename(event, player) {
  const subject = player || event.awayTeam || event.matchName || "odds";
  return `${slugify(subject)}_odds.csv`;
}

function buildPlayerRows({ event, markets, playerName }) {
  const rows = [];
  const seen = new Set();
  const { date, time } = formatEventDateTime(event.matchDate);
  const normalizedPlayer = normalizeSearchText(playerName);

  for (const market of markets) {
    for (const odd of market.odds) {
      const searchable = normalizeSearchText(`${market.marketName} ${odd.name} ${odd.playerName}`);

      if (!searchable.includes(normalizedPlayer)) {
        continue;
      }

      const mapped = mapOddToCsvMarket(market, odd);

      if (!mapped) {
        continue;
      }

      const key = `${mapped.market}|${mapped.answer}|${odd.price}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      rows.push([
        date,
        time,
        "",
        mapped.market,
        mapped.answer,
        formatPrice(odd.price),
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ]);
    }
  }

  return sortPlayerRows(rows);
}

function stripPlayerPrefix(name) {
  return String(name)
    .replace(/^Igra[čc]\s*[-–]\s*/i, "")
    .replace(/^Igra[čc]\s+/i, "")
    .trim();
}

function toAsciiMarketName(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D");
}

export function mapOddToCsvMarket(market, odd) {
  const mkt = normalizeSearchText(market.marketName);
  const name = toAsciiMarketName(stripPlayerPrefix(market.marketName));
  const answer = extractLineOrNull(odd.name) ?? extractLineOrNull(odd.specialBetValue ?? "") ?? "DA";

  // Basketball player markets
  if (mkt.includes("poen") && mkt.includes("asistencij") && mkt.includes("skok")) return { market: "poeni+skokovi+asistencije", answer };
  if (mkt.includes("poen") && mkt.includes("asistencij")) return { market: "poeni+asistencije", answer };
  if (mkt.includes("poen") && mkt.includes("skok")) return { market: "poeni+skokovi", answer };
  if (mkt.includes("ukupno poena igraca")) return { market: "poeni", answer };
  if (mkt.includes("ukupno asistencija igraca")) return { market: "asistencije", answer };
  if (mkt.includes("ukupno skokova igraca")) return { market: "skokovi", answer };
  if (mkt.includes("pogodaka za 3 poena") || mkt.includes("3 poena igraca")) return { market: "trojke", answer };
  if (mkt.includes("najbolji strelac")) return { market: "najbolji strelac", answer };

  // Football player markets
  if (mkt.includes("2 ili vise")) return { market: name, answer };
  if (mkt.includes("postize") && mkt.includes("poluvrem")) return { market: name, answer };
  if (mkt.includes("postize") && mkt.includes("glav")) return { market: name, answer };
  if (mkt.includes("postize")) return { market: name, answer };
  if (mkt.includes("crveni") && mkt.includes("karton")) return { market: name, answer };
  if (mkt.includes("karton")) return { market: name, answer };
  if (mkt.includes("gol") && mkt.includes("ili") && mkt.includes("asistir")) return { market: "gol ili asistencija", answer: "DA" };
  if (mkt.includes("gol") && mkt.includes("asistir")) return { market: "gol i asistencija", answer: "DA" };
  if (mkt.includes("ukupan") && mkt.includes("asistencij")) return { market: "asistencija", answer };
  if (mkt.includes("asistencij")) return { market: name, answer };
  if ((mkt.includes("ukupan") || mkt.includes("ukupno")) && mkt.includes("sutev") && mkt.includes("okvir")) return { market: "sutevi u okvir gola", answer };
  if (mkt.includes("ukupno") && mkt.includes("sutev") && !mkt.includes("okvir")) return { market: name, answer };
  if (mkt.includes("faul") && mkt.includes("nacinjenih")) return { market: "ukupno nacinjenih faulova", answer };
  if (mkt.includes("faul") && mkt.includes("nad") && mkt.includes("igrac")) return { market: "uk. faulova nad igracem", answer };
  if (mkt.includes("faul") && mkt.includes("nad")) return { market: name, answer };
  if (mkt.includes("faul")) return { market: name, answer };
  if (mkt.includes("ofsajd")) return { market: name, answer };

  // Tennis player markets
  if (mkt.includes("asova") || mkt.includes("aseva")) {
    if (mkt.includes("asova + duplih")) return { market: "asovi+duple greske", answer };
    return { market: "asovi", answer };
  }
  if (mkt.includes("duplih gresaka")) return { market: "duple greske", answer };
  if (mkt.includes("brejkova")) return { market: "brejkovi", answer };
  if (mkt.includes("osvojenih poena")) {
    if (mkt.includes("servis") || mkt.includes("servisu")) {
      if (mkt.includes("1. servis")) return { market: "poeni na 1. servisu", answer };
      if (mkt.includes("2. servis")) return { market: "poeni na 2. servisu", answer };
      return { market: "poeni na servisu", answer };
    }
    return { market: "poeni", answer };
  }
  if (mkt.includes("servis gresaka")) return { market: "servis greske", answer };
  if (mkt.includes("uspesnih 1. servisa")) return { market: "uspesni 1. servisi", answer };

  return null;
}

function sortPlayerRows(rows) {
  const priority = (marketName) => {
    const n = normalizeSearchText(marketName);
    if (n === "poeni") return 20;
    if (n === "skokovi") return 21;
    if (n === "asistencije") return 22;
    if (n === "trojke") return 23;
    if (n === "poeni+asistencije") return 24;
    if (n === "poeni+skokovi") return 25;
    if (n === "poeni+skokovi+asistencije") return 26;
    if (n === "najbolji strelac") return 27;

    if (n === "asovi") return 30;
    if (n === "duple greske") return 31;
    if (n === "brejkovi") return 32;
    if (n === "asovi+duple greske") return 33;
    if (n === "poeni na servisu") return 34;
    if (n === "poeni na 1. servisu") return 35;
    if (n === "poeni na 2. servisu") return 36;
    if (n === "servis greske") return 37;
    if (n === "uspesni 1. servisi") return 38;

    if (n.includes("postize") && n.includes("2")) return 1;
    if (n.includes("postize") && n.includes("glav")) return 2;
    if (n.includes("postize") && n.includes("poluvrem")) return 3;
    if (n.includes("postize")) return 0;
    if (n.includes("asistencij")) return 4;
    if (n.includes("gol") && n.includes("ili") && n.includes("asistir")) return 5;
    if (n.includes("gol") && n.includes("asistir")) return 6;
    if (n.includes("sutev") && n.includes("okvir")) return 7;
    if (n.includes("sutev")) return 8;
    if (n.includes("faul") && n.includes("nad")) return 10;
    if (n.includes("faul")) return 9;
    if (n.includes("ofsajd")) return 11;
    if (n.includes("crveni") && n.includes("karton")) return 13;
    if (n.includes("karton")) return 12;
    return 99;
  };

  return rows.sort((a, b) => {
    const pa = priority(a[3]);
    const pb = priority(b[3]);
    return pa - pb || String(a[4]).localeCompare(String(b[4]));
  });
}

function extractPlayersFromMarkets(markets) {
  const players = new Map();

  for (const market of markets) {
    for (const odd of market.odds) {
      if (!odd.playerName) {
        continue;
      }

      const normalized = normalizeSearchText(odd.playerName);
      players.set(normalized, odd.playerName);
    }
  }

  return Array.from(players.values()).sort((a, b) => a.localeCompare(b));
}

function getPlayerTeamName(playerName, markets, event) {
  const normalizedPlayer = normalizeSearchText(playerName);

  for (const market of markets) {
    for (const odd of market.odds) {
      if (normalizeSearchText(odd.playerName) !== normalizedPlayer) {
        continue;
      }

      if (odd.playerTeam === "home") {
        return event.homeTeam || event.matchName;
      }

      if (odd.playerTeam === "away") {
        return event.awayTeam || event.matchName;
      }
    }
  }

  return event.awayTeam || event.homeTeam || event.matchName;
}

export function extractLineOrNull(text) {
  const plus = String(text).match(/(\d+(?:[.,]\d+)?)\s*\+/);
  if (plus) return `${plus[1].replace(",", ".")}+`;
  
  const over = String(text).match(/(?:više od|vise od|vise|više|over)\s*(\d+(?:[.,]\d+)?)/i);
  if (over) {
    const val = parseFloat(over[1].replace(",", "."));
    return `${Math.floor(val) + 1}+`;
  }
  
  const under = String(text).match(/(?:manje od|manje|under)\s*(\d+(?:[.,]\d+)?)/i);
  if (under) {
    const val = parseFloat(under[1].replace(",", "."));
    return `${Math.floor(val)}-`;
  }
  
  return null;
}

function formatEventDateTime(value) {
  const date = value ? new Date(value.replace(" ", "T") + "Z") : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  const parts = new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(safeDate);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";

  return {
    date: `${get("day")}.${get("month")}.${get("year")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

function formatPrice(price) {
  return Number.isFinite(price) ? price.toFixed(2) : "";
}

function formatPlayerName(value) {
  const parts = String(value).split(",").map((part) => part.trim()).filter(Boolean);

  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  return String(value);
}

function formatCsvRow(row) {
  return CSV_COLUMNS.map((_, index) => escapeCsvValue(row[index] ?? "")).join(",");
}

function escapeCsvValue(value) {
  const text = String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ä‘/g, "d")
    .replace(/Ä/g, "d");
}

function slugify(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "odds";
}

/**
 * Builds a Specijal outright CSV block for a group market (Winner, Qualify, Last).
 */
export function buildGroupOutrightCsvBlock({ groupName, marketTitle, teams, oddsMap, oddsField, eventDate }) {
  const { date, time } = formatEventDateTime(eventDate);
  const rows = [
    formatCsvRow([`MATCH_NAME:Specijal`]),
    formatCsvRow([`LEAGUE_NAME:${marketTitle} ${toAsciiMarketName(groupName)}`])
  ];

  for (const team of teams) {
    const price = oddsMap[team][oddsField];
    rows.push(formatCsvRow([
      date,
      time,
      "",
      toAsciiMarketName(team),
      "DA",
      formatPrice(price),
      "", "", "", "", "", "", ""
    ]));
  }

  return rows.join("\r\n");
}

/**
 * Builds Statistika CSV rows for the team points Over/Under markets in a group.
 */
export function buildGroupPointsCsvRows({ groupName, teams, oddsMap, eventDate }) {
  const { date, time } = formatEventDateTime(eventDate);
  const rows = [];

  for (const team of teams) {
    const o = oddsMap[team];
    const domacin = `Ukupno bodova - ${toAsciiMarketName(team)}`;
    const gost = toAsciiMarketName(groupName);

    rows.push(formatCsvRow([
      date,
      time,
      "",
      domacin,
      gost,
      "",
      "",
      "",
      formatPrice(o.line),
      formatPrice(o.underOdds),
      formatPrice(o.overOdds),
      "",
      ""
    ]));
  }

  return rows.join("\r\n");
}

/**
 * Builds a comprehensive CSV block containing all group outrights, forecast, top 2, and Over/Under markets.
 */
export function buildFullGroupSimulationCsv({ group, teamOdds, groupOdds, eventDate, competitionName, startSifra = 50049 }) {
  const { date, time } = formatEventDateTime(eventDate);
  const groupLetter = group.name.replace("Grupa ", "");
  
  let currentSifra = Number.isInteger(startSifra) ? startSifra : 50049;
  const rows = [];
  
  // MATCH_NAME: World Cup 2026
  const compName = competitionName || "World Cup 2026";
  rows.push(formatCsvRow([`MATCH_NAME:${compName}`]));
  // LEAGUE_NAME: Grupa A
  rows.push(formatCsvRow([`LEAGUE_NAME:${group.name}`]));

  // Helper to build a single outright row
  const makeOutrightRow = (domacin, gost, price) => {
    const sifraStr = currentSifra.toString();
    currentSifra++;
    return formatCsvRow([
      date,
      time,
      sifraStr,
      toAsciiMarketName(domacin),
      toAsciiMarketName(gost),
      formatPrice(price),
      "", "", "", "", "", "", ""
    ]);
  };

  // Helper to build a single statistika O/U row
  const makeStatistikaRow = (domacin, gost, line, underPrice, overPrice) => {
    const sifraStr = currentSifra.toString();
    currentSifra++;
    return formatCsvRow([
      date,
      time,
      sifraStr,
      toAsciiMarketName(domacin),
      toAsciiMarketName(gost),
      "",
      "",
      "",
      formatPrice(line),
      formatPrice(underPrice),
      formatPrice(overPrice),
      "",
      ""
    ]);
  };

  // 1. Pobednik grupe (one row for each team, in original team order)
  for (const team of group.teams) {
    const price = teamOdds[team].winnerOdds;
    rows.push(makeOutrightRow(team, "Pobednik grupe", price));
  }

  // 2. Tacan poredak (sorted by price ascending)
  if (groupOdds && groupOdds.exactForecast) {
    const forecastList = [];
    for (const t1 of group.teams) {
      for (const t2 of group.teams) {
        if (t1 === t2) continue;
        const key = `${t1}|${t2}`;
        const price = groupOdds.exactForecast[key] ?? 999.00;
        forecastList.push({ domacin: `${t1}/${t2}`, gost: "Tacan poredak", price });
      }
    }
    // Sort by price ascending
    forecastList.sort((a, b) => a.price - b.price);
    for (const item of forecastList) {
      rows.push(makeOutrightRow(item.domacin, item.gost, item.price));
    }
  }

  // 3. Prva dva u grupi (sorted by price ascending)
  if (groupOdds && groupOdds.topTwo) {
    const topTwoList = [];
    const sortedTeams = [...group.teams].sort();
    for (let i = 0; i < sortedTeams.length; i++) {
      for (let j = i + 1; j < sortedTeams.length; j++) {
        const t1 = sortedTeams[i];
        const t2 = sortedTeams[j];
        const key = `${t1}|${t2}`;
        const price = groupOdds.topTwo[key] ?? 999.00;
        topTwoList.push({ domacin: `${t1}/${t2}`, gost: "Prva dva u grupi", price });
      }
    }
    // Sort by price ascending
    topTwoList.sort((a, b) => a.price - b.price);
    for (const item of topTwoList) {
      rows.push(makeOutrightRow(item.domacin, item.gost, item.price));
    }
  }

  // 4. Bilo koji tim 9 bodova, 0 bodova, Trece mesto ide dalje
  if (groupOdds) {
    rows.push(makeOutrightRow("Bilo koji tim", "9 bodova", groupOdds.any9PtsOdds));
    rows.push(makeOutrightRow("Bilo koji tim", "0 bodova", groupOdds.any0PtsOdds));
    rows.push(makeOutrightRow("Trece mesto", "ide dalje", groupOdds.thirdQualifiesOdds));
  }

  // 5. Statistika (Over/Under) rows
  // NOTE: According to the requested structure image, the individual team points (e.g. "Ukupno bodova - <team>")
  // are NOT included in the group CSV. So we omit them here.
  if (groupOdds) {
    if (groupOdds.totalGoals) {
      const tg = groupOdds.totalGoals;
      rows.push(makeStatistikaRow("Ukupno golova1", `u grupi ${groupLetter}`, tg.line1, tg.odds1.underOdds, tg.odds1.overOdds));
      rows.push(makeStatistikaRow("Ukupno golova2", `u grupi ${groupLetter}`, tg.line2, tg.odds2.underOdds, tg.odds2.overOdds));
      rows.push(makeStatistikaRow("Ukupno golova3", `u grupi ${groupLetter}`, tg.line3, tg.odds3.underOdds, tg.odds3.overOdds));
    }

    if (groupOdds.totalDraws) {
      const td = groupOdds.totalDraws;
      rows.push(makeStatistikaRow("Ukupno neresenih", `u grupi ${groupLetter}`, td.line, td.underOdds, td.overOdds));
    }

    if (groupOdds.matches3Plus) {
      const m3 = groupOdds.matches3Plus;
      rows.push(makeStatistikaRow("Broj meceva", "3+ golova", m3.line, m3.underOdds, m3.overOdds));
    }
    if (groupOdds.matches00) {
      const m00 = groupOdds.matches00;
      rows.push(makeStatistikaRow("Broj meceva", "0-0", m00.line, m00.underOdds, m00.overOdds));
    }
    if (groupOdds.matchesGG) {
      const mGG = groupOdds.matchesGG;
      rows.push(makeStatistikaRow("Broj meceva", "GG", mGG.line, mGG.underOdds, mGG.overOdds));
    }

    if (groupOdds.winnerPoints) {
      const wp = groupOdds.winnerPoints;
      rows.push(makeStatistikaRow("Uk. bodova", "Prvoplasirani tim", wp.line, wp.underOdds, wp.overOdds));
    }
    if (groupOdds.lastPoints) {
      const lp = groupOdds.lastPoints;
      rows.push(makeStatistikaRow("Uk. bodova", "Poslednjeplasiran tim", lp.line, lp.underOdds, lp.overOdds));
    }
  }

  // 6. Najefikasniji tim u grupi (one row for each team in original team order)
  for (const team of group.teams) {
    const price = teamOdds[team].mostGoalsOdds;
    rows.push(makeOutrightRow(team, "Najefikasniji tim u grupi", price));
  }

  return rows.join("\r\n");
}

export function buildTeamSimulationCsv({ teamName, teamResults, eventDate, competitionName, startSifra = 50518, outrightMultiplier = 1, ouMultiplier = 1 }) {
  const { date, time } = formatEventDateTime(eventDate);
  const res = teamResults[teamName];
  if (!res) return "";

  let currentSifra = Number.isInteger(startSifra) ? startSifra : 50518;
  const rows = [];

  // MATCH_NAME: World Cup 2026
  const compName = competitionName || "World Cup 2026";
  rows.push(formatCsvRow([`MATCH_NAME:${compName}`]));
  // LEAGUE_NAME: Mexico
  rows.push(formatCsvRow([`LEAGUE_NAME:${teamName}`]));

  // Helper to format prices with margin
  const makeOutrightPrice = (prob) => {
    if (prob <= 0.0001) return 999.00;
    const fair = 1 / prob;
    return (fair * outrightMultiplier);
  };

  const makeOuPrice = (prob) => {
    if (prob <= 0.0001) return 999.00;
    const fair = 1 / prob;
    return (fair * ouMultiplier);
  };

  // Helper to build a single outright row
  const makeOutrightRow = (gost, prob) => {
    if (prob === undefined || prob === null) return "";
    const price = makeOutrightPrice(prob);
    const sifraStr = currentSifra.toString();
    currentSifra++;
    return formatCsvRow([
      date,
      time,
      sifraStr,
      toAsciiMarketName(teamName),
      toAsciiMarketName(gost),
      formatPrice(price),
      "", "", "", "", "", "", ""
    ]);
  };

  // Helper to build Over/Under row with explicit line
  const makeExplicitOuRow = (gost, line, distribution) => {
    if (!distribution) return "";
    let pUnder = 0;
    let pOver = 0;
    for (const [valStr, prob] of Object.entries(distribution)) {
      const val = Number(valStr);
      if (val < line) pUnder += prob;
      else pOver += prob;
    }
    
    const underPrice = makeOuPrice(pUnder);
    const overPrice = makeOuPrice(pOver);
    const sifraStr = currentSifra.toString();
    currentSifra++;
    return formatCsvRow([
      date,
      time,
      sifraStr,
      toAsciiMarketName(teamName),
      toAsciiMarketName(gost),
      "",
      "",
      "",
      formatPrice(line),
      formatPrice(underPrice),
      formatPrice(overPrice),
      "",
      ""
    ]);
  };

  // 1. Outright rows
  rows.push(makeOutrightRow("Pobednik", res.pTournamentWinner));
  rows.push(makeOutrightRow("Pobednik grupe", res.p1stPlace));
  rows.push(makeOutrightRow("2. mesto u grupi", res.p2ndPlace));
  rows.push(makeOutrightRow("3. mesto u grupi", res.p3rdPlace));
  rows.push(makeOutrightRow("4. mesto u grupi", res.p4thPlace));
  rows.push(makeOutrightRow("prolazi grupu", res.pReachesR32));
  rows.push(makeOutrightRow("Ne prolazi grupu", 1 - res.pReachesR32));
  rows.push(makeOutrightRow("Prolazi dalje", res.pReachesR16));
  rows.push(makeOutrightRow("eliminacija u 1/16 finala", res.pEliminatedR32));
  rows.push(makeOutrightRow("eliminacija u 1/8 finala", res.pEliminatedR16));
  rows.push(makeOutrightRow("eliminacija u 1/4 finala", res.pEliminatedQF));
  rows.push(makeOutrightRow("eliminacija u 1/2 finala", res.pEliminatedSF));
  rows.push(makeOutrightRow("eliminacija u finalu", res.pEliminatedFinal));
  rows.push(makeOutrightRow("dolazi do 1/16 finala", res.pReachesR32));
  rows.push(makeOutrightRow("dolazi do 1/8 finala", res.pReachesR16));
  rows.push(makeOutrightRow("dolazi do 1/4 finala", res.pReachesQF));
  rows.push(makeOutrightRow("dolazi do 1/2 finala", res.pReachesSF));
  rows.push(makeOutrightRow("dolazi do finala", res.pReachesFinal));

  // 2. Points distributions
  const dist = res.pointsDistribution || res.pointsGroupDistribution || {};
  rows.push(makeOutrightRow("0 bodova u grupi", dist[0] || 0));
  rows.push(makeOutrightRow("1 bodova u grupi", dist[1] || 0));
  rows.push(makeOutrightRow("2 bodova u grupi", dist[2] || 0));
  rows.push(makeOutrightRow("3 bodova u grupi", dist[3] || 0));
  rows.push(makeOutrightRow("4 bodova u grupi", dist[4] || 0));
  rows.push(makeOutrightRow("5 bodova u grupi", dist[5] || 0));
  rows.push(makeOutrightRow("6 bodova u grupi", dist[6] || 0));
  rows.push(makeOutrightRow("7 bodova u grupi", dist[7] || 0));
  rows.push(makeOutrightRow("9 bodova u grupi", dist[9] || 0));

  // Points ranges
  rows.push(makeOutrightRow("1-3 boda u grupi", (dist[1]||0) + (dist[2]||0) + (dist[3]||0)));
  rows.push(makeOutrightRow("2-4 boda u grupi", (dist[2]||0) + (dist[3]||0) + (dist[4]||0)));
  rows.push(makeOutrightRow("4-6 bodova u grupi", (dist[4]||0) + (dist[5]||0) + (dist[6]||0)));
  rows.push(makeOutrightRow("7+ bodova u grupi", (dist[7]||0) + (dist[9]||0)));

  // Points Over/Under
  rows.push(makeExplicitOuRow("osvojenih bodova u grupi1", 5.5, dist));
  rows.push(makeExplicitOuRow("osvojenih bodova u grupi2", 6.5, dist));
  rows.push(makeExplicitOuRow("osvojenih bodova u grupi3", 4.5, dist));

  // Goals Scored Over/Under
  const gsDist = res.goalsScoredGroupDistribution || {};
  rows.push(makeExplicitOuRow("datih golova u grupi1", 4.5, gsDist));
  rows.push(makeExplicitOuRow("datih golova u grupi2", 5.5, gsDist));
  rows.push(makeExplicitOuRow("datih golova u grupi3", 3.5, gsDist));

  // Goals Scored Ranges u grupi
  rows.push(makeOutrightRow("1-2 datih golova u grupi", (gsDist[1]||0) + (gsDist[2]||0)));
  rows.push(makeOutrightRow("1-3 datih golova u grupi", (gsDist[1]||0) + (gsDist[2]||0) + (gsDist[3]||0)));
  rows.push(makeOutrightRow("2-4 datih golova u grupi", (gsDist[2]||0) + (gsDist[3]||0) + (gsDist[4]||0)));
  rows.push(makeOutrightRow("4-6 datih golova u grupi", (gsDist[4]||0) + (gsDist[5]||0) + (gsDist[6]||0)));
  rows.push(makeOutrightRow("5-7 datih golova u grupi", (gsDist[5]||0) + (gsDist[6]||0) + (gsDist[7]||0)));

  // Goals Conceded Over/Under
  const gcDist = res.goalsConcededGroupDistribution || {};
  rows.push(makeExplicitOuRow("primljenih golova u grupi1", 2.5, gcDist));
  rows.push(makeExplicitOuRow("primljenih golova u grupi2", 3.5, gcDist));
  rows.push(makeExplicitOuRow("primljenih golova u grupi3", 1.5, gcDist));

  // Miscellaneous group markets
  rows.push(makeOutrightRow("Najvise datih golova u grupi", res.pMostGoalsGroup !== undefined ? res.pMostGoalsGroup : res.pMostGoals));
  rows.push(makeOutrightRow("Najvise primljenih golova u grupi", res.pMostConcededGroup !== undefined ? res.pMostConcededGroup : res.pMostConceded));
  rows.push(makeOutrightRow("Daje gol na svakom mecu u grupi", res.scoredInAllGroup));
  rows.push(makeOutrightRow("Bez poraza u grupi", res.noLossesGroup));
  rows.push(makeOutrightRow("Prima gol na svakom mecu u grupi", res.concededInAllGroup));

  // Wins and draws Over/Under
  rows.push(makeExplicitOuRow("broj pobeda u grupi", 1.5, res.winsGroupDistribution));
  rows.push(makeExplicitOuRow("broj neresenih u grupi", 0.5, res.drawsGroupDistribution));

  // Tournament goals scored
  rows.push(makeExplicitOuRow("broj datih golova na turniru", 7.5, res.totalGoalsTournamentDistribution));

  return rows.filter(Boolean).join("\r\n");
}


