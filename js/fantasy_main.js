import { fetchMarketsForEvent, fetchPrematchEventsForCompetition, fetchSoccerCompetitions } from "./api.js";
import { fetchFplData } from "./fpl_api.js";
import { buildFixtureModel, buildPlayerExpectedPoints, matchFplPlayersToFixture } from "./fantasy_model.js";

const elements = {
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  eventsStatus: document.querySelector("#events-status"),
  fantasyDateFrom: document.querySelector("#fantasy-date-from"),
  fantasyDateTo: document.querySelector("#fantasy-date-to"),
  loadEventsButton: document.querySelector("#load-events-button"),
  selectAllEvents: document.querySelector("#select-all-events"),
  deselectAllEvents: document.querySelector("#deselect-all-events"),
  eventsList: document.querySelector("#fantasy-events-list"),
  calculateButton: document.querySelector("#calculate-button"),
  playersStatus: document.querySelector("#players-status"),
  positionFilter: document.querySelector("#position-filter"),
  playerSearch: document.querySelector("#player-search"),
  playersTableBody: document.querySelector("#players-table-body")
};

let categories = [];
let events = [];
let marketsByEventId = new Map();
let fplPlayers = [];
let projections = [];
let requestId = 0;

init();

async function init() {
  const today = new Date();
  const weekAhead = new Date(today);
  weekAhead.setDate(weekAhead.getDate() + 7);
  elements.fantasyDateFrom.value = toIsoDate(today);
  elements.fantasyDateTo.value = toIsoDate(weekAhead);
  wireEvents();
  await loadCompetitions();
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", loadCompetitions);
  elements.loadEventsButton.addEventListener("click", loadEvents);
  elements.selectAllEvents.addEventListener("click", () => setAllEventsSelected(true));
  elements.deselectAllEvents.addEventListener("click", () => setAllEventsSelected(false));
  elements.calculateButton.addEventListener("click", calculateProjections);
  elements.positionFilter.addEventListener("change", renderPlayers);
  elements.playerSearch.addEventListener("input", renderPlayers);
}

async function loadCompetitions() {
  setStatus("Loading competitions...");
  elements.eventsList.replaceChildren(createEmpty("Loading competitions..."));
  try {
    const allCategories = await fetchSoccerCompetitions();
    categories = filterPremierLeague(allCategories);
    setStatus("Ready");
    await loadEvents();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function filterPremierLeague(allCategories) {
  const result = [];
  for (const category of allCategories) {
    if (!isEnglandCategory(category.categoryName)) continue;
    const matches = category.competitions.filter((competition) => isPremierLeagueTournament(competition.tournamentName));
    if (matches.length) result.push({ ...category, competitions: matches });
  }
  return result;
}

function isEnglandCategory(name) {
  const norm = String(name || "").toLowerCase().trim();
  return norm === "engleska" || norm === "england";
}

function isPremierLeagueTournament(name) {
  const norm = String(name || "").toLowerCase().trim();
  return norm === "premier league";
}

async function loadEvents() {
  const competitions = categories.flatMap((category) => category.competitions);
  if (!competitions.length) {
    events = [];
    elements.eventsStatus.textContent = "Premier League not found";
    elements.eventsList.replaceChildren(createEmpty("Premier League competition unavailable in feed."));
    return;
  }

  const id = ++requestId;
  const dateFrom = elements.fantasyDateFrom.value || toIsoDate(new Date());
  const dateTo = elements.fantasyDateTo.value || dateFrom;
  elements.eventsStatus.textContent = "Loading fixtures...";
  elements.eventsList.replaceChildren(createEmpty("Loading fixtures..."));

  try {
    const startDate = new Date(`${dateFrom}T00:00:00`);
    const loadedLists = await Promise.all(competitions.map((competition) =>
      fetchPrematchEventsForCompetition(competition.tournamentId, startDate)
    ));
    if (id !== requestId) return;
    const endMs = new Date(`${dateTo}T23:59:59`).getTime();
    events = loadedLists.flat()
      .filter((event) => new Date(event.matchDate).getTime() <= endMs)
      .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    renderEvents();
  } catch (error) {
    if (id !== requestId) return;
    elements.eventsStatus.textContent = error.message;
    elements.eventsStatus.classList.add("is-error");
    elements.eventsList.replaceChildren(createEmpty("Unable to load fixtures."));
  }
}

function renderEvents() {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = events.length ? `${events.length} fixtures loaded` : "No fixtures in range";
  if (!events.length) {
    elements.eventsList.replaceChildren(createEmpty("No Premier League fixtures found."));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of events) {
    const row = document.createElement("label");
    const input = document.createElement("input");
    const main = document.createElement("span");
    const meta = document.createElement("span");
    row.className = "daily-event-row";
    input.type = "checkbox";
    input.value = String(event.eventId);
    input.checked = true;
    main.className = "daily-event-main";
    main.textContent = event.matchName;
    meta.className = "daily-event-meta";
    meta.textContent = new Date(event.matchDate).toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });
    row.append(input, main, meta);
    fragment.append(row);
  }
  elements.eventsList.replaceChildren(fragment);
}

async function calculateProjections() {
  const selectedEvents = getSelectedEvents();
  if (!selectedEvents.length) {
    elements.playersStatus.textContent = "No fixtures selected";
    projections = [];
    renderPlayers();
    return;
  }

  const id = ++requestId;
  elements.playersStatus.classList.remove("is-error");
  elements.playersStatus.textContent = `Loading FPL data and markets for ${selectedEvents.length} fixtures...`;

  try {
    if (!fplPlayers.length) {
      const fplData = await fetchFplData();
      fplPlayers = fplData.players;
    }
    if (id !== requestId) return;

    const entries = await Promise.all(selectedEvents.map(async (event) => {
      if (!marketsByEventId.has(event.eventId)) {
        marketsByEventId.set(event.eventId, await fetchMarketsForEvent(event));
      }
      return [event, marketsByEventId.get(event.eventId)];
    }));
    if (id !== requestId) return;

    const fixtureModels = entries.map(([event, markets]) => buildFixtureModel(event, markets));

    projections = [];
    for (const fixtureModel of fixtureModels) {
      const matches = matchFplPlayersToFixture(fixtureModel, fplPlayers);
      for (const playerMatch of matches) {
        projections.push(buildPlayerExpectedPoints(fixtureModel, playerMatch));
      }
    }
    projections.sort((a, b) => b.expectedPoints - a.expectedPoints);

    elements.playersStatus.textContent = `${projections.length} players projected across ${selectedEvents.length} fixtures`;
    renderPlayers();
  } catch (error) {
    if (id !== requestId) return;
    elements.playersStatus.textContent = error.message;
    elements.playersStatus.classList.add("is-error");
  }
}

function renderPlayers() {
  const positionValue = elements.positionFilter.value;
  const search = normalizeSearchText(elements.playerSearch.value);

  const filtered = projections.filter((player) => {
    if (positionValue && player.position !== positionValue) return false;
    if (search && !normalizeSearchText(`${player.playerName} ${player.webName}`).includes(search)) return false;
    return true;
  });

  if (!filtered.length) {
    elements.playersTableBody.replaceChildren();
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = "is-muted";
    cell.textContent = projections.length ? "No players match the filter." : "Calculate projections to see players.";
    emptyRow.append(cell);
    elements.playersTableBody.append(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const player of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(player.playerName)}</td>
      <td>${escapeHtml(player.team)}</td>
      <td>${escapeHtml(player.position)}</td>
      <td>${escapeHtml(player.fixtureName)}</td>
      <td class="fantasy-points-cell">${player.expectedPoints.toFixed(2)}</td>
      <td>${player.breakdown.goals.toFixed(2)}</td>
      <td>${player.breakdown.assists.toFixed(2)}</td>
      <td>${player.breakdown.cleanSheet.toFixed(2)}</td>
      <td>${(player.breakdown.cardsPenalty + player.breakdown.goalsConcededPenalty).toFixed(2)}</td>
    `;
    fragment.append(tr);
  }
  elements.playersTableBody.replaceChildren(fragment);
}

function getSelectedEvents() {
  const selectedIds = new Set(Array.from(elements.eventsList.querySelectorAll("input:checked")).map((input) => Number(input.value)));
  return events.filter((event) => selectedIds.has(event.eventId));
}

function setAllEventsSelected(selected) {
  for (const input of elements.eventsList.querySelectorAll('input[type="checkbox"]')) {
    input.checked = selected;
  }
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle("is-error", isError);
}

function createEmpty(text) {
  const div = document.createElement("div");
  div.className = "empty-state";
  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.textContent = "--";
  const label = document.createElement("span");
  label.textContent = text;
  div.append(icon, label);
  return div;
}

function toIsoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
