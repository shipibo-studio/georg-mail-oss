import type { ReactNode } from "react";
import type { MessageKey } from "../i18n/translate";

/** One thing ⌘K can do: go somewhere, run an action or open what was found. */
export interface PaletteItem {
  id: string;
  group: MessageKey;
  label: string;
  icon: ReactNode;
  mono?: boolean;
  hint?: string;
  run(): void;
}
