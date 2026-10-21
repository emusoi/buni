import { createContext } from "react";
import type { Id } from "../../format/doc.ts";

/** Imported things by id → the file they live in; views badge them and keep them read-only. */
export const OwnersContext = createContext<Record<Id, string>>({});
