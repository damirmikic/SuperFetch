const datetimeDisplay = document.querySelector("#datetime-display");
const datetimeFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade",
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit",
  hour12: false
});
function setKickoffTime(event) {
  if (!event?.matchDate) { datetimeDisplay.textContent = ""; return; }
  const date = new Date(event.matchDate.replace(" ", "T") + "Z");
  datetimeDisplay.textContent = Number.isNaN(date.getTime()) ? "" : datetimeFmt.format(date);
}

const elements = {
  select: document.querySelector("#competition-select"),
  eventSelect: document.querySelector("#event-select"),
  downloadCsvButton: document.querySelector("#download-csv-button"),
  csvOutput: document.querySelector("#csv-output"),
  csvPreviewPanel: document.querySelector("#csv-preview-panel"),
  csvPreviewContent: document.querySelector("#csv-preview-content"),
  csvPreviewStatus: document.querySelector("#csv-preview-status"),
  marketsList: document.querySelector("#markets-list"),
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  eventsStatus: document.querySelector("#events-status"),
  csvStatus: document.querySelector("#csv-status"),
  marketsStatus: document.querySelector("#markets-status"),
  marketTabs: document.querySelectorAll(".market-tab"),
  specijalFilter: document.querySelector("#specijali-filter"),
  specijalMin: document.querySelector("#specijali-min"),
  specijalMax: document.querySelector("#specijali-max"),
  specijalFilterClear: document.querySelector("#specijali-filter-clear")
};

let optionIndex = new Map();
let eventIndex = new Map();
let currentMarkets = [];
let currentEvent = null;
/** @type {"all"|"standard"|"statistika"|"specijali"|"home-players"|"away-players"} */
let activeMarketTab = "all";
let marketSearch = "";

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

export function setEventsLoading(competition) {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = `Loading events for ${competition.tournamentName}...`;
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Loading events...", ""));
}

export function setEventsError(error) {
  elements.eventsStatus.classList.add("is-error");
  elements.eventsStatus.textContent = error.message;
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Unable to load events", ""));
}

export function resetEvents() {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = "Choose a competition";
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Choose a competition first", ""));
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
  setKickoffTime(event);
  resetCsvOutput("Loading markets...");
  elements.marketsList.replaceChildren(createEmptyState("Loading markets...", "⏳"));
}

export function setMarketsError(error) {
  elements.marketsStatus.classList.add("is-error");
  elements.marketsStatus.textContent = error.message;
  currentMarkets = [];
  setKickoffTime(null);
  resetCsvOutput("Unable to generate CSV");
  elements.marketsList.replaceChildren(createEmptyState("Unable to load markets.", "⚠️"));
}

export function resetMarkets() {
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = "Choose an event";
  currentMarkets = [];
  currentEvent = null;
  setKickoffTime(null);
  resetCsvOutput("Choose an event first");
  elements.marketsList.replaceChildren(createEmptyState("Choose an event first", "📅"));
}


export function renderMarkets(markets) {
  currentMarkets = markets;
  marketSearch = "";
  document.querySelector("#market-search").value = "";
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = markets.length
    ? `${markets.length} markets loaded`
    : "No markets for selected event";

  if (!markets.length) {
    resetCsvOutput("No markets for CSV");
    elements.marketsList.replaceChildren(createEmptyState("No markets found", "🏟️"));
    return;
  }

  document.querySelector('[data-tab="home-players"]').textContent = currentEvent?.homeTeam || "Dom. igrači";
  document.querySelector('[data-tab="away-players"]').textContent = currentEvent?.awayTeam || "Gost. igrači";
  elements.csvStatus.textContent = "Use + buttons to add markets";
  renderMarketsForCurrentFilter();
}

export function renderCsvOutput(csv, filename, rowCount) {
  elements.csvOutput.value = csv;
  elements.downloadCsvButton.disabled = !csv;
  elements.downloadCsvButton.dataset.filename = filename;
  elements.csvStatus.textContent = csv ? `${rowCount} CSV rows generated` : "No CSV rows generated";
  elements.csvPreviewPanel.hidden = !csv;
  elements.csvPreviewContent.textContent = csv;
  elements.csvPreviewStatus.textContent = csv ? `${rowCount} rows` : "";
}

export function getCsvOutput() {
  return elements.csvOutput.value;
}

export function getMarginMultiplier() {
  const pct = parseFloat(document.querySelector("#margin-pct").value);
  if (!Number.isFinite(pct) || pct <= 0) return 1;
  const direction = document.querySelector('input[name="margin-dir"]:checked').value;
  return direction === "decrease" ? 1 - pct / 100 : 1 + pct / 100;
}

export function refreshDisplayedPrices() {
  const m = getMarginMultiplier();
  for (const el of document.querySelectorAll(".odd-price[data-original-price], .player-odd-price[data-original-price]")) {
    const orig = parseFloat(el.dataset.originalPrice);
    if (Number.isFinite(orig)) el.textContent = (orig * m).toFixed(2);
  }
}

export function renderMarketsForCurrentFilter() {
  if (!currentMarkets.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets found", "🏟️"));
    return;
  }

  const tabFiltered = filterMarketsByTab(currentMarkets, activeMarketTab);

  if (activeMarketTab === "home-players" || activeMarketTab === "away-players") {
    const side = activeMarketTab === "home-players" ? "home" : "away";
    const cards = createPlayerGroupCardsByTeam(tabFiltered, side, marketSearch);
    if (!cards.length) {
      elements.marketsList.replaceChildren(createEmptyState("No player props found", "👤"));
      return;
    }
    elements.marketsList.replaceChildren(...cards);
    return;
  }

  const searchNorm = normalizeSearchText(marketSearch);
  const visible = searchNorm
    ? tabFiltered.filter((m) => normalizeSearchText(m.marketName).includes(searchNorm))
    : tabFiltered;

  if (!visible.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets in this category", "🔍"));
    return;
  }

  elements.marketsList.replaceChildren(...visible.map(createMarketCard));
}

/**
 * Keywords that identify team-level "statistika" markets.
 * The match is done on the normalised (lowercased, diacritic-stripped) market name.
 * A market qualifies when ANY of these terms appears AND the market is not a combo (no ";")
 * AND is not a player-prop (i.e. it does NOT also match a player-prop word from PROP_WORDS).
 */
const STATISTIKA_KEYWORDS = [
  "korneri", "korner", "corner",
  "karton", "kartoni", "crveni karton", "zuti karton", "žuti karton",
  "faul", "faulovi",
  "ofsajd", "ofsajdi",
  "autogol", "auto gol", "own goal",
  "šut", "sut", "sutev", "šuteva", "udarac", "udarci",
  "šutevi na gol", "sutevi na gol", "šuteve u okvir", "suteve u okvir",
  "saves", "obrane", "odbrane",
  "ubačaj", "ubackaj", "throw-in",
  "slobodan udarac", "slobodni udarac",
];

/**
 * Filter markets based on the selected tab.
 * - "all"        → all markets
 * - "standard"   → no ";" and not a statistika market
 * - "statistika" → no ";" and matches at least one statistika keyword, not player-specific
 * - "specijali"  → contains ";"
 * @param {Array} markets
 * @param {"all"|"standard"|"statistika"|"specijali"} tab
 */
function filterMarketsByTab(markets, tab) {
  if (tab === "specijali") {
    const specijali = markets.filter((m) => m.marketName.includes(";"));
    const min = parseFloat(elements.specijalMin.value);
    const max = parseFloat(elements.specijalMax.value);
    if (Number.isNaN(min) && Number.isNaN(max)) return specijali;
    return specijali.filter((m) => m.odds.some((o) => {
      if (!Number.isFinite(o.price)) return false;
      if (!Number.isNaN(min) && o.price < min) return false;
      if (!Number.isNaN(max) && o.price > max) return false;
      return true;
    }));
  }
  if (tab === "all")       return markets;

  // Both "standard" and "statistika" start from non-combo markets
  const nonCombo = markets.filter((m) => !m.marketName.includes(";"));

  if (tab === "statistika") {
    return nonCombo.filter((m) => isStatistikaMarket(m.marketName));
  }

  if (tab === "standard") {
    return nonCombo.filter((m) => !isStatistikaMarket(m.marketName));
  }

  if (tab === "home-players") {
    return nonCombo.filter((m) => m.odds.some((o) => o.playerName && o.playerTeam === "home"));
  }

  if (tab === "away-players") {
    return nonCombo.filter((m) => m.odds.some((o) => o.playerName && o.playerTeam === "away"));
  }

  return markets;
}

/**
 * Returns true if the market name matches a team-level statistika keyword.
 * Player-prop markets that incidentally contain "šut" or "faul" etc. are excluded
 * by requiring the keyword to appear without a preceding likely-player-name token.
 */
function isStatistikaMarket(marketName) {
  const norm = normalizeSearchText(marketName);
  if (norm.includes("igrac")) return false;
  return STATISTIKA_KEYWORDS.some((kw) => norm.includes(normalizeSearchText(kw)));
}

/** Initialize tab-switching click listeners. Call once on startup. */
export function initMarketTabs() {
  for (const tab of elements.marketTabs) {
    tab.addEventListener("click", () => {
      activeMarketTab = tab.dataset.tab;

      for (const t of elements.marketTabs) {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      }

      elements.specijalFilter.hidden = activeMarketTab !== "specijali";
      renderMarketsForCurrentFilter();
    });
  }

  elements.specijalMin.addEventListener("input", renderMarketsForCurrentFilter);
  elements.specijalMax.addEventListener("input", renderMarketsForCurrentFilter);
  elements.specijalFilterClear.addEventListener("click", () => {
    elements.specijalMin.value = "";
    elements.specijalMax.value = "";
    renderMarketsForCurrentFilter();
  });

  const searchInput = document.querySelector("#market-search");
  searchInput.addEventListener("input", () => {
    marketSearch = searchInput.value.trim();
    renderMarketsForCurrentFilter();
  });
}


function resetCsvOutput(label) {
  elements.downloadCsvButton.disabled = true;
  elements.downloadCsvButton.dataset.filename = "";
  elements.csvOutput.value = "";
  elements.csvStatus.textContent = label;
  elements.csvPreviewPanel.hidden = true;
  elements.csvPreviewContent.textContent = "";
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


function resolvePlayerName(odd) {
  // playerName is sometimes a raw API ID like "sr:player:1347728" — fall back to odd.name
  if (odd.playerName && !String(odd.playerName).includes(":")) return odd.playerName;
  // odd.name format: "Lastname, Firstname - condition text"  — take only the name part
  const namePart = String(odd.name).split(" - ")[0].trim();
  const m = namePart.match(/^([\p{L}'.\-]+(?:\s[\p{L}'.\-]+)*),\s*([\p{L}'.\-]+(?:\s[\p{L}'.\-]+)*)$/u);
  return m ? `${m[1]}, ${m[2]}` : null;
}

function createPlayerGroupCardsByTeam(markets, team, search = "") {
  const playerMap = new Map();
  const searchNorm = normalizeSearchText(search);

  for (const market of markets) {
    for (const odd of market.odds) {
      if (!odd.playerName || odd.playerTeam !== team) continue;
      const playerName = resolvePlayerName(odd);
      if (!playerName) continue;
      const norm = normalizeSearchText(playerName);
      if (!playerMap.has(norm)) {
        playerMap.set(norm, { name: playerName, matches: [] });
      }
      playerMap.get(norm).matches.push({ marketName: market.marketName, odd });
    }
  }

  return Array.from(playerMap.values())
    .filter(({ name }) => !searchNorm || normalizeSearchText(formatPlayerName(name)).includes(searchNorm))
    .sort((a, b) => formatPlayerName(a.name).localeCompare(formatPlayerName(b.name)))
    .map(({ name, matches }) => createPlayerGroupCard(formatPlayerName(name), matches));
}

function createPlayerGroupCard(query, matches) {
  const card = document.createElement("article");
  const header = document.createElement("button");
  const headerText = document.createElement("div");
  const title = document.createElement("h3");
  const count = document.createElement("span");
  const chevron = document.createElement("span");
  const oddsList = document.createElement("div");

  card.className = "market-card player-results";
  header.className = "player-card-header";
  header.type = "button";
  headerText.className = "player-card-header-text";
  title.className = "market-title";
  count.className = "player-card-count";
  chevron.className = "player-card-chevron";
  oddsList.className = "player-odds-list";

  title.textContent = query;
  count.textContent = `${matches.length} odds`;
  chevron.textContent = "›";
  oddsList.append(...matches.map(({ marketName, odd }) => createPlayerOddRow(marketName, odd)));

  header.addEventListener("click", () => card.classList.toggle("is-expanded"));

  headerText.append(title, count);
  header.append(headerText, chevron);
  card.append(header, oddsList);

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
  price.dataset.originalPrice = odd.price;
  price.textContent = Number.isFinite(odd.price) ? (odd.price * getMarginMultiplier()).toFixed(2) : "-";

  addButton.addEventListener("click", () => {
    if (addButton.classList.contains("is-added")) {
      document.dispatchEvent(new CustomEvent("remove-odd-from-csv", { detail: { button: addButton } }));
    } else {
      document.dispatchEvent(new CustomEvent("add-odd-to-csv", { detail: { marketName, odd, button: addButton } }));
    }
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
  return formatMatchName(event);
}

function createMarketCard(market) {
  const card = document.createElement("article");
  const oddsGrid = document.createElement("div");
  const isCombo = market.marketName.includes(";");
  const isStatistika = !isCombo && isStatistikaMarket(market.marketName);

  card.className = isCombo ? "market-card market-card--combo" : "market-card";
  oddsGrid.className = "odds-grid";
  oddsGrid.append(...market.odds.map((odd) => createOddButton(odd, "", isCombo ? market.marketName : null)));

  if (isStatistika) {
    const titleArea = document.createElement("div");
    const title = document.createElement("h3");
    const addBtn = document.createElement("button");
    titleArea.className = "market-title-area";
    title.className = "market-title";
    title.textContent = market.marketName;
    addBtn.className = "add-odd-button";
    addBtn.type = "button";
    addBtn.title = "Add to CSV";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => {
      if (addBtn.classList.contains("is-added")) {
        document.dispatchEvent(new CustomEvent("remove-statistika-from-csv", { detail: { button: addBtn } }));
      } else {
        document.dispatchEvent(new CustomEvent("add-statistika-to-csv", { detail: { market, button: addBtn } }));
      }
    });
    titleArea.append(title, addBtn);
    card.append(titleArea, oddsGrid);
  } else {
    const title = document.createElement("h3");
    title.className = "market-title";
    title.textContent = market.marketName;
    card.append(title, oddsGrid);
  }

  return card;
}

function createOddButton(odd, contextText = "", comboMarketName = null) {
  const isCombo = comboMarketName !== null;
  const button = document.createElement("button");
  const label = document.createElement("span");
  const price = document.createElement("span");

  button.className = "odd-button";
  button.type = "button";
  label.className = "odd-label";
  price.className = "odd-price";
  label.textContent = contextText ? `${contextText} - ${odd.name}` : odd.name;
  price.dataset.originalPrice = odd.price;
  price.textContent = Number.isFinite(odd.price) ? (odd.price * getMarginMultiplier()).toFixed(2) : "-";
  button.append(label, price);

  if (!isCombo) return button;

  // Combo market: wrap the odd button with an add (+) button
  const addBtn = document.createElement("button");
  addBtn.className = "add-odd-button add-odd-button--inline";
  addBtn.type = "button";
  addBtn.title = "Add to CSV as Specijali";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => {
    if (addBtn.classList.contains("is-added")) {
      document.dispatchEvent(new CustomEvent("remove-specijal-from-csv", { detail: { button: addBtn } }));
    } else {
      document.dispatchEvent(new CustomEvent("add-specijal-to-csv", { detail: { marketName: comboMarketName, odd, button: addBtn } }));
    }
  });

  const wrapper = document.createElement("div");
  wrapper.className = "combo-odd-wrapper";
  wrapper.append(button, addBtn);
  return wrapper;
}

function createEmptyState(text, icon = "📋") {
  const empty = document.createElement("div");
  const iconEl = document.createElement("span");
  const textEl = document.createElement("span");
  empty.className = "empty-state";
  iconEl.className = "empty-icon";
  iconEl.textContent = icon;
  textEl.textContent = text;
  empty.append(iconEl, textEl);
  return empty;
}
