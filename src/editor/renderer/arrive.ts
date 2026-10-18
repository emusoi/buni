// Where a design opens when another design or Home sends you there: a page, playing or not, and the flow to play.
import type { Id } from "buni/format/doc.ts";

export const ARRIVE = "buni.arrive";

export interface Arrival { page: Id; play: boolean; flow?: Id }

export const isArrival = (v: unknown): v is Arrival =>
  typeof v === "object" && v !== null && "page" in v && typeof v.page === "string" && "play" in v && typeof v.play === "boolean" && (!("flow" in v) || typeof v.flow === "string");

/** Asks the next design to open at `page`; kept for this tab only. */
export function arriveAt(a: Arrival): void {
  try { sessionStorage.setItem(ARRIVE, JSON.stringify(a)); } catch { /* the design opens at its start */ }
}
