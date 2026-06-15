import { fetchMarketsForEvent, fetchPrematchEventsForCompetition, fetchSoccerCompetitions } from "./api.js";
import {
  buildDailyCsv,
  buildDailyTotals,
  buildMatchModel,
  buildPlayerVsTeamRow,
  buildTeamDuelRow,
  collectPlayerOptions,
  createPeriod,
  formatLocalEventDate,
  formatPeriodLabel,
  getTeamOptions,
  isEventInPeriod
} from "./daily_specials_model.js?v=20260615-2";

const elements = {
  competitionList: document.querySelector("#competition-list"),
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  eventsStatus: document.querySelector("#events-status"),
  dailyDateFrom: document.querySelector("#daily-date-from"),
  dailyDateTo: document.querySelector("#daily-date-to"),
  dailyFrom: document.querySelector("#daily-from"),
  dailyTo: document.querySelector("#daily-to"),
  loadEventsButton: document.querySelector("#load-events-button"),
  eventsList: document.querySelector("#daily-events-list"),
  marketsStatus: document.querySelector("#markets-status"),
  rangeLabel: document.querySelector("#daily-range-label"),
  recalculateButton: document.querySelector("#recalculate-button"),
  dailyTotals: document.querySelector("#daily-totals"),
  playerEventSelect: document.querySelector("#player-event-select"),
  playerSelect: document.querySelector("#player-select"),
  playerTeamSelect: document.querySelector("#player-team-select"),
  addPlayerSpecial: document.querySelector("#add-player-special"),
  playerSpecialsList: document.querySelector("#player-specials-list"),
  duelLeftSelect: document.querySelector("#duel-left-select"),
  duelRightSelect: document.querySelector("#duel-right-select"),
  addTeamDuel: document.querySelector("#add-team-duel"),
  teamDuelsList: document.querySelector("#team-duels-list"),
  csvOutput: document.querySelector("#csv-output"),
  csvStatus: document.querySelector("#csv-status"),
  downloadCsvButton: document.querySelector("#download-csv-button"),
  clearCsvButton: document.querySelector("#clear-csv-button")
};

let categories = [];
let events = [];
let marketsByEventId = new Map();
let matchModels = [];
let totalRows = [];
let playerRows = [];
let duelRows = [];
let teamAliases = new Map();
let requestId = 0;

init();

async function init() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  elements.dailyDateFrom.value = toIsoDate(today);
  elements.dailyDateTo.value = toIsoDate(tomorrow);
  wireEvents();
  await loadCompetitions();
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", loadCompetitions);
  elements.competitionList.addEventListener("change", (event) => {
    if (event.target.matches('input[type="checkbox"]')) loadEvents();
  });
  elements.loadEventsButton.addEventListener("click", loadEvents);
  elements.recalculateButton.addEventListener("click", recalculateSelected);
  elements.playerEventSelect.addEventListener("change", renderPlayerSelectors);
  elements.addPlayerSpecial.addEventListener("click", addPlayerSpecial);
  elements.addTeamDuel.addEventListener("click", addTeamDuel);
  elements.clearCsvButton.addEventListener("click", () => {
    playerRows = [];
    duelRows = [];
    renderAddedRows();
    renderCsv();
  });
  elements.downloadCsvButton.addEventListener("click", downloadCsv);
  elements.dailyDateFrom.addEventListener("change", updateRangeLabel);
  elements.dailyDateTo.addEventListener("change", updateRangeLabel);
  elements.dailyFrom.addEventListener("change", updateRangeLabel);
  elements.dailyTo.addEventListener("change", updateRangeLabel);
}

async function loadCompetitions() {
  setStatus("Loading competitions...");
  elements.competitionList.replaceChildren(createEmpty("Loading competitions..."));
  try {
    categories = await fetchSoccerCompetitions();
    renderCompetitionChecklist();
    setStatus("Ready");
    updateRangeLabel();
    await loadEvents();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadEvents() {
  const competitions = getSelectedCompetitions();
  if (!competitions.length) {
    resetCalculatedState();
    elements.eventsStatus.textContent = "Pick at least one competition";
    elements.eventsList.replaceChildren(createEmpty("Izaberi jednu ili vise liga."));
    return;
  }
  const id = ++requestId;
  const period = getPeriod();
  updateRangeLabel(period);
  resetCalculatedState();
  elements.eventsStatus.textContent = `Loading events from ${competitions.length} competitions...`;
  elements.eventsList.replaceChildren(createEmpty("Loading events..."));

  try {
    const startDate = new Date(`${period.dateFrom}T00:00:00`);
    const loadedLists = await Promise.all(competitions.map(async (competition) => {
      const list = await fetchPrematchEventsForCompetition(competition.tournamentId, startDate);
      return list.map((event) => ({
        ...event,
        competitionName: competition.tournamentName,
        categoryName: competition.categoryName
      }));
    }));
    if (id !== requestId) return;
    events = loadedLists.flat()
      .filter((event) => isEventInPeriod(event, period))
      .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    renderEvents();
  } catch (error) {
    if (id !== requestId) return;
    elements.eventsStatus.textContent = error.message;
    elements.eventsStatus.classList.add("is-error");
    elements.eventsList.replaceChildren(createEmpty("Unable to load events."));
  }
}

function renderEvents() {
  const period = getPeriod();
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = events.length ? `${events.length} events loaded` : "No events for period";
  if (!events.length) {
    elements.eventsList.replaceChildren(createEmpty("No prematch events found."));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of events) {
    const local = formatLocalEventDate(event.matchDate);
    const checked = isEventInPeriod(event, period);
    const row = document.createElement("label");
    const input = document.createElement("input");
    const teamEdit = document.createElement("div");
    const main = document.createElement("span");
    const meta = document.createElement("span");
    row.className = "daily-event-row";
    input.type = "checkbox";
    input.value = String(event.eventId);
    input.checked = checked;
    main.className = "daily-event-main";
    meta.className = "daily-event-meta";
    main.textContent = formatEventNameWithAliases(event);
    meta.textContent = `${local.dateLabel} ${local.time} | ${event.competitionName || ""} | ${event.marketCount || event.oddsCount || 0} markets`;
    input.addEventListener("change", recalculateSelected);
    teamEdit.className = "daily-team-edit";
    if (event.homeTeam && event.awayTeam) {
      teamEdit.append(
        createTeamAliasInput(event, "home", event.homeTeam),
        createTeamAliasInput(event, "away", event.awayTeam)
      );
    }
    row.append(input, main, meta, teamEdit);
    fragment.append(row);
  }
  elements.eventsList.replaceChildren(fragment);
  recalculateSelected();
}

async function recalculateSelected() {
  const selectedEvents = getSelectedEvents();
  const period = getPeriod();
  updateRangeLabel(period);
  totalRows = [];
  playerRows = [];
  duelRows = [];
  renderAddedRows();

  if (!selectedEvents.length) {
    matchModels = [];
    renderTotals([]);
    renderSpecialControls();
    renderCsv();
    elements.marketsStatus.textContent = "No matches selected";
    return;
  }

  const id = ++requestId;
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = `Loading markets for ${selectedEvents.length} matches...`;
  renderTotals([]);

  try {
    const entries = await Promise.all(selectedEvents.map(async (event) => {
      if (!marketsByEventId.has(event.eventId)) {
        marketsByEventId.set(event.eventId, await fetchMarketsForEvent(event));
      }
      return [event, marketsByEventId.get(event.eventId)];
    }));
    if (id !== requestId) return;
    matchModels = entries.map(([event, markets]) => buildMatchModel(event, markets));
    totalRows = buildDailyTotals(matchModels, period);
    elements.marketsStatus.textContent = `${selectedEvents.length} matches calculated`;
    renderTotals(totalRows);
    renderSpecialControls();
    renderCsv();
  } catch (error) {
    if (id !== requestId) return;
    elements.marketsStatus.textContent = error.message;
    elements.marketsStatus.classList.add("is-error");
  }
}

function renderTotals(rows) {
  if (!rows.length) {
    elements.dailyTotals.replaceChildren(createEmpty("Izaberi meceve za kalkulaciju."));
    return;
  }
  const table = document.createElement("table");
  table.className = "daily-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Igra</th>
        <th>GR</th>
        <th>U</th>
        <th>O</th>
        <th>Izvor</th>
      </tr>
    </thead>
  `;
  const body = document.createElement("tbody");
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.className = row.ok ? "" : "is-muted";
    tr.innerHTML = row.ok
      ? `<td>${escapeHtml(row.host)}</td>
         <td>${editableCell("total", index, "line", row.line)}</td>
         <td>${editableCell("total", index, "under", row.under)}</td>
         <td>${editableCell("total", index, "over", row.over)}</td>
         <td>${row.coverage || ""}</td>`
      : `<td>${escapeHtml(row.label)}</td><td colspan="4">${escapeHtml(row.reason)}</td>`;
    body.append(tr);
  });
  table.append(body);
  elements.dailyTotals.replaceChildren(table);
  bindEditableRowInputs(elements.dailyTotals);
}

function renderSpecialControls() {
  renderPlayerSelectors();
  renderDuelSelectors();
}

function renderPlayerSelectors() {
  const playerOptions = collectPlayerOptions(matchModels);
  elements.playerEventSelect.replaceChildren(...playerOptions.map((item) => {
    const model = matchModels.find((match) => String(match.event.eventId) === String(item.eventId));
    return new Option(model ? formatEventNameWithAliases(model.event) : item.eventName, String(item.eventId));
  }));
  elements.playerEventSelect.disabled = !playerOptions.length;

  const selectedEventId = elements.playerEventSelect.value || playerOptions[0]?.eventId;
  const selected = playerOptions.find((item) => String(item.eventId) === String(selectedEventId));
  const players = selected?.players || [];
  elements.playerSelect.replaceChildren(...players.map((name) => new Option(formatPlayerName(name), name)));
  elements.playerSelect.disabled = !players.length;

  const model = matchModels.find((item) => String(item.event.eventId) === String(selectedEventId));
  const teamOptions = [];
  if (model?.event.homeTeam) teamOptions.push(new Option(getDisplayTeam(model.event, "home"), "home"));
  if (model?.event.awayTeam) teamOptions.push(new Option(getDisplayTeam(model.event, "away"), "away"));
  elements.playerTeamSelect.replaceChildren(...teamOptions);
  elements.playerTeamSelect.disabled = !teamOptions.length;
  elements.addPlayerSpecial.disabled = !model || !players.length || !teamOptions.length;
}

function renderDuelSelectors() {
  const teamOptions = getTeamOptions(matchModels.map(withAliasedEvent));
  const left = teamOptions.map((item) => new Option(item.label, item.value));
  const right = teamOptions.map((item) => new Option(item.label, item.value));
  elements.duelLeftSelect.replaceChildren(...left);
  elements.duelRightSelect.replaceChildren(...right);
  elements.duelLeftSelect.disabled = !teamOptions.length;
  elements.duelRightSelect.disabled = !teamOptions.length;
  elements.addTeamDuel.disabled = teamOptions.length < 2;
}

function addPlayerSpecial() {
  const eventId = elements.playerEventSelect.value;
  const matchModel = matchModels.find((item) => String(item.event.eventId) === String(eventId));
  if (!matchModel) return;
  const row = buildPlayerVsTeamRow({
    matchModel: withAliasedEvent(matchModel),
    playerName: elements.playerSelect.value,
    teamSide: elements.playerTeamSelect.value,
    period: getPeriod()
  });
  playerRows.push(row);
  renderAddedRows();
  renderCsv();
}

function addTeamDuel() {
  const leftTeams = selectedValues(elements.duelLeftSelect);
  const rightTeams = selectedValues(elements.duelRightSelect);
  if (!leftTeams.length || !rightTeams.length) return;
  const row = buildTeamDuelRow({
    matchModels: matchModels.map(withAliasedEvent),
    leftTeams,
    rightTeams,
    period: getPeriod()
  });
  duelRows.push(row);
  renderAddedRows();
  renderCsv();
}

function renderAddedRows() {
  renderAddedList(elements.playerSpecialsList, playerRows, "Nema dodatih igrac vs tim redova.", (index) => {
    playerRows.splice(index, 1);
    renderAddedRows();
    renderCsv();
  });
  renderAddedList(elements.teamDuelsList, duelRows, "Nema dodatih duela timova.", (index) => {
    duelRows.splice(index, 1);
    renderAddedRows();
    renderCsv();
  });
}

function renderAddedList(container, rows, emptyText, onRemove) {
  if (!rows.length) {
    container.replaceChildren(createEmpty(emptyText));
    return;
  }
  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    const item = document.createElement("div");
    const text = document.createElement("span");
    const button = document.createElement("button");
    item.className = `daily-added-row${row.ok ? "" : " is-error"}`;
    if (row.ok) {
      text.append(createAddedRowEditor(row, rows === playerRows ? "player" : "duel", index));
    } else {
      text.textContent = `${row.label}: ${row.reason}`;
    }
    button.className = "add-odd-button";
    button.type = "button";
    button.textContent = "x";
    button.title = "Remove";
    button.addEventListener("click", () => onRemove(index));
    item.append(text, button);
    fragment.append(item);
  });
  container.replaceChildren(fragment);
  bindEditableRowInputs(container);
}

function renderCsv() {
  const period = getPeriod();
  const selectedCount = getSelectedEvents().length;
  const hasAny = selectedCount && totalRows.some((row) => row.ok);
  const csv = hasAny
    ? buildDailyCsv({ period, selectedCount, totalRows, playerRows, duelRows })
    : "";
  elements.csvOutput.value = csv;
  elements.downloadCsvButton.disabled = !csv;
  elements.clearCsvButton.disabled = !playerRows.length && !duelRows.length;
  elements.csvStatus.textContent = csv ? `${csv.split(/\r?\n/).filter(Boolean).length} CSV rows generated` : "No CSV rows generated";
}

function downloadCsv() {
  const csv = elements.csvOutput.value;
  if (!csv) return;
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dnevni_specijali_${elements.dailyDateFrom.value || "today"}_${elements.dailyDateTo.value || "end"}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetCalculatedState() {
  marketsByEventId = new Map();
  matchModels = [];
  totalRows = [];
  playerRows = [];
  duelRows = [];
  renderTotals([]);
  renderAddedRows();
  renderSpecialControls();
  renderCsv();
}

function createTeamAliasInput(event, side, fallback) {
  const input = document.createElement("input");
  input.className = "daily-team-input";
  input.type = "text";
  input.value = getTeamAlias(event.eventId, side) || fallback;
  input.placeholder = fallback;
  input.dataset.eventId = String(event.eventId);
  input.dataset.side = side;
  input.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  input.addEventListener("change", () => {
    setTeamAlias(event.eventId, side, input.value.trim(), fallback);
    refreshTeamLabels();
    renderSpecialControls();
    renderCsv();
  });
  return input;
}

function refreshTeamLabels() {
  for (const row of elements.eventsList.querySelectorAll(".daily-event-row")) {
    const checkbox = row.querySelector('input[type="checkbox"]');
    const event = events.find((item) => String(item.eventId) === checkbox?.value);
    const main = row.querySelector(".daily-event-main");
    if (event && main) main.textContent = formatEventNameWithAliases(event);
  }
}

function getTeamAlias(eventId, side) {
  return teamAliases.get(`${eventId}|${side}`) || "";
}

function setTeamAlias(eventId, side, value, fallback) {
  const key = `${eventId}|${side}`;
  if (!value || value === fallback) {
    teamAliases.delete(key);
  } else {
    teamAliases.set(key, value);
  }
}

function getDisplayTeam(event, side) {
  const fallback = side === "home" ? event.homeTeam : event.awayTeam;
  return getTeamAlias(event.eventId, side) || fallback;
}

function formatEventNameWithAliases(event) {
  if (event.homeTeam && event.awayTeam) {
    return `${getDisplayTeam(event, "home")} - ${getDisplayTeam(event, "away")}`;
  }
  return event.matchName;
}

function withAliasedEvent(model) {
  return {
    ...model,
    event: {
      ...model.event,
      homeTeam: getDisplayTeam(model.event, "home"),
      awayTeam: getDisplayTeam(model.event, "away")
    }
  };
}

function editableCell(group, index, field, value) {
  return `<input class="daily-odds-edit" data-group="${group}" data-index="${index}" data-field="${field}" value="${escapeHtml(value || "")}">`;
}

function createAddedRowEditor(row, group, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-added-editor";
  wrapper.innerHTML = `
    <span>${escapeHtml(row.host)} vs ${escapeHtml(row.guest)}</span>
    <label>1 ${editableCell(group, index, "one", row.one)}</label>
    <label>X ${editableCell(group, index, "draw", row.draw)}</label>
    <label>2 ${editableCell(group, index, "two", row.two)}</label>
    <label>GR ${editableCell(group, index, "line", row.line)}</label>
    <label>U ${editableCell(group, index, "under", row.under)}</label>
    <label>O ${editableCell(group, index, "over", row.over)}</label>
  `;
  return wrapper;
}

function bindEditableRowInputs(root) {
  for (const input of root.querySelectorAll(".daily-odds-edit")) {
    input.addEventListener("change", () => {
      const row = getEditableRow(input.dataset.group, Number(input.dataset.index));
      if (!row) return;
      row[input.dataset.field] = input.value.trim();
      renderCsv();
    });
  }
}

function getEditableRow(group, index) {
  if (group === "total") return totalRows[index];
  if (group === "player") return playerRows[index];
  if (group === "duel") return duelRows[index];
  return null;
}

function renderCompetitionChecklist() {
  const fragment = document.createDocumentFragment();
  let index = 0;
  for (const category of categories) {
    const group = document.createElement("div");
    const title = document.createElement("div");
    title.className = "daily-competition-category";
    title.textContent = category.categoryName;
    group.append(title);
    for (const competition of category.competitions) {
      const row = document.createElement("label");
      const input = document.createElement("input");
      const text = document.createElement("span");
      row.className = "daily-competition-row";
      input.type = "checkbox";
      input.value = String(competition.tournamentId);
      input.checked = index === 0;
      text.textContent = competition.tournamentName;
      row.append(input, text);
      group.append(row);
      index += 1;
    }
    fragment.append(group);
  }
  elements.competitionList.replaceChildren(fragment);
}

function getSelectedCompetitions() {
  const selectedIds = new Set(Array.from(elements.competitionList.querySelectorAll('input[type="checkbox"]:checked')).map((input) => Number(input.value)));
  const selected = [];
  for (const category of categories) {
    for (const competition of category.competitions) {
      if (selectedIds.has(competition.tournamentId)) selected.push(competition);
    }
  }
  return selected;
}

function getSelectedEvents() {
  const selectedIds = new Set(Array.from(elements.eventsList.querySelectorAll("input:checked")).map((input) => Number(input.value)));
  return events.filter((event) => selectedIds.has(event.eventId));
}

function getPeriod() {
  const today = toIsoDate(new Date());
  return createPeriod(
    elements.dailyDateFrom.value || today,
    elements.dailyDateTo.value || elements.dailyDateFrom.value || today,
    elements.dailyFrom.value || "18:00",
    elements.dailyTo.value || "06:00"
  );
}

function updateRangeLabel(period = getPeriod()) {
  elements.rangeLabel.textContent = formatPeriodLabel(period);
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

function selectedValues(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function formatPlayerName(value) {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(value || "").trim();
}

function toIsoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
