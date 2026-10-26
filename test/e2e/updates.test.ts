// In-app updates of the open-source mail client, through the real Worker: the newest release from
// GitHub, then plan, stage and apply against a GitHub or GitLab copy of the install. GitHub (the
// releases and the API) and GitLab are stand-ins that keep their state in memory.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS } from "../../src/worker/config";
import { DASHBOARD_REQUEST_HEADER } from "../../src/worker/dashboard/dashboard-session";
import { LATEST_RELEASE_JOB } from "../../src/worker/dashboard/update-routes";
import { createDatabase } from "../../src/worker/db/client";
import { jobCursors } from "../../src/worker/db/schema";
import mailWorker from "../../src/worker/mail-index";
import { INSTALLED_VERSION } from "../../src/worker/updates/installed-version";
import { gitBlobId, RELEASES_URL } from "../../src/worker/updates/releases";
import { ACCESS_CERTS_URL, accessJwk, accessToken, DASHBOARD_ORIGIN } from "../access-session";
import { BASE_URL, json } from "../mail-helpers";
import { type Owner, setupOwner } from "../mailbox-owner";

type Json = Record<string, unknown>;
type Files = Record<string, string>;

const db = createDatabase(env.DB);
const NEXT = "99.0.0";
const TOKEN = "github_pat_secret-token-value";
const RAW = "https://raw.githubusercontent.com/shipibo-studio/georg-mail-oss";
const encoder = new TextEncoder();

const FROM: Files = {
  "src/kept.ts": "kept\n",
  "src/changed.ts": "old\n",
  "src/removed.ts": "gone\n",
  "wrangler.jsonc": '{ "name": "georg-mail" }\n',
  "package.json": '{\n  "name": "georg-mail-oss",\n  "version": "0.1.0"\n}\n',
  ".github/workflows/ci.yml": "ci\n",
};
const TO: Files = {
  "src/kept.ts": "kept\n",
  "src/changed.ts": "new\n",
  "src/added.ts": "added\n",
  "wrangler.jsonc": '{ "name": "georg-mail" }\n',
  "package.json": `{\n  "name": "georg-mail-oss",\n  "version": "${NEXT}"\n}\n`,
  ".github/workflows/ci.yml": "ci 2\n",
};

const shaOf = (content: string) => gitBlobId(encoder.encode(content));

async function manifestOf(version: string, files: Files) {
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => [path, { sha: await shaOf(content), mode: "100644" }]),
  );
  return { version, files: Object.fromEntries(entries) };
}

/** What GitHub publishes: the latest release, and each release's manifest and files. */
const upstream = {
  latest: NEXT as string | null,
  releases: new Map<string, Files>(),
  tampered: new Set<string>(),
  latestLookups: 0,
  down: false,
};

/** The install's copy, on GitHub or GitLab. */
const repository = {
  head: "a".repeat(40),
  files: {} as Files,
  blobs: new Map<string, string>(),
  commits: [] as Json[],
  refUpdates: [] as Json[],
  refuseToken: false,
};

async function installTree() {
  return Promise.all(
    Object.entries(repository.files).map(async ([path, content]) => ({ path, content, sha: await shaOf(content) })),
  );
}

async function handleUpstream(url: URL): Promise<Response | null> {
  if (url.href === `${RELEASES_URL}/latest`) {
    upstream.latestLookups++;
    if (upstream.down) return new Response("down", { status: 503 });
    const location = upstream.latest ? `${RELEASES_URL}/tag/v${upstream.latest}` : RELEASES_URL;
    return new Response(null, { status: 302, headers: { Location: location } });
  }
  if (!url.href.startsWith(`${RAW}/v`)) return null;
  const [tag, ...rest] = url.pathname.split("/").slice(3);
  const version = tag?.slice(1) ?? "";
  const files = upstream.releases.get(version);
  const path = rest.map(decodeURIComponent).join("/");
  if (!files) return new Response("404", { status: 404 });
  if (path === "release-manifest.json") return Response.json(await manifestOf(version, files));
  const content = files[path];
  if (content === undefined) return new Response("404", { status: 404 });
  return new Response(upstream.tampered.has(path) ? `${content}tampered` : content);
}

async function handleGitHub(request: Request, url: URL): Promise<Response> {
  if (request.headers.get("Authorization") !== `Bearer ${TOKEN}` || repository.refuseToken) {
    return Response.json({ message: `Bad credentials for ${TOKEN}` }, { status: 401 });
  }
  const path = url.pathname.replace("/repos/acme/mail", "");
  if (path === "/git/ref/heads/main") return Response.json({ object: { sha: repository.head } });
  if (path.startsWith("/git/trees/") && request.method === "GET") {
    const tree = await installTree();
    return Response.json({
      truncated: false,
      tree: tree.map((file) => ({ path: file.path, type: "blob", sha: file.sha })),
    });
  }
  if (path.startsWith("/contents/")) return new Response(repository.files[decodeURIComponent(path.slice(10))]);
  if (path === "/git/blobs") {
    const { content } = (await request.json()) as { content: string };
    const text = atob(content);
    const sha = await shaOf(text);
    repository.blobs.set(sha, text);
    return Response.json({ sha }, { status: 201 });
  }
  if (path.startsWith("/git/commits/")) return Response.json({ tree: { sha: "b".repeat(40) } });
  if (path === "/git/trees") {
    repository.commits.push((await request.json()) as Json);
    return Response.json({ sha: "c".repeat(40) }, { status: 201 });
  }
  if (path === "/git/commits") {
    const body = (await request.json()) as Json;
    Object.assign(repository.commits.at(-1) ?? {}, { commit: body });
    return Response.json({ sha: "d".repeat(40), html_url: "https://github.com/acme/mail/commit/ddd" }, { status: 201 });
  }
  if (path === "/git/refs/heads/main" && request.method === "PATCH") {
    repository.refUpdates.push((await request.json()) as Json);
    return Response.json({});
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
}

async function handleGitLab(request: Request, url: URL): Promise<Response> {
  if (request.headers.get("PRIVATE-TOKEN") !== TOKEN) return Response.json({ message: "401" }, { status: 401 });
  const path = url.pathname.replace(`/api/v4/projects/${encodeURIComponent("acme/team/mail")}`, "");
  if (path === "/repository/branches/main") return Response.json({ commit: { id: repository.head } });
  if (path === "/repository/tree") {
    const tree = await installTree();
    const page = Number(url.searchParams.get("page"));
    const pageSize = 2;
    const entries = tree.slice((page - 1) * pageSize, page * pageSize);
    const next = page * pageSize < tree.length ? String(page + 1) : "";
    return Response.json(
      entries.map((file) => ({ path: file.path, type: "blob", id: file.sha })),
      { headers: { "X-Next-Page": next } },
    );
  }
  if (path.startsWith("/repository/files/")) {
    const file = decodeURIComponent(path.slice("/repository/files/".length).replace(/\/raw$/, ""));
    return new Response(repository.files[file]);
  }
  if (path === "/repository/commits" && request.method === "POST") {
    repository.commits.push((await request.json()) as Json);
    return Response.json(
      { id: "e".repeat(40), web_url: "https://gitlab.com/acme/team/mail/-/commit/eee" },
      { status: 201 },
    );
  }
  return Response.json({ message: "404" }, { status: 404 });
}

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.url === ACCESS_CERTS_URL) return Response.json({ keys: [accessJwk] });
    const fromUpstream = await handleUpstream(url);
    if (fromUpstream) return fromUpstream;
    if (url.hostname === "api.github.com") return handleGitHub(request, url);
    if (url.hostname === "gitlab.com") return handleGitLab(request, url);
    return realFetch(input, init);
  });
});

beforeEach(async () => {
  await db.delete(jobCursors).where(eq(jobCursors.name, LATEST_RELEASE_JOB));
  Object.assign(upstream, { latest: NEXT, latestLookups: 0, down: false, tampered: new Set() });
  upstream.releases = new Map([
    [INSTALLED_VERSION, { ...FROM, "package.json": FROM["package.json"]?.replace("0.1.0", INSTALLED_VERSION) ?? "" }],
    [NEXT, TO],
  ]);
  Object.assign(repository, {
    head: "a".repeat(40),
    blobs: new Map(),
    commits: [],
    refUpdates: [],
    refuseToken: false,
    // The Deploy button's copy: CI removed, its own name and configuration.
    files: {
      ...upstream.releases.get(INSTALLED_VERSION),
      "wrangler.jsonc": '{ "name": "acme-mail", "database_id": "real" }\n',
      "package.json": `{\n  "name": "acme-mail",\n  "version": "${INSTALLED_VERSION}"\n}\n`,
    },
  });
  delete repository.files[".github/workflows/ci.yml"];
});

const GITHUB = { UPDATE_REPOSITORY: "github.com/acme/mail", UPDATE_TOKEN: TOKEN };
const GITLAB = { UPDATE_REPOSITORY: "https://gitlab.com/acme/team/mail", UPDATE_TOKEN: TOKEN };

interface Call {
  method?: string;
  body?: unknown;
  member?: string | null;
  marker?: boolean;
  vars?: Partial<Env>;
}

async function call(owner: Owner, path: string, request: Call = {}): Promise<Response> {
  const method = request.method ?? (request.body === undefined ? "GET" : "POST");
  const headers = new Headers();
  const member = request.member === undefined ? owner.member : request.member;
  if (member) headers.set("Cf-Access-Jwt-Assertion", await accessToken(member));
  if (method !== "GET") {
    headers.set("Origin", DASHBOARD_ORIGIN);
    if (request.marker !== false) headers.set(DASHBOARD_REQUEST_HEADER, "1");
  }
  if (request.body !== undefined) headers.set("Content-Type", "application/json");
  const context = createExecutionContext();
  const response = await mailWorker.fetch(
    new Request(`${BASE_URL}/dashboard/api/updates${path}`, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    }),
    { ...env, ...request.vars } as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

/** The dashboard's whole flow: review, stage every file in batches, then commit. */
async function update(owner: Owner, vars: Partial<Env>) {
  const plan = await json<{ writes: string[]; stageBatch: number; head: string; canApply: boolean }>(
    await call(owner, "/plan", { body: { version: NEXT }, vars }),
  );
  for (let index = 0; index < plan.writes.length; index += plan.stageBatch) {
    const paths = plan.writes.slice(index, index + plan.stageBatch);
    expect((await call(owner, "/stage", { body: { version: NEXT, paths }, vars })).status).toBe(200);
  }
  return { plan, applied: await call(owner, "/apply", { body: { version: NEXT, head: plan.head }, vars }) };
}

describe("checking for a new release", () => {
  test("says what is installed, what is newest and where its notes are, and asks GitHub at most once a minute", async () => {
    const owner = await setupOwner();
    const status = await json(await call(owner, ""));
    expect(status).toMatchObject({
      installed: INSTALLED_VERSION,
      latest: { version: NEXT, url: `${RELEASES_URL}/tag/v${NEXT}` },
      available: true,
      checkFailed: false,
      repository: null,
    });
    await call(owner, "");
    expect(upstream.latestLookups).toBe(1);

    await db
      .update(jobCursors)
      .set({ updatedAt: Date.now() - UPDATE_CHECK_INTERVAL_MS - 1 })
      .where(eq(jobCursors.name, LATEST_RELEASE_JOB));
    upstream.latest = null;
    expect(await json(await call(owner, ""))).toMatchObject({ latest: null, available: false });
    expect(upstream.latestLookups).toBe(2);
  });

  test("a failed lookup keeps the last answer and says so", async () => {
    const owner = await setupOwner();
    await call(owner, "");
    await db.update(jobCursors).set({ updatedAt: 0 }).where(eq(jobCursors.name, LATEST_RELEASE_JOB));
    upstream.down = true;
    expect(await json(await call(owner, ""))).toMatchObject({ latest: { version: NEXT }, checkFailed: true });
  });

  test("shows which repository updates go to, once it is set up", async () => {
    const owner = await setupOwner();
    expect(await json(await call(owner, "", { vars: GITHUB }))).toMatchObject({
      repository: "github.com/acme/mail (main)",
    });
    expect(await json(await call(owner, "", { vars: { ...GITLAB, UPDATE_BRANCH: "production" } }))).toMatchObject({
      repository: "gitlab.com/acme/team/mail (production)",
    });
    expect(
      await json(await call(owner, "", { vars: { ...GITHUB, UPDATE_REPOSITORY: "evil.example/x/y" } })),
    ).toMatchObject({ repository: null });
  });
});

describe("updating a GitHub copy", () => {
  test("commits the release's changes on top of the branch, keeping the install's name and configuration", async () => {
    const owner = await setupOwner();
    const { plan, applied } = await update(owner, GITHUB);
    expect(plan).toMatchObject({
      canApply: true,
      writes: ["src/added.ts", "src/changed.ts"],
      deletes: 1,
      conflicts: [],
    });
    expect(applied.status).toBe(201);
    expect(await json(applied)).toEqual({
      commit: "d".repeat(40),
      url: "https://github.com/acme/mail/commit/ddd",
      version: NEXT,
    });

    const [tree] = repository.commits as { base_tree: string; tree: Json[]; commit: Json }[];
    expect(tree?.base_tree).toBe("b".repeat(40));
    expect(tree?.tree).toEqual([
      { path: "src/added.ts", mode: "100644", type: "blob", sha: await shaOf("added\n") },
      { path: "src/changed.ts", mode: "100644", type: "blob", sha: await shaOf("new\n") },
      { path: "src/removed.ts", mode: "100644", type: "blob", sha: null },
      {
        path: "package.json",
        mode: "100644",
        type: "blob",
        content: `{\n  "name": "acme-mail",\n  "version": "${NEXT}"\n}\n`,
      },
    ]);
    expect(tree?.commit).toMatchObject({ parents: ["a".repeat(40)] });
    expect(String(tree?.commit.message)).toContain(`update Georg mail to ${NEXT}`);
    expect(repository.refUpdates).toEqual([{ sha: "d".repeat(40), force: false }]);
    expect([...repository.blobs.values()].sort()).toEqual(["added\n", "new\n"]);
  });

  test("files the owner changed stop the update, and it says which", async () => {
    const owner = await setupOwner();
    repository.files["src/changed.ts"] = "my own change\n";
    const plan = await json(await call(owner, "/plan", { body: { version: NEXT }, vars: GITHUB }));
    expect(plan).toMatchObject({ canApply: false, conflicts: ["src/changed.ts"], conflictCount: 1 });
    const applied = await call(owner, "/apply", { body: { version: NEXT, head: repository.head }, vars: GITHUB });
    expect(applied.status).toBe(409);
    expect(repository.commits).toEqual([]);
  });

  test("a release that changes wrangler.jsonc is left to the owner", async () => {
    const owner = await setupOwner();
    upstream.releases.set(NEXT, { ...TO, "wrangler.jsonc": '{ "name": "georg-mail", "new": true }\n' });
    expect(await json(await call(owner, "/plan", { body: { version: NEXT }, vars: GITHUB }))).toMatchObject({
      canApply: false,
      configChanged: true,
    });
  });

  test("nothing is committed when the branch moved after the review", async () => {
    const owner = await setupOwner();
    const plan = await json<{ head: string }>(await call(owner, "/plan", { body: { version: NEXT }, vars: GITHUB }));
    repository.head = "f".repeat(40);
    const applied = await call(owner, "/apply", { body: { version: NEXT, head: plan.head }, vars: GITHUB });
    expect(applied.status).toBe(409);
    expect(repository.commits).toEqual([]);
  });

  test("only the release's own files, unaltered, can be staged", async () => {
    const owner = await setupOwner();
    const stage = (paths: string[]) => call(owner, "/stage", { body: { version: NEXT, paths }, vars: GITHUB });
    expect((await stage(["src/not-in-release.ts"])).status).toBe(400);
    expect((await stage(["../outside"])).status).toBe(400);
    expect((await stage(Array.from({ length: 21 }, (_, index) => `src/${index}.ts`))).status).toBe(400);
    upstream.tampered.add("src/added.ts");
    expect((await stage(["src/added.ts"])).status).toBe(503);
    expect(repository.blobs.size).toBe(0);
  });

  test("updates only go forward, to real versions", async () => {
    const owner = await setupOwner();
    for (const version of [INSTALLED_VERSION, "0.0.1", "latest", "1.2"]) {
      expect((await call(owner, "/plan", { body: { version }, vars: GITHUB })).status).toBe(400);
    }
  });

  test("a refused token is reported without the host's message or the token", async () => {
    const owner = await setupOwner();
    repository.refuseToken = true;
    const response = await call(owner, "/plan", { body: { version: NEXT }, vars: GITHUB });
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain("refused UPDATE_TOKEN");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Bad credentials");
  });

  test("a release without a manifest asks for an update by hand", async () => {
    const owner = await setupOwner();
    upstream.releases.delete(INSTALLED_VERSION);
    const response = await call(owner, "/plan", { body: { version: NEXT }, vars: GITHUB });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("update by hand");
  });
});

describe("updating a GitLab copy", () => {
  test("keeps the files until one commit carries them all, then lets them go", async () => {
    const owner = await setupOwner();
    const { applied } = await update(owner, GITLAB);
    expect(applied.status).toBe(201);
    const [commit] = repository.commits as { branch: string; actions: Json[] }[];
    expect(commit?.branch).toBe("main");
    expect(commit?.actions).toEqual([
      {
        action: "create",
        file_path: "src/added.ts",
        content: btoa("added\n"),
        encoding: "base64",
        execute_filemode: false,
      },
      {
        action: "update",
        file_path: "src/changed.ts",
        content: btoa("new\n"),
        encoding: "base64",
        execute_filemode: false,
      },
      { action: "delete", file_path: "src/removed.ts" },
      {
        action: "update",
        file_path: "package.json",
        content: `{\n  "name": "acme-mail",\n  "version": "${NEXT}"\n}\n`,
      },
    ]);
    expect((await env.MAIL_STORAGE.list({ prefix: "updates/" })).objects).toEqual([]);
  });

  test("a file that was never staged stops the commit", async () => {
    const owner = await setupOwner();
    const applied = await call(owner, "/apply", { body: { version: NEXT, head: repository.head }, vars: GITLAB });
    expect(applied.status).toBe(409);
    expect(repository.commits).toEqual([]);
  });
});

describe("who may update", () => {
  test("not set up: the review says how to set it up", async () => {
    const owner = await setupOwner();
    const response = await call(owner, "/plan", { body: { version: NEXT } });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("UPDATE_REPOSITORY");
  });

  test("only a signed-in member, from the dashboard", async () => {
    const owner = await setupOwner();
    expect((await call(owner, "", { member: null })).status).toBe(401);
    expect((await call(owner, "", { member: "stranger@example.test" })).status).toBe(403);
    const unmarked = await call(owner, "/plan", { body: { version: NEXT }, vars: GITHUB, marker: false });
    expect(unmarked.status).toBe(403);
    expect(upstream.latestLookups).toBe(0);
    expect(repository.commits).toEqual([]);
  });
});
