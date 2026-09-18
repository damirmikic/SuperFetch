/**
 * The competitor bookmakers the Missing page checks Superbet against, and the
 * feed normalization both of them need.
 *
 * Order here is the order of the presence columns in the table.
 */
export const BOOKS = [
  { key: "merkur", label: "Merkurxtip", short: "MX" },
  { key: "balkanbet", label: "Balkan Bet", short: "BB" }
];

export function findBook(key) {
  return BOOKS.find((book) => book.key === key) ?? BOOKS[0];
}

/**
 * Both competitors mark a women's competition in the *league* name and leave
 * the team names alone - Merkur writes "Minnesota Lynx" in "WNBA", Balkanbet
 * writes "Engleska 1 (W)" - while Superbet marks the team itself,
 * "Minnesota Lynx (Z)". Left alone the two never pair, because the matcher
 * treats a women/men mismatch as a hard reject, so the marker is pushed down
 * onto the team names where the matcher can see it.
 *
 * Validated against every league name both books publish: it catches each
 * women's competition and flags no men's one. Two spellings it has already had
 * to grow for: "NWSL" (hence `n?wsl`, since `\bwsl\b` cannot match inside it)
 * and "Women’s Super League", whose apostrophe is U+2019, not an ASCII one.
 *
 * Merkur usually suffixes the team names itself ("Rio Ave W"), in which case
 * `applyWomenMarker` is a no-op and a gap in this pattern costs nothing - its
 * one exception is the WNBA, which it sends unmarked. Balkanbet never suffixes:
 * not one of its 131 women's fixtures carries a marker on the team, so there
 * the league name is the only signal and a gap silently breaks every pair in
 * that competition.
 *
 * Team sports only - see `womenFromLeague` in sports.js for why individual
 * sports must opt out.
 */
export const WOMEN_LEAGUE = /(^|[\s,.()-])(w|women|woman|zene|dame|feminin\w*)($|[\s,.0-9()'’-])|\bwnba\b|\bn?wsl\b/i;

export function applyWomenMarker(name, women) {
  if (!women || !name) {
    return name;
  }

  // Already carries its own marker - Merkur is inconsistent about this, writing
  // "Leeds Rhinos W" inside a league also named "Super League, Women".
  return /(^|\s)w$/i.test(name) ? name : `${name} W`;
}
