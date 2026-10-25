// What updating an install from one release to another changes in its repository. Pure: it compares
// the two releases' manifests with the blob ids of the install's own copy, so it can tell the files
// upstream changed from the ones the owner changed, and never overwrite the owner's work.
import { RELEASE_MANIFEST_PATH, type ReleaseManifest } from "./releases";

/** The install's own configuration: the Deploy button wrote its name, database id and variables into it. */
export const INSTALL_CONFIG_PATH = "wrangler.jsonc";
/** Taken from the release, keeping the install's name, which the Deploy button also chose. */
export const PACKAGE_MANIFEST_PATH = "package.json";
/** CI for the public repository: an install does not need it to deploy, and tokens rarely may write it. */
const SKIPPED_PREFIXES = [".github/"];

export interface FileWrite {
  path: string;
  sha: string;
  mode: "100644" | "100755";
  /** Whether the install has the file now (GitLab creates and updates with different actions). */
  exists: boolean;
}

export interface UpdatePlan {
  from: string;
  to: string;
  writes: FileWrite[];
  deletes: string[];
  /** The release changes package.json: the install's copy gets the release's, with its own name. */
  mergePackage: boolean;
  /** Files the owner changed (or removed) that the release also changes: an update would lose that work. */
  conflicts: string[];
  /** The release changes wrangler.jsonc, which only the owner can carry over to the install's copy. */
  configChanged: boolean;
}

const isSkipped = (path: string) =>
  path === RELEASE_MANIFEST_PATH || SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix));

export function planUpdate(from: ReleaseManifest, to: ReleaseManifest, install: Map<string, string>): UpdatePlan {
  const plan: UpdatePlan = {
    from: from.version,
    to: to.version,
    writes: [],
    deletes: [],
    mergePackage: false,
    conflicts: [],
    configChanged: false,
  };
  const paths = [...new Set([...Object.keys(from.files), ...Object.keys(to.files)])].sort();
  for (const path of paths) {
    const before = from.files[path];
    const after = to.files[path];
    if (before?.sha === after?.sha && before?.mode === after?.mode) continue;
    if (isSkipped(path)) continue;
    if (path === INSTALL_CONFIG_PATH) {
      plan.configChanged = true;
      continue;
    }
    if (path === PACKAGE_MANIFEST_PATH) {
      plan.mergePackage = after !== undefined;
      continue;
    }
    const current = install.get(path);
    // Already what the release has, unless the release only changes the file's mode.
    if (current === after?.sha && before?.sha !== after?.sha) continue;
    if (current !== before?.sha) {
      plan.conflicts.push(path);
      continue;
    }
    if (after) plan.writes.push({ path, sha: after.sha, mode: after.mode, exists: current !== undefined });
    else plan.deletes.push(path);
  }
  return plan;
}

export function canApply(plan: UpdatePlan): boolean {
  const changes = plan.writes.length + plan.deletes.length + (plan.mergePackage ? 1 : 0);
  return !plan.configChanged && plan.conflicts.length === 0 && changes > 0;
}

/** The release's package.json with the install's name, in the formatting the export writes. */
export function mergePackageManifest(release: string, install: string): string {
  const merged = JSON.parse(release) as Record<string, unknown>;
  const { name } = JSON.parse(install) as { name?: unknown };
  if (typeof name === "string" && name) merged.name = name;
  return `${JSON.stringify(merged, null, 2)}\n`;
}
