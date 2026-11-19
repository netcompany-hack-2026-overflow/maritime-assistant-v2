import { remainingDistanceNm, type VoyageForDistance } from "../sim/positions.js";

/**
 * Is the ship actually on its voyage? The stored status alone isn't enough:
 * it stays UNDERWAY after a ship has reached its destination (nothing closes
 * a voyage on arrival). So: underway AND still with sea to cover, by the same
 * remaining distance the rest of the app uses (live AIS when fresh).
 *
 * Nothing that talks to the outside world (reply drafts, notices, sending)
 * happens for a ship that isn't at sea.
 */

/** Closer to the destination than this counts as arrived, nm. */
export const ARRIVED_WITHIN_NM = 1;

export const NOT_AT_SEA_MESSAGE =
  "Το πλοίο δεν είναι πλέον σε ταξίδι (έφτασε στον προορισμό ή το ταξίδι έκλεισε), οπότε δεν βγαίνουν ούτε στέλνονται emails γι' αυτό.";

export function isAtSea(voyage: VoyageForDistance & { status: string }, now: Date = new Date()): boolean {
  return voyage.status === "UNDERWAY" && remainingDistanceNm(voyage, now) > ARRIVED_WITHIN_NM;
}
