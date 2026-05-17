import { fetchMarketsForEvent, fetchPrematchEventsForCompetition, fetchSoccerCompetitions } from "./api.js";
import { buildSingleOddCsvRow, buildStatistikaMarketCsvRow, buildSpecijaliBlock, buildSpecijalRow, removeCsvRow, removePlayerOddFromCsv, removeSpecijalRowFromCsv, countCsvRows, CSV_COLUMNS, makeCsvFilename } from "./csv.js";
import {
  getSelectedCompetition,
  getSelectedEvent,
  getElements,
  getCsvOutput,
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
  setLoading
} from "./ui.js";

const { select, eventSelect, refreshButton, downloadCsvButton } = getElements();
let eventsRequestId = 0;
let marketsRequestId = 0;

async function loadCompetitions() {
  setLoading();
  resetEvents();
  resetMarkets();

  try {
    const categories = await fetchSoccerCompetitions();
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
    resetLineups();
    resetMarkets();
    return;
  }

  const requestId = ++eventsRequestId;
  setEventsLoading(competition);
  resetMarkets();

  try {
    const events = await fetchPrematchEventsForCompetition(competition.tournamentId);

    if (requestId === eventsRequestId) {
      renderEvents(events);
      await loadMarketsForSelectedEvent();
    }
  } catch (error) {
    if (requestId === eventsRequestId) {
      setEventsError(error);
      resetLineups();
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


select.addEventListener("change", loadEventsForSelectedCompetition);
eventSelect.addEventListener("change", loadMarketsForSelectedEvent);
refreshButton.addEventListener("click", loadCompetitions);
downloadCsvButton.addEventListener("click", downloadCsv);

document.addEventListener("add-odd-to-csv", ({ detail: { marketName, odd, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  const row = buildSingleOddCsvRow({ event, marketName, odd });
  if (!row) return;

  const existing = getCsvOutput().trim();

  const teamName = odd.playerTeam === "home"
    ? (event.homeTeam || event.matchName)
    : odd.playerTeam === "away"
      ? (event.awayTeam || event.matchName)
      : (event.awayTeam || event.homeTeam || event.matchName);
  const rawName = String(odd.playerName ?? "");
  const nameParts = rawName.split(",").map((p) => p.trim()).filter(Boolean);
  const playerName = nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : rawName;

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

  renderCsvOutput(newCsv, makeCsvFilename(event, null), countCsvRows(newCsv));
  button.dataset.csvRow = row;
  button.textContent = "✓";
  button.title = "Remove from CSV";
  button.classList.add("is-added");
  // intentionally NOT disabled — user can click again to remove
});

document.addEventListener("remove-odd-from-csv", ({ detail: { button } }) => {
  const rowToRemove = button.dataset.csvRow;
  if (!rowToRemove) return;

  const existing = getCsvOutput();
  const newCsv = removePlayerOddFromCsv(existing, rowToRemove);

  const event = getSelectedEvent();
  renderCsvOutput(newCsv, makeCsvFilename(event, null), countCsvRows(newCsv));

  delete button.dataset.csvRow;
  button.textContent = "+";
  button.title = "Add to CSV";
  button.classList.remove("is-added");
});

document.addEventListener("add-specijal-to-csv", ({ detail: { marketName, odd, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  // Always compute the plain data row — we store it for later removal
  const row = buildSpecijalRow({ event, marketName, odd });
  if (!row) return;

  const existing = getCsvOutput().trim();
  let newCsv;

  if (existing) {
    newCsv = `${existing}\r\n${row}`;
  } else {
    const block = buildSpecijaliBlock({ event, marketName, odd });
    if (!block) return;
    newCsv = `${CSV_COLUMNS.join(",")}\r\n${block}`;
  }

  renderCsvOutput(newCsv, makeCsvFilename(event, "specijali"), countCsvRows(newCsv));
  // Store the exact row string so the remove handler can find it
  button.dataset.csvRow = row;
  button.textContent = "✓";
  button.title = "Remove from CSV";
  button.classList.add("is-added");
  // intentionally NOT disabled — user can click again to remove
});

document.addEventListener("remove-specijal-from-csv", ({ detail: { button } }) => {
  const rowToRemove = button.dataset.csvRow;
  if (!rowToRemove) return;

  const existing = getCsvOutput();
  const newCsv = removeSpecijalRowFromCsv(existing, rowToRemove);

  const event = getSelectedEvent();
  renderCsvOutput(newCsv, makeCsvFilename(event, "specijali"), countCsvRows(newCsv));

  delete button.dataset.csvRow;
  button.textContent = "+";
  button.title = "Add to CSV as Specijali";
  button.classList.remove("is-added");
});

document.addEventListener("add-statistika-to-csv", ({ detail: { market, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  const row = buildStatistikaMarketCsvRow({ event, market });
  if (!row) return;

  const existing = getCsvOutput().trim();
  const eventName = event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : event.matchName;
  const newCsv = existing
    ? `${existing}\r\n${row}`
    : `${CSV_COLUMNS.join(",")}\r\nMATCH_NAME:Specijal\r\nLEAGUE_NAME:${eventName}\r\n${row}`;

  renderCsvOutput(newCsv, makeCsvFilename(event, null), countCsvRows(newCsv));
  button.dataset.csvRow = row;
  button.textContent = "✓";
  button.title = "Remove from CSV";
  button.classList.add("is-added");
});

document.addEventListener("remove-statistika-from-csv", ({ detail: { button } }) => {
  const rowToRemove = button.dataset.csvRow;
  if (!rowToRemove) return;

  const existing = getCsvOutput();
  const newCsv = removeCsvRow(existing, rowToRemove);

  const event = getSelectedEvent();
  renderCsvOutput(newCsv, makeCsvFilename(event, null), countCsvRows(newCsv));

  delete button.dataset.csvRow;
  button.textContent = "+";
  button.title = "Add to CSV";
  button.classList.remove("is-added");
});


loadCompetitions();
initMarketTabs();


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
