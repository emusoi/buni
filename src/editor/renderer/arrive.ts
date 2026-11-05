// Where a design opens when another design or Home sends you there: a page. And where a page is as a website.
import type { Id } from "buni/format/doc.ts";

export const ARRIVE = "buni.arrive";

export interface Arrival { page: Id }

export const isArrival = (v: unknown): v is Arrival => typeof v === "object" && v !== null && "page" in v && typeof v.page === "string";

/** The design at `file` as its website, opened at `page` (a take opens in its page's place), stepping through `flow`. */
export const siteHref = (file: string, page: Id, flow?: Id): string =>
  `/site${file.split("/").map(encodeURIComponent).join("/")}/?page=${encodeURIComponent(page)}${flow ? `&flow=${encodeURIComponent(flow)}` : ""}`;

/** Opens the website in its own tab, one per design, so ▷ again brings that tab back. */
export const openSiteTab = (file: string, page: Id, flow?: Id): void => void window.open(siteHref(file, page, flow), `buni-site-${file}`);
