/**
 * Which sports the Missing page compares, and how each one has to be matched.
 *
 * Adding a sport is one entry here - nothing else in the comparison flow is
 * sport-specific. The two fields that are not obvious:
 *
 * `timeToleranceMinutes` - how far apart the two books may quote the same
 * fixture. Team sports agree on the scheduled kickoff, so a tight window is
 * both enough and safer. Tennis does not have a scheduled start at all: play
 * begins when the previous match on that court ends, so the books' estimates
 * drift by over an hour. Measured on a full day's offer:
 *
 *     tennis      15min: 86/132   60min: 110/132   180min: 112/132
 *     basketball  15min: 32/38    60min: 33/38     180min: 33/38
 *     hockey      15min: 89/97    60min: 89/97     180min: 89/97
 *
 * A wide window buys the team sports nothing and only risks pairing two
 * different fixtures, hence the per-sport value.
 *
 * `womenFromLeague` - whether to push Merkur's league-level women's marker down
 * onto the team names. In team sports the same club fields a men's and a
 * women's side, so both books mark them and the marker must line up: Superbet
 * writes "Minnesota Lynx (Z)" where Merkur writes "Minnesota Lynx" in "WNBA".
 * In individual sports a name identifies the person outright - Superbet marks
 * none of its 187 tennis players - so copying the marker down would invent a
 * mismatch and reject 12 perfectly good pairs.
 *
 * `hasDraw` - only decides whether the table renders an X column. Every sport's
 * preselected Superbet market uses the same "1"/"X"/"2" outcome codes, so no
 * per-sport market id is needed.
 *
 * Verified but not enabled (pairing rate against a full day's offer, using
 * these same defaults - add an entry to switch one on):
 *
 *     rugby      merkur "R"   superbet 8    90%   hasDraw, team
 *     volleyball merkur "V"   superbet 1     -    no draw, team
 *     water polo merkur "W"   superbet 15  100%   hasDraw, team
 *     darts      merkur "D"   superbet 13  100%   no draw, individual
 *
 * Bandy (merkur "BA", 4 matches) has no identifiable Superbet sportId.
 *
 * Careful with the Merkur codes: "H" is ice hockey (KHL/VHL/DEL) and handball
 * is "HB". They are easy to swap, and neither errors - an unknown or wrong code
 * just returns a different sport's offer, which then pairs at roughly zero.
 */

export const COMPARISON_SPORTS = [
  {
    key: "soccer",
    label: "Fudbal",
    superbetSportId: 5,
    merkurCode: "S",
    hasDraw: true,
    womenFromLeague: true,
    timeToleranceMinutes: 15
  },
  {
    key: "basketball",
    label: "Kosarka",
    superbetSportId: 4,
    merkurCode: "B",
    hasDraw: false,
    womenFromLeague: true,
    timeToleranceMinutes: 15
  },
  {
    key: "handball",
    label: "Rukomet",
    superbetSportId: 11,
    merkurCode: "HB",
    hasDraw: true,
    womenFromLeague: true,
    timeToleranceMinutes: 15
  },
  {
    key: "hockey",
    label: "Hokej",
    superbetSportId: 3,
    merkurCode: "H",
    hasDraw: true,
    womenFromLeague: true,
    timeToleranceMinutes: 15
  },
  {
    key: "tennis",
    label: "Tenis",
    superbetSportId: 2,
    merkurCode: "T",
    hasDraw: false,
    womenFromLeague: false,
    timeToleranceMinutes: 180
  }
];

export const DEFAULT_SPORT_KEY = COMPARISON_SPORTS[0].key;

export function findSport(key) {
  return COMPARISON_SPORTS.find((sport) => sport.key === key) ?? COMPARISON_SPORTS[0];
}
