import { FPL_CONFIG } from "./config.js";

const POSITION_BY_ELEMENT_TYPE = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

let cache = null;

export async function fetchFplData() {
  if (cache) return cache;

  const response = await fetch(`${FPL_CONFIG.baseUrl}/bootstrap-static/`, {
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`FPL API returned ${response.status}`);
  }

  const payload = await response.json();
  cache = normalizeFplData(payload);
  return cache;
}

function normalizeFplData(payload) {
  const teamsById = new Map();
  for (const team of payload.teams ?? []) {
    teamsById.set(team.id, {
      id: team.id,
      name: team.name,
      shortName: team.short_name
    });
  }

  const players = (payload.elements ?? []).map((element) => ({
    id: element.id,
    firstName: element.first_name,
    secondName: element.second_name,
    webName: element.web_name,
    teamId: element.team,
    teamName: teamsById.get(element.team)?.name ?? "",
    position: POSITION_BY_ELEMENT_TYPE[element.element_type] ?? "",
    status: element.status,
    news: element.news ?? ""
  }));

  return { players, teamsById };
}
