// Where new versions of the open-source mail client come from. Every release of
// shipibo-studio/georg-mail-oss is a tag vX.Y.Z whose tree holds release-manifest.json: each file of
// the release with its git blob id. Nothing here uses GitHub's REST API, whose 60 anonymous requests
// an hour are shared by every Worker behind the same egress address: the newest release comes from
// the redirect of /releases/latest, and files and manifests from raw.githubusercontent.com.
import { UPDATE_FETCH_TIMEOUT_MS } from "../config";
import { ApiError } from "../errors";

export const UPSTREAM_REPOSITORY = "shipibo-studio/georg-mail-oss";
export const RELEASES_URL = `https://github.com/${UPSTREAM_REPOSITORY}/releases`;
const RAW_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPOSITORY}`;
export const RELEASE_MANIFEST_PATH = "release-manifest.json";

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const LATEST_TAG = /\/releases\/tag\/v(\d{1,4}\.\d{1,4}\.\d{1,4})$/;
const BLOB_ID = /^[0-9a-f]{40}$/;
const FILE_MODES = new Set(["100644", "100755"]);
const MAX_PATH_LENGTH = 400;
const MAX_MANIFEST_FILES = 5_000;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/** Control characters, and the backslash some tools read as a separator. */
function hasUnsafeCharacter(path: string): boolean {
  return [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code < FIRST_PRINTABLE || code === DELETE || character === "\\";
  });
}

export interface ManifestFile {
  sha: string;
  mode: "100644" | "100755";
}

export interface ReleaseManifest {
  version: string;
  files: Record<string, ManifestFile>;
}

export function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. Invalid versions sort first. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [-1, -1, -1];
  const right = parseVersion(b) ?? [-1, -1, -1];
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`;

/**
 * A path an update may write: relative, without empty, `.` or `..` segments, outside `.git`, with
 * no control characters. Anything else in a manifest stops the update.
 */
export function isSafePath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH || path.startsWith("/") || hasUnsafeCharacter(path)) {
    return false;
  }
  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") && segments[0] !== ".git";
}

const upstreamUnavailable = () =>
  new ApiError("unavailable", "The release could not be read from GitHub.", {
    hint: "Try again in a few minutes. If it keeps failing, update by hand (docs/self-hosting.md, Upgrading).",
  });

async function fetchUpstream(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS) });
  } catch {
    throw upstreamUnavailable();
  }
}

/** The newest published version, or null while there is none. */
export async function fetchLatestVersion(): Promise<string | null> {
  const response = await fetchUpstream(`${RELEASES_URL}/latest`, { redirect: "manual" });
  if (response.status === 404) return null;
  const location = response.headers.get("Location") ?? "";
  const match = response.status >= 300 && response.status < 400 ? LATEST_TAG.exec(location) : null;
  // A redirect back to the release list means the repository has no release yet.
  if (!match) {
    if (location.replace(/\/$/, "") === RELEASES_URL) return null;
    throw upstreamUnavailable();
  }
  return match[1] ?? null;
}

export function parseManifest(value: unknown, version: string): ReleaseManifest {
  const invalid = () =>
    new ApiError("unavailable", `The manifest of version ${version} is not valid.`, {
      hint: "Update by hand this time (docs/self-hosting.md, Upgrading).",
    });
  if (!value || typeof value !== "object") throw invalid();
  const { version: declared, files } = value as { version?: unknown; files?: unknown };
  if (declared !== version || !files || typeof files !== "object" || Array.isArray(files)) throw invalid();
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_MANIFEST_FILES) throw invalid();
  const parsed: Record<string, ManifestFile> = {};
  for (const [path, file] of entries) {
    const { sha, mode } = (file ?? {}) as { sha?: unknown; mode?: unknown };
    if (!isSafePath(path) || typeof sha !== "string" || !BLOB_ID.test(sha) || typeof mode !== "string") throw invalid();
    if (!FILE_MODES.has(mode)) throw invalid();
    parsed[path] = { sha, mode: mode as ManifestFile["mode"] };
  }
  return { version, files: parsed };
}

export async function fetchManifest(version: string): Promise<ReleaseManifest> {
  if (!parseVersion(version)) throw new ApiError("validation_failed", "Not a version number.");
  const response = await fetchUpstream(`${RAW_URL}/v${version}/${RELEASE_MANIFEST_PATH}`);
  if (response.status === 404) {
    throw new ApiError("not_found", `Version ${version} has no release manifest.`, {
      hint: "Releases before the in-app update have none: update by hand once (docs/self-hosting.md, Upgrading).",
    });
  }
  if (!response.ok) throw upstreamUnavailable();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return parseManifest(body, version);
}

/** The id git gives a file's content: SHA-1 over "blob <size>\0" and the bytes. */
export async function gitBlobId(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const object = new Uint8Array(header.byteLength + bytes.byteLength);
  object.set(header);
  object.set(bytes, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", object));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One file of a release, checked against the manifest so nothing else can be written in its place. */
export async function fetchReleaseFile(version: string, path: string, expectedSha: string): Promise<Uint8Array> {
  const response = await fetchUpstream(`${RAW_URL}/v${version}/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (!response.ok) throw upstreamUnavailable();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await gitBlobId(bytes)) !== expectedSha) {
    throw new ApiError("unavailable", `${path} does not match the release manifest.`, {
      hint: "Try again later; if it keeps happening, update by hand and report it.",
    });
  }
  return bytes;
}
