import { fetchMarketsForEvent, fetchPrematchEventsForCompetition, fetchBasketballCompetitions, fetchEuroleagueClubsStats } from "./api.js";
import { buildSingleOddCsvRow, buildStatistikaMarketCsvRow, buildSpecijaliBlock, buildSpecijalRow, removeCsvRow, replaceCsvRow, removePlayerOddFromCsv, removeSpecijalRowFromCsv, countCsvRows, CSV_COLUMNS, makeCsvFilename } from "./csv.js";
import {
  getSelectedCompetition,
  getSelectedEvent,
  getElements,
  getCsvOutput,
  getCurrentCsvFilename,
  getMarginMultiplier,
  refreshDisplayedPrices,
  initMarketTabs,
  renderMarkets,
  renderMarketsForCurrentFilter,
  renderCsvOutput,
  renderEvents,
  renderCompetitionDropdown,
  resetEvents,
  resetMarkets,
  setEventsError,
  setEventsLoading,
  setMarketsError,
  setMarketsLoading,
  setError,
  setLoading,
  addDefaultStatistikaMarkets,
  setSportId,
  renderEuroleagueStats
} from "./ui.js";

const { select, eventSelect, refreshButton, downloadCsvButton, clearCsvButton } = getElements();
let eventsRequestId = 0;
let marketsRequestId = 0;

async function loadCompetitions() {
  setLoading();
  resetEvents();
  resetMarkets();

  try {
    const categories = await fetchBasketballCompetitions();
    renderCompetitionDropdown(categories);
    await loadEventsForSelectedCompetition();
  } catch (error) {
    setError(error);
  }
}

async function loadEventsForSelectedCompetition() {
  const competition = getSelectedCompetition();

  if (!competition) {
    resetEvents();
    resetMarkets();
    hideEuroleagueStats();
    return;
  }

  const requestId = ++eventsRequestId;
  setEventsLoading(competition);
  resetMarkets();

  // Check if Euroleague is selected
  const isEuroleague = competition && (
    competition.tournamentName.toLowerCase().includes("euroleague") ||
    competition.tournamentName.toLowerCase().includes("evroliga")
  );

  if (isEuroleague) {
    loadAndShowEuroleagueStats();
  } else {
    hideEuroleagueStats();
  }

  try {
    const events = await fetchPrematchEventsForCompetition(competition.tournamentId);

    if (requestId === eventsRequestId) {
      renderEvents(events);
      await loadMarketsForSelectedEvent();
    }
  } catch (error) {
    if (requestId === eventsRequestId) {
      setEventsError(error);
      resetMarkets();
    }
  }
}

async function loadMarketsForSelectedEvent() {
  const event = getSelectedEvent();

  if (!event) {
    resetMarkets();
    return;
  }

  const competition = getSelectedCompetition();
  const isEuroleague = competition && (
    competition.tournamentName.toLowerCase().includes("euroleague") ||
    competition.tournamentName.toLowerCase().includes("evroliga")
  );

  if (isEuroleague) {
    try {
      const statsData = await fetchEuroleagueClubsStats();
      renderEuroleagueStats(statsData, event.homeTeam, event.awayTeam);
    } catch (err) {
      console.error("Error updating Euroleague stats for event:", err);
    }
  }

  const requestId = ++marketsRequestId;
  setMarketsLoading(event);

  try {
    const markets = await fetchMarketsForEvent(event);

    if (requestId === marketsRequestId) {
      renderMarkets(markets);
    }
  } catch (error) {
    if (requestId === marketsRequestId) {
      setMarketsError(error);
    }
  }
}

async function loadAndShowEuroleagueStats() {
  const container = document.querySelector("#euroleague-stats-container");
  if (!container) return;

  container.hidden = false;
  container.innerHTML = `<div class="empty-state">⏳ Učitavanje statistike Evrolige...</div>`;

  try {
    const statsData = await fetchEuroleagueClubsStats();
    const event = getSelectedEvent();
    if (event) {
      renderEuroleagueStats(statsData, event.homeTeam, event.awayTeam);
    } else {
      renderEuroleagueStats(statsData, null, null);
    }
  } catch (err) {
    console.error("Failed to load Euroleague stats:", err);
    container.innerHTML = `<div class="empty-state is-error">⚠️ Greška pri učitavanju statistike: ${err.message}</div>`;
  }
}

function hideEuroleagueStats() {
  const container = document.querySelector("#euroleague-stats-container");
  if (container) {
    container.hidden = true;
    container.innerHTML = "";
  }
}

select.addEventListener("change", loadEventsForSelectedCompetition);
eventSelect.addEventListener("change", loadMarketsForSelectedEvent);
refreshButton.addEventListener("click", loadCompetitions);
downloadCsvButton.addEventListener("click", downloadCsv);
clearCsvButton.addEventListener("click", clearCsv);
document.querySelector("#dodaj-default-button").addEventListener("click", addDefaultStatistikaMarkets);

document.addEventListener("add-odd-to-csv", ({ detail: { marketName, odd, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  const m = getMarginMultiplier();
  const adjustedOdd = m !== 1 ? { ...odd, price: odd.price * m } : odd;
  const row = buildSingleOddCsvRow({ event, marketName, odd: adjustedOdd });
  if (!row) return;

  const existing = getCsvOutput().trim();

  const teamName = odd.playerTeam === "home"
    ? (event.homeTeam || event.matchName)
    : odd.playerTeam === "away"
      ? (event.awayTeam || event.matchName)
      : (event.awayTeam || event.homeTeam || event.matchName);
  const resolvedName = (odd.playerName && !String(odd.playerName).includes(":"))
    ? String(odd.playerName)
    : (() => {
        const namePart = String(odd.name).split(" - ")[0].trim();
        const m = namePart.match(/^([\p{L}'.\-]+(?:\s[\p{L}'.\-]+)*),\s*([\p{L}'.\-]+(?:\s[\p{L}'.\-]+)*)$/u);
        return m ? `${m[1]}, ${m[2]}` : "";
      })();
  const nameParts = resolvedName.split(",").map((p) => p.trim()).filter(Boolean);
  const playerName = nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : resolvedName;

  let newCsv;
  if (!existing) {
    const lines = [CSV_COLUMNS.join(",")];
    if (teamName) lines.push(`MATCH_NAME:${teamName}`);
    if (playerName) lines.push(`LEAGUE_NAME:${playerName}`);
    lines.push(row);
    newCsv = lines.join("\r\n");
  } else {
    const csvLines = existing.split(/\r?\n/);
    const firstMatch = csvLines.find((l) => l.startsWith("MATCH_NAME:"));
    const csvTeam = firstMatch ? firstMatch.slice("MATCH_NAME:".length) : "";

    if (teamName && csvTeam && teamName !== csvTeam) {
      alert(`Cannot mix players from different teams.\nCSV contains: "${csvTeam}"\nSelected player: "${teamName}"`);
      return;
    }

    const lastLeague = csvLines.filter((l) => l.startsWith("LEAGUE_NAME:")).pop();
    const lastPlayer = lastLeague ? lastLeague.slice("LEAGUE_NAME:".length) : "";

    if (playerName && playerName !== lastPlayer) {
      newCsv = `${existing}\r\nLEAGUE_NAME:${playerName}\r\n${row}`;
    } else {
      newCsv = `${existing}\r\n${row}`;
    }
  }

  renderCsvOutput(newCsv, makeCsvFilename(event, teamName), countCsvRows(newCsv));
  button.dataset.csvRow = row;
  button.dataset.originalPrice = odd.price;
  button.textContent = "✓";
  button.title = "Remove from CSV";
  button.classList.add("is-added");
});

document.addEventListener("remove-odd-from-csv", ({ detail: { button } }) => {
  const rowToRemove = button.dataset.csvRow;
  if (!rowToRemove) return;

  const existing = getCsvOutput();
  const newCsv = removePlayerOddFromCsv(existing, rowToRemove);

  delete button.dataset.csvRow;
  button.textContent = "+";
  button.title = "Add to CSV";
  button.classList.remove("is-added");

  const event = getSelectedEvent();
  if (clearCsvIfNoSelections(event)) return;
  renderCsvOutput(newCsv, getCurrentCsvFilename(), countCsvRows(newCsv));
});

document.addEventListener("add-specijal-to-csv", ({ detail: { marketName, odd, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  const m = getMarginMultiplier();
  const adjustedOdd = m !== 1 ? { ...odd, price: odd.price * m } : odd;
  const row = buildSpecijalRow({ event, marketName, odd: adjustedOdd });
  if (!row) return;

  const existing = getCsvOutput().trim();
  if (existing && existing.split(/\r?\n/).some((line) => line === row)) return;

  let newCsv;

  if (existing) {
    newCsv = `${existing}\r\n${row}`;
  } else {
    const block = buildSpecijaliBlock({ event, marketName, odd: adjustedOdd });
    if (!block) return;
    newCsv = `${CSV_COLUMNS.join(",")}\r\n${block}`;
  }

  const eventFilename = makeCsvFilename(event, event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : event.matchName);
  renderCsvOutput(newCsv, eventFilename, countCsvRows(newCsv));
  button.dataset.csvRow = row;
  button.dataset.originalPrice = odd.price;
  button.textContent = "✓";
  button.title = "Remove from CSV";
  button.classList.add("is-added");
});

document.addEventListener("remove-specijal-from-csv", ({ detail: { button } }) => {
  const rowToRemove = button.dataset.csvRow;
  if (!rowToRemove) return;

  const existing = getCsvOutput();
  const newCsv = removeSpecijalRowFromCsv(existing, rowToRemove);

  delete button.dataset.csvRow;
  button.textContent = "+";
  button.title = "Add to CSV as Specijali";
  button.classList.remove("is-added");

  const event = getSelectedEvent();
  if (clearCsvIfNoSelections(event)) return;
  renderCsvOutput(newCsv, getCurrentCsvFilename(), countCsvRows(newCsv));
});

document.addEventListener("update-csv-row", ({ detail: { oldRow, newRow, button } }) => {
  if (!oldRow || !newRow || oldRow === newRow) return;
  const existing = getCsvOutput();
  const newCsv = replaceCsvRow(existing, oldRow, newRow);
  button.dataset.csvRow = newRow;
  const event = getSelectedEvent();
  renderCsvOutput(newCsv, makeCsvFilename(event, getPlayerTeamFromCsv(newCsv)), countCsvRows(newCsv));
});

document.addEventListener("add-statistika-to-csv", ({ detail: { market, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  const m = getMarginMultiplier();
  const adjustedMarket = m !== 1
    ? { ...market, odds: market.odds.map((o) => ({ ...o, price: o.price * m })) }
    : market;
  const row = buildStatistikaMarketCsvRow({ event, market: adjustedMarket });
  if (!row) return;

  const existing = getCsvOutput().trim();
  if (existing && existing.split(/\r?\n/).some((line) => line === row)) return;

  const eventName = event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : event.matchName;
  const newCsv = existing
    ? `${existing}\r\n${row}`
    : `${CSV_COLUMNS.join(",")}\r\nMATCH_NAME:Specijal\r\nLEAGUE_NAME:${eventName}\r\n${row}`;

  const statFilename = makeCsvFilename(event, event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : event.matchName);
  renderCsvOutput(newCsv, statFilename, countCsvRows(newCsv));
  button.dataset.csvRow = row;
  for (const o of market.odds) {
    const n = String(o.name).toLowerCase();
    if (n.includes("manje") || n.includes("under")) button.dataset.originalPriceU = o.price;
    else if (n.includes("vise") || n.includes("over")) button.dataset.originalPriceO = o.price;
  }
  button.textContent = "✓";
  button.title = "Remove from CSV";
  button.classList.add("is-added");
});

document.addEventListener("remove-statistika-from-csv", ({ detail: { button } }) => {
  const rowToRemove = button.dataset.csvRow;
  if (!rowToRemove) return;

  const existing = getCsvOutput();
  const newCsv = removeCsvRow(existing, rowToRemove);

  delete button.dataset.csvRow;
  button.textContent = "+";
  button.title = "Add to CSV";
  button.classList.remove("is-added");

  const event = getSelectedEvent();
  if (clearCsvIfNoSelections(event)) return;
  renderCsvOutput(newCsv, getCurrentCsvFilename(), countCsvRows(newCsv));
});

function getPlayerTeamFromCsv(csv) {
  if (!csv) return null;
  const line = csv.split(/\r?\n/).find((l) => l.startsWith("MATCH_NAME:"));
  if (!line) return null;
  const name = line.slice("MATCH_NAME:".length).trim();
  return name && name !== "Specijal" ? name : null;
}

function clearCsvIfNoSelections(event) {
  const hasAny = document.querySelector(".add-odd-button.is-added");
  const csv = getCsvOutput();
  const hasDataRows = csv.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("MATCH_NAME:") && !trimmed.startsWith("LEAGUE_NAME:");
  });

  if (!hasAny) {
    if (hasDataRows) return false;
    renderCsvOutput("", makeCsvFilename(event, null), 0);
    return true;
  }
  return false;
}

function applyMargin() {
  const multiplier = getMarginMultiplier();
  let csv = getCsvOutput();
  if (!csv) return;

  for (const btn of document.querySelectorAll(".add-odd-button.is-added[data-original-price]")) {
    const originalPrice = parseFloat(btn.dataset.originalPrice);
    if (!Number.isFinite(originalPrice)) continue;
    const oldRow = btn.dataset.csvRow;
    const cols = oldRow.split(",");
    cols[5] = (originalPrice * multiplier).toFixed(2);
    const newRow = cols.join(",");
    csv = csv.replace(oldRow, newRow);
    btn.dataset.csvRow = newRow;
  }

  for (const btn of document.querySelectorAll(".add-odd-button.is-added[data-original-price-u], .add-odd-button.is-added[data-original-price-o]")) {
    const oldRow = btn.dataset.csvRow;
    const cols = oldRow.split(",");
    const priceU = parseFloat(btn.dataset.originalPriceU);
    const priceO = parseFloat(btn.dataset.originalPriceO);
    if (Number.isFinite(priceU)) cols[9]  = (priceU * multiplier).toFixed(2);
    if (Number.isFinite(priceO)) cols[10] = (priceO * multiplier).toFixed(2);
    const newRow = cols.join(",");
    csv = csv.replace(oldRow, newRow);
    btn.dataset.csvRow = newRow;
  }

  refreshDisplayedPrices();
  const event = getSelectedEvent();
  renderCsvOutput(csv, makeCsvFilename(event, getPlayerTeamFromCsv(csv)), countCsvRows(csv));
}

document.querySelector("#margin-apply").addEventListener("click", applyMargin);
document.querySelector("#margin-pct").addEventListener("input", () => { applyMargin(); refreshDisplayedPrices(); });
document.querySelectorAll('input[name="margin-dir"]').forEach((r) => r.addEventListener("change", () => { applyMargin(); refreshDisplayedPrices(); }));

function clearCsv() {
  for (const btn of document.querySelectorAll(".player-select-btn.is-selected")) {
    btn.classList.remove("is-selected");
    btn.textContent = "+";
    btn.title = "Add default markets to CSV";
  }
  for (const btn of document.querySelectorAll(".add-odd-button.is-added")) {
    btn.classList.remove("is-added");
    btn.textContent = "+";
    btn.title = btn.closest(".combo-odd-wrapper") ? "Add to CSV as Specijali" : "Add to CSV";
    delete btn.dataset.csvRow;
    delete btn.dataset.originalPrice;
    delete btn.dataset.originalPriceU;
    delete btn.dataset.originalPriceO;
  }
  const event = getSelectedEvent();
  renderCsvOutput("", makeCsvFilename(event, null), 0);
}

function downloadCsv() {
  const csv = getCsvOutput();

  if (!csv) {
    return;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadCsvButton.dataset.filename || "odds.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Initialise for Basketball
setSportId(4);
loadCompetitions();
initMarketTabs();
