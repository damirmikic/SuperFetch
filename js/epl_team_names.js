const EPL_TEAM_NAME_ALIASES = {
  "arsenal": "Arsenal",
  "aston vila": "Aston Villa",
  "aston villa": "Aston Villa",
  "burnli": "Burnley",
  "burnley": "Burnley",
  "bournemut": "Bournemouth",
  "bournemouth": "Bournemouth",
  "brentford": "Brentford",
  "brajton": "Brighton",
  "brighton": "Brighton",
  "brighton and hove albion": "Brighton",
  "chelsi": "Chelsea",
  "chelsea": "Chelsea",
  "kristal palas": "Crystal Palace",
  "crystal palace": "Crystal Palace",
  "everton": "Everton",
  "fulam": "Fulham",
  "fulham": "Fulham",
  "liverpul": "Liverpool",
  "liverpool": "Liverpool",
  "lids junajted": "Leeds",
  "leeds": "Leeds",
  "leeds united": "Leeds",
  "man siti": "Man City",
  "mancester siti": "Man City",
  "manchester city": "Man City",
  "man city": "Man City",
  "man junajted": "Man Utd",
  "mancester junajted": "Man Utd",
  "manchester united": "Man Utd",
  "man utd": "Man Utd",
  "man united": "Man Utd",
  "njukasl": "Newcastle",
  "newcastle": "Newcastle",
  "newcastle united": "Newcastle",
  "notingem forest": "Nott'm Forest",
  "nottingham forest": "Nott'm Forest",
  "nott'm forest": "Nott'm Forest",
  "sanderlend": "Sunderland",
  "sunderland": "Sunderland",
  "totenhem": "Spurs",
  "tottenham": "Spurs",
  "tottenham hotspur": "Spurs",
  "spurs": "Spurs",
  "vest hem": "West Ham",
  "west ham": "West Ham",
  "west ham united": "West Ham",
  "vulverhempton": "Wolves",
  "wolverhampton": "Wolves",
  "wolverhampton wanderers": "Wolves",
  "wolves": "Wolves"
};

export function getEplTeamAlias(name) {
  return EPL_TEAM_NAME_ALIASES[normalizeTeamName(name)] || "";
}

export function normalizeTeamName(value) {
  return String(value || "")
    .replace(/[\u00a0\u2007\u2008\u2009\u202f\u205f\u3000]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bfc\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
