// The pure parts of in-app updates: versions, safe paths, release manifests, git blob ids, what an
// update changes in an install's copy, and which repositories it may write to.
import { describe, expect, test } from "vitest";
import {
  compareVersions,
  gitBlobId,
  isSafePath,
  parseManifest,
  parseVersion,
  type ReleaseManifest,
} from "../../src/worker/updates/releases";
import { parseRepository, toBase64 } from "../../src/worker/updates/repository-hosts";
import { canApply, mergePackageManifest, planUpdate } from "../../src/worker/updates/update-plan";

const sha = (character: string) => character.repeat(40);
const file = (character: string, mode: "100644" | "100755" = "100644") => ({ sha: sha(character), mode });

function manifest(version: string, files: Record<string, string>): ReleaseManifest {
  return { version, files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, file(value)])) };
}

describe("versions", () => {
  test("parse only plain major.minor.patch", () => {
    expect(parseVersion("1.12.3")).toEqual([1, 12, 3]);
    for (const value of ["v1.2.3", "1.2", "1.2.3-beta", "", "1.2.3.4", " 1.2.3"])
      expect(parseVersion(value)).toBeNull();
  });

  test("compare numerically, part by part", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("not", "0.0.1")).toBeLessThan(0);
  });
});

describe("paths an update may write", () => {
  test("relative paths inside the repository", () => {
    for (const path of ["src/worker/index.ts", "README.md", ".dev.vars.example", "a/.b/c"]) {
      expect(isSafePath(path)).toBe(true);
    }
  });

  test("nothing absolute, upward, empty, inside .git or with control characters", () => {
    const hostile = [
      "",
      "/etc/passwd",
      "../outside",
      "src/../../outside",
      "src//double",
      "./here",
      ".git/config",
      "src\\windows",
      `line${String.fromCodePoint(10)}break`,
      "x".repeat(401),
    ];
    for (const path of hostile) expect(isSafePath(path)).toBe(false);
  });
});

describe("release manifests", () => {
  const valid = { version: "0.2.0", files: { "src/a.ts": { sha: sha("a"), mode: "100644" } } };

  test("a valid one is kept as it is", () => {
    expect(parseManifest(valid, "0.2.0")).toEqual(valid);
  });

  test("anything off is refused", () => {
    const broken = [
      null,
      "text",
      { ...valid, version: "0.3.0" },
      { version: "0.2.0", files: {} },
      { version: "0.2.0", files: [] },
      { version: "0.2.0", files: { "../x": { sha: sha("a"), mode: "100644" } } },
      { version: "0.2.0", files: { "src/a.ts": { sha: "short", mode: "100644" } } },
      { version: "0.2.0", files: { "src/a.ts": { sha: sha("A"), mode: "100644" } } },
      { version: "0.2.0", files: { "src/a.ts": { sha: sha("a"), mode: "120000" } } },
      { version: "0.2.0", files: { "src/a.ts": null } },
    ];
    for (const value of broken) expect(() => parseManifest(value, "0.2.0")).toThrow(/not valid/);
  });
});

describe("git blob ids", () => {
  test("match git's own", async () => {
    // `printf 'hello\n' | git hash-object --stdin` and `git hash-object /dev/null`.
    expect(await gitBlobId(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(await gitBlobId(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("what an update changes", () => {
  const from = manifest("0.1.0", {
    "same.ts": "a",
    "changed.ts": "b",
    "removed.ts": "c",
    "mine.ts": "d",
    "wrangler.jsonc": "e",
    "package.json": "f",
    ".github/workflows/ci.yml": "1",
  });
  const to = manifest("0.2.0", {
    "same.ts": "a",
    "changed.ts": "2",
    "added.ts": "3",
    "mine.ts": "4",
    "wrangler.jsonc": "e",
    "package.json": "5",
    ".github/workflows/ci.yml": "6",
    "release-manifest.json": "7",
  });
  const install = new Map([
    ["same.ts", sha("a")],
    ["changed.ts", sha("b")],
    ["removed.ts", sha("c")],
    ["mine.ts", sha("9")],
    ["wrangler.jsonc", sha("8")],
    ["package.json", sha("8")],
  ]);

  test("writes and deletes what upstream changed, and keeps the owner's own changes as conflicts", () => {
    const plan = planUpdate(from, to, install);
    expect(plan.writes).toEqual([
      { path: "added.ts", sha: sha("3"), mode: "100644", exists: false },
      { path: "changed.ts", sha: sha("2"), mode: "100644", exists: true },
    ]);
    expect(plan.deletes).toEqual(["removed.ts"]);
    expect(plan.conflicts).toEqual(["mine.ts"]);
    expect(plan.mergePackage).toBe(true);
    expect(plan.configChanged).toBe(false);
    expect(canApply(plan)).toBe(false);
  });

  test("skips CI and the manifest, and leaves alone what is already up to date", () => {
    const upToDate = new Map([...install, ["mine.ts", sha("4")], ["added.ts", sha("3")]]);
    const plan = planUpdate(from, to, upToDate);
    expect(plan.writes.map((write) => write.path)).toEqual(["changed.ts"]);
    expect(plan.conflicts).toEqual([]);
    expect(canApply(plan)).toBe(true);
  });

  test("a file the owner deleted, or added where upstream now adds one, is a conflict", () => {
    const owner = new Map(install);
    owner.delete("changed.ts");
    owner.set("added.ts", sha("0"));
    owner.set("mine.ts", sha("d"));
    expect(planUpdate(from, to, owner).conflicts).toEqual(["added.ts", "changed.ts"]);
  });

  test("a release that changes wrangler.jsonc needs the owner's hand", () => {
    const plan = planUpdate(from, { ...to, files: { ...to.files, "wrangler.jsonc": file("f") } }, install);
    expect(plan.configChanged).toBe(true);
    expect(canApply(plan)).toBe(false);
  });

  test("a mode change alone is written, and nothing to do cannot be applied", () => {
    const executable = manifest("0.2.0", { "same.ts": "a" });
    executable.files["same.ts"] = file("a", "100755");
    expect(
      planUpdate(manifest("0.1.0", { "same.ts": "a" }), executable, new Map([["same.ts", sha("a")]])).writes,
    ).toEqual([{ path: "same.ts", sha: sha("a"), mode: "100755", exists: true }]);
    expect(canApply(planUpdate(from, { ...from, version: "0.1.1" }, install))).toBe(false);
  });
});

describe("package.json", () => {
  test("is the release's, with the install's name", () => {
    const merged = mergePackageManifest('{"name":"georg-mail-oss","version":"0.2.0"}', '{"name":"aurora-mail"}');
    expect(merged).toBe('{\n  "name": "aurora-mail",\n  "version": "0.2.0"\n}\n');
    expect(JSON.parse(mergePackageManifest('{"name":"a"}', "{}")).name).toBe("a");
  });
});

describe("repositories updates may write to", () => {
  test("GitHub and GitLab, in the forms people paste", () => {
    expect(parseRepository("github.com/acme/mail")).toEqual({ kind: "github", path: "acme/mail" });
    expect(parseRepository("https://github.com/acme/mail.git")).toEqual({ kind: "github", path: "acme/mail" });
    expect(parseRepository(" https://gitlab.com/acme/team/mail/ ")).toEqual({ kind: "gitlab", path: "acme/team/mail" });
  });

  test("no other host, and nothing that walks out of the repository", () => {
    for (const value of [
      "https://evil.example/acme/mail",
      "http://github.com/acme/mail",
      "github.com/acme",
      "github.com/acme/mail/extra",
      "gitlab.com/acme/../mail",
      "github.com/acme/mail?x=1",
      "",
    ]) {
      expect(parseRepository(value)).toBeNull();
    }
  });

  test("files go to the host in base64, whatever their size", () => {
    expect(toBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
    const large = new Uint8Array(100_000).map((_, index) => index % 251);
    expect(atob(toBase64(large)).length).toBe(large.length);
  });
});
