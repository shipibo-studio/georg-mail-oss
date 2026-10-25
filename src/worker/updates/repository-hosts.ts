// The install's own copy of the code, where an update lands as one commit; Workers Builds then
// deploys it. Two hosts, behind one interface: GitHub (the Deploy button's default) and GitLab. The
// token (UPDATE_TOKEN) only ever goes in a request header to the host, and the host's own error
// messages never reach the caller: they could echo the token's scopes or the repository's settings.
import { UPDATE_FETCH_TIMEOUT_MS } from "../config";
import { ApiError } from "../errors";
import type { FileWrite } from "./update-plan";

export interface InlineFile {
  path: string;
  content: string;
}

export interface CommitInput {
  parent: string;
  message: string;
  writes: FileWrite[];
  deletes: string[];
  inline: InlineFile[];
}

export interface StagedFile {
  path: string;
  sha: string;
  bytes: Uint8Array;
}

export interface RepositoryHost {
  /** For people: `github.com/owner/repo` and the branch. */
  readonly label: string;
  /** Files one stage request may carry, so it stays inside Workers Free's 50 subrequests. */
  readonly stageBatch: number;
  head(): Promise<string>;
  /** Blob id of every file at `commit`. */
  files(commit: string): Promise<Map<string, string>>;
  readText(path: string, commit: string): Promise<string>;
  /** Makes the release's files available to `commit`, by their blob ids. */
  stage(files: StagedFile[]): Promise<void>;
  commit(input: CommitInput): Promise<{ sha: string; url: string }>;
  /** Drops what `stage` kept outside the repository, once committed. */
  cleanUp(shas: string[]): Promise<void>;
}

interface RepositorySpec {
  kind: "github" | "gitlab";
  path: string;
}

const REPOSITORY = /^(?:https:\/\/)?(github\.com|gitlab\.com)\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)$/;
const GIT_SUFFIX = /(?:\.git)?\/?$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
export const DEFAULT_UPDATE_BRANCH = "main";
const GITHUB_API = "https://api.github.com";
const GITLAB_API = "https://gitlab.com/api/v4";
const GITLAB_TREE_PAGE_SIZE = 100;
const GITLAB_MAX_TREE_PAGES = 20;
const STAGED_PREFIX = "updates/blobs/";
const BASE64_CHUNK = 0x8000;
// Per file: GitHub reads it from the release and writes a blob (two subrequests); GitLab only reads it.
const GITHUB_STAGE_BATCH = 20;
const GITLAB_STAGE_BATCH = 40;

export function parseRepository(value: string): RepositorySpec | null {
  const match = REPOSITORY.exec(value.trim().replace(GIT_SUFFIX, ""));
  if (!match?.[1] || !match[2]) return null;
  const segments = match[2].split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  if (match[1] === "github.com" && segments.length !== 2) return null;
  return { kind: match[1] === "github.com" ? "github" : "gitlab", path: match[2] };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
}

function hostError(status: number, label: string): ApiError {
  if (status === 401 || status === 403) {
    return new ApiError("forbidden", `${label} refused UPDATE_TOKEN.`, {
      hint: "Check that the token has not expired and may read and write the repository's contents.",
    });
  }
  if (status === 404) {
    return new ApiError("not_found", `${label} was not found with UPDATE_TOKEN.`, {
      hint: "Check UPDATE_REPOSITORY and UPDATE_BRANCH, and that the token can see the repository.",
    });
  }
  if (status === 409 || status === 422) {
    return new ApiError("conflict", `${label} changed while updating.`, {
      hint: "Nothing was changed. Review the update again.",
    });
  }
  return new ApiError("unavailable", `${label} could not be reached.`, { hint: "Try again in a few minutes." });
}

function client(base: string, label: string, headers: Record<string, string>) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.body ? { "Content-Type": "application/json" } : {}) },
        signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw hostError(0, label);
    }
    if (!response.ok) throw hostError(response.status, label);
    return response;
  };
}

function gitHubHost(path: string, branch: string, token: string): RepositoryHost {
  const label = `github.com/${path}`;
  const call = client(`${GITHUB_API}/repos/${path}`, label, {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "georg-mail-updater",
  });
  const json = async <T>(response: Promise<Response>) => (await (await response).json()) as T;
  const post = <T>(path: string, body: unknown) => json<T>(call(path, { method: "POST", body: JSON.stringify(body) }));

  return {
    label: `${label} (${branch})`,
    stageBatch: GITHUB_STAGE_BATCH,
    async head() {
      return (await json<{ object: { sha: string } }>(call(`/git/ref/heads/${branch}`))).object.sha;
    },
    async files(commit) {
      const tree = await json<{ truncated: boolean; tree: { path: string; type: string; sha: string }[] }>(
        call(`/git/trees/${commit}?recursive=1`),
      );
      if (tree.truncated) throw new ApiError("unavailable", `${label} is too large to compare in one request.`);
      return new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
    },
    async readText(file, commit) {
      const encoded = file.split("/").map(encodeURIComponent).join("/");
      const response = await call(`/contents/${encoded}?ref=${commit}`, {
        headers: { Accept: "application/vnd.github.raw+json" },
      });
      return response.text();
    },
    async stage(files) {
      for (const file of files) {
        const blob = await post<{ sha: string }>("/git/blobs", { content: toBase64(file.bytes), encoding: "base64" });
        if (blob.sha !== file.sha) throw new ApiError("unavailable", `${label} stored ${file.path} differently.`);
      }
    },
    async commit(input) {
      const parent = await json<{ tree: { sha: string } }>(call(`/git/commits/${input.parent}`));
      const tree = await post<{ sha: string }>("/git/trees", {
        base_tree: parent.tree.sha,
        tree: [
          ...input.writes.map((file) => ({ path: file.path, mode: file.mode, type: "blob", sha: file.sha })),
          ...input.deletes.map((file) => ({ path: file, mode: "100644", type: "blob", sha: null })),
          ...input.inline.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })),
        ],
      });
      const commit = await post<{ sha: string; html_url: string }>("/git/commits", {
        message: input.message,
        tree: tree.sha,
        parents: [input.parent],
      });
      // Not forced: if the branch moved since the plan, this fails and nothing changes.
      await call(`/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return { sha: commit.sha, url: commit.html_url };
    },
    async cleanUp() {
      // Blobs nothing points to are collected by GitHub.
    },
  };
}

function gitLabHost(path: string, branch: string, token: string, storage: R2Bucket): RepositoryHost {
  const label = `gitlab.com/${path}`;
  const call = client(`${GITLAB_API}/projects/${encodeURIComponent(path)}`, label, { "PRIVATE-TOKEN": token });
  const json = async <T>(response: Promise<Response>) => (await (await response).json()) as T;
  const branchPath = `/repository/branches/${encodeURIComponent(branch)}`;
  const head = async () => (await json<{ commit: { id: string } }>(call(branchPath))).commit.id;

  return {
    label: `${label} (${branch})`,
    stageBatch: GITLAB_STAGE_BATCH,
    head,
    async files(commit) {
      const files = new Map<string, string>();
      for (let page = 1; page <= GITLAB_MAX_TREE_PAGES; page++) {
        const response = await call(
          `/repository/tree?ref=${commit}&recursive=true&per_page=${GITLAB_TREE_PAGE_SIZE}&page=${page}`,
        );
        const entries = (await response.json()) as { path: string; type: string; id: string }[];
        for (const entry of entries) if (entry.type === "blob") files.set(entry.path, entry.id);
        if (!response.headers.get("X-Next-Page")) return files;
      }
      throw new ApiError("unavailable", `${label} is too large to compare.`);
    },
    async readText(file, commit) {
      return (await call(`/repository/files/${encodeURIComponent(file)}/raw?ref=${commit}`)).text();
    },
    async stage(files) {
      // GitLab takes every file's content in the commit request: keep them until then, by blob id.
      for (const file of files) await storage.put(`${STAGED_PREFIX}${file.sha}`, file.bytes);
    },
    async commit(input) {
      // GitLab cannot check the parent itself: make sure the branch is still where the plan saw it.
      if ((await head()) !== input.parent) throw hostError(409, label);
      const writes = [];
      for (const file of input.writes) {
        const staged = await storage.get(`${STAGED_PREFIX}${file.sha}`);
        if (!staged) throw new ApiError("conflict", `${file.path} was not staged.`, { hint: "Run the update again." });
        writes.push({
          action: file.exists ? "update" : "create",
          file_path: file.path,
          content: toBase64(new Uint8Array(await staged.arrayBuffer())),
          encoding: "base64",
          execute_filemode: file.mode === "100755",
        });
      }
      const commit = await json<{ id: string; web_url: string }>(
        call("/repository/commits", {
          method: "POST",
          body: JSON.stringify({
            branch,
            commit_message: input.message,
            actions: [
              ...writes,
              ...input.deletes.map((file) => ({ action: "delete", file_path: file })),
              ...input.inline.map((file) => ({ action: "update", file_path: file.path, content: file.content })),
            ],
          }),
        }),
      );
      return { sha: commit.id, url: commit.web_url };
    },
    async cleanUp(shas) {
      if (shas.length > 0) await storage.delete(shas.map((sha) => `${STAGED_PREFIX}${sha}`));
    },
  };
}

export type UpdateEnv = Pick<Env, "UPDATE_REPOSITORY" | "UPDATE_BRANCH" | "UPDATE_TOKEN" | "MAIL_STORAGE">;

/** The install's repository, or null when the owner has not set UPDATE_REPOSITORY and UPDATE_TOKEN. */
export function repositoryHost(env: UpdateEnv): RepositoryHost | null {
  if (!env.UPDATE_REPOSITORY || !env.UPDATE_TOKEN) return null;
  const spec = parseRepository(env.UPDATE_REPOSITORY);
  const branch = env.UPDATE_BRANCH?.trim() || DEFAULT_UPDATE_BRANCH;
  if (!spec || !BRANCH.test(branch) || branch.includes("..")) {
    throw new ApiError("validation_failed", "UPDATE_REPOSITORY or UPDATE_BRANCH is not valid.", {
      hint: "Use github.com/owner/repo or gitlab.com/group/project, and a branch name such as main.",
    });
  }
  return spec.kind === "github"
    ? gitHubHost(spec.path, branch, env.UPDATE_TOKEN)
    : gitLabHost(spec.path, branch, env.UPDATE_TOKEN, env.MAIL_STORAGE);
}
