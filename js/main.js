import { fetchMarketsForEvent, fetchPrematchEventsForCompetition, fetchSoccerCompetitions } from "./api.js";
import { buildSingleOddCsvRow, countCsvRows, CSV_COLUMNS, generateOddsCsv, generatePlayerBlock, makeCsvFilename } from "./csv.js";
import {
  getCurrentMarkets,
  getSelectedCompetition,
  getSelectedEvent,
  getSelectedPlayer,
  getElements,
  getCsvOutput,
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
  button.textContent = "✓";
  button.classList.add("is-added");
  button.disabled = true;
});

function formatPlayerName(value) {
  const parts = String(value ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(value ?? "");
}

loadCompetitions();

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
