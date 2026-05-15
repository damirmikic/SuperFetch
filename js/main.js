import { fetchMarketsForEvent, fetchPrematchEventsForCompetition, fetchSoccerCompetitions } from "./api.js";
import { buildSingleOddCsvRow, buildSpecijaliBlock, buildSpecijalRow, removeCsvRow, removeSpecijalRowFromCsv, countCsvRows, CSV_COLUMNS, generateOddsCsv, generatePlayerBlock, makeCsvFilename } from "./csv.js";
import {
  getCurrentMarkets,
  getSelectedCompetition,
  getSelectedEvent,
  getSelectedPlayer,
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

const { select, eventSelect, playerSelect, refreshButton, generateCsvButton, addToCsvButton, downloadCsvButton } = getElements();
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
playerSelect.addEventListener("change", renderMarketsForCurrentFilter);
refreshButton.addEventListener("click", loadCompetitions);
generateCsvButton.addEventListener("click", generateCsv);
addToCsvButton.addEventListener("click", addToCurrentCsv);
downloadCsvButton.addEventListener("click", downloadCsv);

document.addEventListener("add-odd-to-csv", ({ detail: { marketName, odd, button } }) => {
  const event = getSelectedEvent();
  if (!event) return;

  const row = buildSingleOddCsvRow({ event, marketName, odd });
  if (!row) return;

  const existing = getCsvOutput().trim();

  let newCsv;
  if (existing) {
    newCsv = `${existing}\r\n${row}`;
  } else {
    const teamName = odd.playerTeam === "home"
      ? (event.homeTeam || event.matchName)
      : odd.playerTeam === "away"
        ? (event.awayTeam || event.matchName)
        : (event.awayTeam || event.homeTeam || event.matchName);
    const playerName = formatPlayerName(odd.playerName);
    const lines = [CSV_COLUMNS.join(",")];
    if (teamName) lines.push(`MATCH_NAME:${teamName}`);
    if (playerName) lines.push(`LEAGUE_NAME:${playerName}`);
    lines.push(row);
    newCsv = lines.join("\r\n");
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
  const newCsv = removeCsvRow(existing, rowToRemove);

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

function formatPlayerName(value) {
  const parts = String(value ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(value ?? "");
}

loadCompetitions();
initMarketTabs();

function addToCurrentCsv() {
  const event = getSelectedEvent();
  const markets = getCurrentMarkets();
  const player = getSelectedPlayer();

  if (!event || !markets.length || !player) return;

  const existing = getCsvOutput().trim();

  if (!existing) {
    const csv = generateOddsCsv({ event, markets, player });
    renderCsvOutput(csv, makeCsvFilename(event, player), countCsvRows(csv));
    return;
  }

  const block = generatePlayerBlock({ event, markets, playerName: player });
  if (!block) return;

  const newCsv = `${existing}\r\n${block}`;
  renderCsvOutput(newCsv, makeCsvFilename(event, null), countCsvRows(newCsv));
}

function generateCsv() {
  const event = getSelectedEvent();
  const markets = getCurrentMarkets();
  const player = getSelectedPlayer();

  if (!event || !markets.length) {
    renderCsvOutput("", "", 0);
    return;
  }

  const csv = generateOddsCsv({ event, markets, player });
  const filename = makeCsvFilename(event, player);
  renderCsvOutput(csv, filename, countCsvRows(csv));
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
