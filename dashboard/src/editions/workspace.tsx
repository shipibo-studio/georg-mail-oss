// The open-source mail client has no workspace: no destinations, sections or ⌘K items of its own,
// and Notifications shows only the registered email. Replaces the hosted product's file of the
// same path when the mail client is exported (scripts/export-oss.mjs).
import type { NavItem } from "../components/nav-items";
import type { PaletteItem } from "../components/palette-item";
import type { Route } from "../lib/route";

export interface WorkspaceDestination extends NavItem {
  phoneTab?: boolean;
}

export const WORKSPACE_DESTINATIONS: WorkspaceDestination[] = [];

export function WorkspaceSection(_props: { route: Route; navigate(route: Route): void }) {
  return null;
}

const NO_ITEMS = { actions: [] as PaletteItem[], found: [] as PaletteItem[] };

export function useWorkspacePaletteItems(_open: boolean, _navigate: (route: Route) => void) {
  return NO_ITEMS;
}

export function NotificationChannelsExtra() {
  return null;
}
