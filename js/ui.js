const elements = {
  select: document.querySelector("#competition-select"),
  eventSelect: document.querySelector("#event-select"),
  playerSelect: document.querySelector("#player-select"),
  generateCsvButton: document.querySelector("#generate-csv-button"),
  addToCsvButton: document.querySelector("#add-to-csv-button"),
  downloadCsvButton: document.querySelector("#download-csv-button"),
  csvOutput: document.querySelector("#csv-output"),
  marketsList: document.querySelector("#markets-list"),
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  eventsStatus: document.querySelector("#events-status"),
  csvStatus: document.querySelector("#csv-status"),
  marketsStatus: document.querySelector("#markets-status")
};

let optionIndex = new Map();
let eventIndex = new Map();
let currentMarkets = [];
let currentEvent = null;

export function getElements() {
  return elements;
}

export function setLoading() {
  elements.select.disabled = true;
  elements.select.replaceChildren(new Option("Loading competitions...", ""));
  elements.status.classList.remove("is-error");
  elements.status.textContent = "Fetching Superbet competitions...";
}

export function setError(error) {
  elements.select.disabled = true;
  elements.select.replaceChildren(new Option("Unable to load competitions", ""));
  elements.status.classList.add("is-error");
  elements.status.textContent = error.message;
}

export function renderCompetitionDropdown(categories) {
  optionIndex = new Map();
  const fragment = document.createDocumentFragment();

  for (const category of categories) {
    const group = document.createElement("optgroup");
    group.label = category.categoryName;

    for (const competition of category.competitions) {
      const option = new Option(competition.tournamentName, String(competition.tournamentId));
      group.append(option);
      optionIndex.set(option.value, competition);
    }

    fragment.append(group);
  }

  elements.select.replaceChildren(fragment);
  elements.select.disabled = optionIndex.size === 0;
  elements.status.classList.remove("is-error");
  elements.status.textContent = optionIndex.size
    ? `${optionIndex.size} competitions loaded`
    : "No competitions returned";

}

export function getSelectedCompetition() {
  const selected = optionIndex.get(elements.select.value);

  if (!selected) {
    return null;
  }

  return selected;
}

export function getSelectedEvent() {
  return eventIndex.get(elements.eventSelect.value) ?? null;
}

export function getCurrentMarkets() {
  return currentMarkets;
}

export function getSelectedPlayer() {
  return elements.playerSelect.value;
}

export function setEventsLoading(competition) {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = `Loading events for ${competition.tournamentName}...`;
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Loading events...", ""));
  resetPlayers();
}

export function setEventsError(error) {
  elements.eventsStatus.classList.add("is-error");
  elements.eventsStatus.textContent = error.message;
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Unable to load events", ""));
  resetPlayers();
}

export function resetEvents() {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = "Choose a competition";
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Choose a competition first", ""));
  resetPlayers();
}

export function renderEvents(events) {
  eventIndex = new Map();
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = events.length
    ? `${events.length} upcoming events loaded`
    : "No upcoming events for selected competition";

  if (!events.length) {
    elements.eventSelect.disabled = true;
    elements.eventSelect.replaceChildren(new Option("No prematch events found", ""));
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const event of events) {
    const option = new Option(formatEventOption(event), String(event.eventId));
    fragment.append(option);
    eventIndex.set(option.value, event);
  }

  elements.eventSelect.replaceChildren(fragment);
  elements.eventSelect.disabled = false;
}


export function setMarketsLoading(event) {
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = `Loading markets for ${formatMatchName(event)}...`;
  currentMarkets = [];
  currentEvent = event;
  resetCsvOutput("Loading markets...");
  resetPlayers("Loading players...");
  elements.marketsList.replaceChildren(createEmptyState("Loading markets..."));
}

export function setMarketsError(error) {
  elements.marketsStatus.classList.add("is-error");
  elements.marketsStatus.textContent = error.message;
  currentMarkets = [];
  resetCsvOutput("Unable to generate CSV");
  resetPlayers("Unable to load players");
  elements.marketsList.replaceChildren(createEmptyState("Unable to load markets."));
}

export function resetMarkets() {
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = "Choose an event";
  currentMarkets = [];
  currentEvent = null;
  resetCsvOutput("Choose an event first");
  resetPlayers();
  elements.marketsList.replaceChildren(createEmptyState("Choose an event first"));
}

export function renderMarkets(markets) {
  currentMarkets = markets;
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = markets.length
    ? `${markets.length} markets loaded`
    : "No markets for selected event";

  if (!markets.length) {
    resetCsvOutput("No markets for CSV");
    resetPlayers("No players detected");
    elements.marketsList.replaceChildren(createEmptyState("No markets found"));
    return;
  }

  renderPlayersDropdown(markets);
  elements.generateCsvButton.disabled = false;
  elements.csvStatus.textContent = "Ready to generate CSV";
  renderMarketsForCurrentFilter();
}

export function renderCsvOutput(csv, filename, rowCount) {
  elements.csvOutput.value = csv;
  elements.downloadCsvButton.disabled = !csv;
  elements.downloadCsvButton.dataset.filename = filename;
  elements.csvStatus.textContent = csv ? `${rowCount} CSV rows generated` : "No CSV rows generated";
}

export function getCsvOutput() {
  return elements.csvOutput.value;
}

export function renderMarketsForCurrentFilter() {
  const query = elements.playerSelect.value;
  elements.addToCsvButton.disabled = !query;

  if (!currentMarkets.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets found"));
    return;
  }

  if (!query) {
    elements.marketsList.replaceChildren(...currentMarkets.map(createMarketCard));
    return;
  }

  const grouped = groupOddsForPlayer(query, currentMarkets);

  if (!grouped.length) {
    elements.marketsList.replaceChildren(createEmptyState(`No odds found for "${query}"`));
    return;
  }

  elements.marketsList.replaceChildren(createPlayerGroupCard(query, grouped));
}

function renderPlayersDropdown(markets) {
  const players = extractPlayers(markets);
  const fragment = document.createDocumentFragment();
  fragment.append(new Option("All markets", ""));

  for (const player of players) {
    fragment.append(new Option(player, player));
  }

  elements.playerSelect.replaceChildren(fragment);
  elements.playerSelect.disabled = players.length === 0;

  if (!players.length) {
    elements.playerSelect.replaceChildren(new Option("No players detected", ""));
  }
}

function resetPlayers(label = "Choose an event first") {
  elements.playerSelect.disabled = true;
  elements.playerSelect.replaceChildren(new Option(label, ""));
}

function resetCsvOutput(label) {
  elements.generateCsvButton.disabled = true;
  elements.addToCsvButton.disabled = true;
  elements.downloadCsvButton.disabled = true;
  elements.downloadCsvButton.dataset.filename = "";
  elements.csvOutput.value = "";
  elements.csvStatus.textContent = label;
}

function extractPlayers(markets) {
  const players = new Map();
  const teamNames = new Set(
    [currentEvent?.homeTeam, currentEvent?.awayTeam]
      .filter(Boolean)
      .map(normalizeSearchText)
  );

  for (const market of markets) {
    if (market.marketName.includes(";")) continue;

    for (const odd of market.odds) {
      const candidates = [
        ...extractPlayerCandidates(market.marketName),
        ...extractPlayerCandidates(odd.name)
      ];

      for (const candidate of candidates) {
        const normalized = normalizeSearchText(candidate);

        if (!normalized || teamNames.has(normalized)) {
          continue;
        }

        players.set(normalized, candidate);
      }
    }
  }

  return Array.from(players.values()).sort((a, b) => a.localeCompare(b));
}

const PROP_WORDS = [
  "vise od",
  "manje od",
  "over",
  "under",
  "da postigne",
  "postize",
  "postiže",
  "asist",
  "karton",
  "suteva",
  "šuteva",
  "udaraca",
  "poena",
  "skokova"
];


function extractPlayerCandidates(text) {
  const candidates = [];
  const commaNamePattern = /\b((?:[\p{Lu}][\p{L}'.-]+\s+)?[\p{Lu}][\p{L}'.-]+),\s*([\p{Lu}][\p{L}'.-]+(?:-[\p{Lu}][\p{L}'.-]+)?)\b/gu;
  let match;

  while ((match = commaNamePattern.exec(text)) !== null) {
    candidates.push(`${match[1]}, ${match[2]}`);
  }

  const propWords = PROP_WORDS;

  for (const part of String(text).split(";")) {
    const clean = cleanCandidateText(part);
    const normalized = normalizeSearchText(clean);
    const hit = propWords
      .map((word) => normalized.indexOf(normalizeSearchText(word)))
      .filter((index) => index > 1)
      .sort((a, b) => a - b)[0];

    if (hit) {
      const candidate = clean.slice(0, hit).trim();

      if (isLikelyPlayerName(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function cleanCandidateText(value) {
  return String(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+([.,]\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPlayerName(value) {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-ZČĆŽŠĐA-Z][\p{L}',.-]+$/u.test(word));
}

function groupOddsForPlayer(query, markets) {
  const normalizedQuery = normalizeSearchText(query);
  const matches = [];

  for (const market of markets) {
    if (market.marketName.includes(";")) continue;

    for (const odd of market.odds) {
      const searchable = normalizeSearchText(`${market.marketName} ${odd.name}`);

      if (searchable.includes(normalizedQuery)) {
        matches.push({
          marketName: market.marketName,
          odd
        });
      }
    }
  }

  return matches;
}

function createPlayerGroupCard(query, matches) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const subtitle = document.createElement("p");
  const oddsList = document.createElement("div");

  card.className = "market-card player-results";
  title.className = "market-title";
  subtitle.className = "market-subtitle";
  oddsList.className = "player-odds-list";
  title.textContent = query;
  subtitle.textContent = `${matches.length} matching odds grouped by player`;
  oddsList.append(...matches.map(({ marketName, odd }) => createPlayerOddRow(marketName, odd)));
  card.append(title, subtitle, oddsList);

  return card;
}

function createPlayerOddRow(marketName, odd) {
  const row = document.createElement("div");
  const text = document.createElement("div");
  const market = document.createElement("span");
  const name = document.createElement("span");
  const addButton = document.createElement("button");
  const price = document.createElement("span");

  row.className = "player-odd-row";
  text.className = "player-odd-text";
  market.className = "player-odd-market";
  name.className = "player-odd-name";
  addButton.className = "add-odd-button";
  addButton.type = "button";
  addButton.title = "Add to CSV";
  addButton.textContent = "+";
  price.className = "player-odd-price";
  market.textContent = marketName;
  name.textContent = odd.name;
  price.textContent = Number.isFinite(odd.price) ? odd.price.toFixed(2) : "-";

  addButton.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("add-odd-to-csv", { detail: { marketName, odd, button: addButton } }));
  });

  text.append(market, name);
  row.append(text, addButton, price);

  return row;
}

function formatPlayerName(value) {
  const parts = String(value).split(",").map((part) => part.trim()).filter(Boolean);

  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  return String(value);
}


function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d");
}

function formatMatchName(event) {
  if (event.homeTeam && event.awayTeam) {
    return `${event.homeTeam} vs ${event.awayTeam}`;
  }

  return event.matchName;
}

function formatEventOption(event) {
  return `${event.matchDate} | ${formatMatchName(event)} | ${event.marketCount} markets`;
}

function createMarketCard(market) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const oddsGrid = document.createElement("div");

  card.className = "market-card";
  title.className = "market-title";
  oddsGrid.className = "odds-grid";
  title.textContent = market.marketName;
  oddsGrid.append(...market.odds.map((odd) => createOddButton(odd)));
  card.append(title, oddsGrid);

  return card;
}

function createOddButton(odd, contextText = "") {
  const button = document.createElement("button");
  const label = document.createElement("span");
  const price = document.createElement("span");

  button.className = "odd-button";
  button.type = "button";
  label.className = "odd-label";
  price.className = "odd-price";
  label.textContent = contextText ? `${contextText} - ${odd.name}` : odd.name;
  price.textContent = Number.isFinite(odd.price) ? odd.price.toFixed(2) : "-";
  button.append(label, price);

  return button;
}

function createEmptyState(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}
