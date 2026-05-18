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
  const { date, time } = formatEventDateTime(event.matchDate);
  const market = toAsciiMarketName(String(marketName).trim());
  const rawAnswer = toAsciiMarketName(String(odd.name).trim());
  const answer = rawAnswer && rawAnswer !== market ? rawAnswer : "DA";
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

function mapOddToCsvMarket(market, odd) {
  const mkt = normalizeSearchText(market.marketName);
  const name = toAsciiMarketName(stripPlayerPrefix(market.marketName));
  const answer = extractLineOrNull(odd.name) ?? extractLineOrNull(odd.specialBetValue ?? "") ?? "DA";

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
  if (mkt.includes("ukupan") && mkt.includes("sutev") && mkt.includes("okvir")) return { market: "sutevi u okvir gola", answer };
  if (mkt.includes("ukupno") && mkt.includes("sutev")) return { market: name, answer };
  if (mkt.includes("faul") && mkt.includes("nacinjenih")) return { market: "ukupno nacinjenih faulova", answer };
  if (mkt.includes("faul") && mkt.includes("nad") && mkt.includes("igrac")) return { market: "uk. faulova nad igracem", answer };
  if (mkt.includes("faul") && mkt.includes("nad")) return { market: name, answer };
  if (mkt.includes("faul")) return { market: name, answer };
  if (mkt.includes("ofsajd")) return { market: name, answer };

  return null;
}

function sortPlayerRows(rows) {
  const priority = (marketName) => {
    const n = normalizeSearchText(marketName);
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

function extractLineOrNull(text) {
  const plus = String(text).match(/(\d+(?:[.,]\d+)?)\s*\+/);
  if (plus) return `${plus[1].replace(",", ".")}+`;
  const over = String(text).match(/(?:više od|vise od|over)\s*(\d+(?:[.,]\d+)?)/i);
  if (over) return `${Number(over[1].replace(",", ".")) + 0.5}+`;
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
