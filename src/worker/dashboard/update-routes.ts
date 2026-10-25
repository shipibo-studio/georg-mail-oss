// In-app updates of the open-source mail client. The dashboard asks whether a newer release exists;
// when the owner confirms, it reviews what changes (plan), copies the release's files into the
// install's repository a batch at a time (stage), and makes one commit (apply). Workers Builds then
// deploys that commit, applying new migrations first. Every step re-reads the releases from GitHub
// and the repository from its host, so nothing the browser sends decides which content is written.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { UPDATE_CHECK_INTERVAL_MS } from "../config";
import type { Database } from "../db/client";
import { jobCursors } from "../db/schema";
import { ApiError } from "../errors";
import type { MailEnv } from "../http/mail-env";
import { validate } from "../http/validation";
import { INSTALLED_VERSION } from "../updates/installed-version";
import {
  compareVersions,
  fetchLatestVersion,
  fetchManifest,
  fetchReleaseFile,
  parseVersion,
  releaseUrl,
} from "../updates/releases";
import { type RepositoryHost, repositoryHost } from "../updates/repository-hosts";
import { canApply, mergePackageManifest, PACKAGE_MANIFEST_PATH, planUpdate } from "../updates/update-plan";

/** Its row in job_cursors: the newest version seen ("" for none) and when it was looked up. */
export const LATEST_RELEASE_JOB = "latest-release";
const LISTED_CONFLICTS = 20;
const COMMIT_ID = /^[0-9a-f]{40}$/;

const versionSchema = z.string().refine((value) => parseVersion(value) !== null, "Not a version number.");
const planSchema = z.object({ version: versionSchema });
const stageSchema = z.object({ version: versionSchema, paths: z.array(z.string().max(400)).min(1).max(40) });
const applySchema = z.object({ version: versionSchema, head: z.string().regex(COMMIT_ID) });

interface LatestRelease {
  version: string | null;
  checkedAt: number;
}

/** The newest release, looked up at most once per interval; a failed lookup keeps the last answer. */
async function latestRelease(db: Database, now: number): Promise<LatestRelease & { failed: boolean }> {
  const [cached] = await db.select().from(jobCursors).where(eq(jobCursors.name, LATEST_RELEASE_JOB));
  if (cached && now - cached.updatedAt < UPDATE_CHECK_INTERVAL_MS) {
    return { version: cached.position || null, checkedAt: cached.updatedAt, failed: false };
  }
  try {
    const version = await fetchLatestVersion();
    await db
      .insert(jobCursors)
      .values({ name: LATEST_RELEASE_JOB, position: version ?? "", updatedAt: now })
      .onConflictDoUpdate({ target: jobCursors.name, set: { position: version ?? "", updatedAt: now } });
    return { version, checkedAt: now, failed: false };
  } catch {
    return { version: cached?.position || null, checkedAt: cached?.updatedAt ?? 0, failed: true };
  }
}

function requireHost(env: Env): RepositoryHost {
  const host = repositoryHost(env);
  if (!host) {
    throw new ApiError("unavailable", "In-app updates are not set up.", {
      hint: "Set UPDATE_REPOSITORY and the UPDATE_TOKEN secret (docs/self-hosting.md, Upgrading), or update by hand.",
    });
  }
  return host;
}

function requireNewer(version: string) {
  if (compareVersions(version, INSTALLED_VERSION) <= 0) {
    throw new ApiError("validation_failed", `Version ${version} is not newer than ${INSTALLED_VERSION}.`, {
      hint: "Updates only go forward.",
    });
  }
}

/** Compares the two releases with the repository as it is at `head`. */
async function reviewUpdate(host: RepositoryHost, version: string, head: string) {
  const [from, to, files] = await Promise.all([
    fetchManifest(INSTALLED_VERSION),
    fetchManifest(version),
    host.files(head),
  ]);
  return { plan: planUpdate(from, to, files), manifest: to };
}

export const updateRoutes = new Hono<MailEnv>()
  .get("/", async (context) => {
    const latest = await latestRelease(context.get("db"), Date.now());
    const available = latest.version !== null && compareVersions(latest.version, INSTALLED_VERSION) > 0;
    let repository: string | null = null;
    try {
      repository = repositoryHost(context.env)?.label ?? null;
    } catch {
      // A malformed UPDATE_REPOSITORY shows as not set up here; reviewing the update says why.
    }
    return context.json({
      installed: INSTALLED_VERSION,
      latest: latest.version ? { version: latest.version, url: releaseUrl(latest.version) } : null,
      available,
      checkedAt: latest.checkedAt || null,
      checkFailed: latest.failed,
      repository,
    });
  })

  .post("/plan", validate("json", planSchema), async (context) => {
    const { version } = context.req.valid("json");
    requireNewer(version);
    const host = requireHost(context.env);
    const head = await host.head();
    const { plan } = await reviewUpdate(host, version, head);
    return context.json({
      from: plan.from,
      to: plan.to,
      url: releaseUrl(plan.to),
      repository: host.label,
      head,
      canApply: canApply(plan),
      configChanged: plan.configChanged,
      conflicts: plan.conflicts.slice(0, LISTED_CONFLICTS),
      conflictCount: plan.conflicts.length,
      writes: plan.writes.map((file) => file.path),
      deletes: plan.deletes.length,
      stageBatch: host.stageBatch,
    });
  })

  .post("/stage", validate("json", stageSchema), async (context) => {
    const { version, paths } = context.req.valid("json");
    requireNewer(version);
    const host = requireHost(context.env);
    if (paths.length > host.stageBatch) {
      throw new ApiError("validation_failed", `At most ${host.stageBatch} files per request.`);
    }
    const manifest = await fetchManifest(version);
    const files = [];
    for (const path of new Set(paths)) {
      const file = manifest.files[path];
      if (!file) throw new ApiError("validation_failed", `${path} is not part of version ${version}.`);
      files.push({ path, sha: file.sha, bytes: await fetchReleaseFile(version, path, file.sha) });
    }
    await host.stage(files);
    return context.json({ staged: files.length });
  })

  .post("/apply", validate("json", applySchema), async (context) => {
    const { version, head } = context.req.valid("json");
    requireNewer(version);
    const host = requireHost(context.env);
    if ((await host.head()) !== head) {
      throw new ApiError("conflict", `${host.label} changed since the update was reviewed.`, {
        hint: "Review the update again.",
      });
    }
    const { plan, manifest } = await reviewUpdate(host, version, head);
    if (!canApply(plan)) {
      throw new ApiError("conflict", "This update cannot be applied in the app.", {
        hint: "Review it again: it changes wrangler.jsonc or files changed in your copy, so it needs a hand update.",
      });
    }
    const inline = [];
    const releasePackage = manifest.files[PACKAGE_MANIFEST_PATH];
    if (plan.mergePackage && releasePackage) {
      const [release, current] = await Promise.all([
        fetchReleaseFile(version, PACKAGE_MANIFEST_PATH, releasePackage.sha),
        host.readText(PACKAGE_MANIFEST_PATH, head),
      ]);
      inline.push({
        path: PACKAGE_MANIFEST_PATH,
        content: mergePackageManifest(new TextDecoder().decode(release), current),
      });
    }
    const commit = await host.commit({
      parent: head,
      message: `chore: update Georg mail to ${version}\n\nFrom ${plan.from}, applied from the mail client's settings.\nRelease notes: ${releaseUrl(version)}`,
      writes: plan.writes,
      deletes: plan.deletes,
      inline,
    });
    await host.cleanUp(plan.writes.map((file) => file.sha));
    return context.json({ commit: commit.sha, url: commit.url, version }, 201);
  });
