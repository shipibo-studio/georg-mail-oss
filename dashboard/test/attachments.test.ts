import { describe, expect, test } from "vitest";
import { admitFiles, type DraftFile, filesProblem, uploadIds } from "../src/lib/attachments";

const LIMITS = { maxBytes: 100, maxFiles: 3 };
const draftFile = (overrides: Partial<DraftFile>): DraftFile => ({
  key: crypto.randomUUID(),
  name: "a.pdf",
  sizeBytes: 10,
  uploadId: "upl_1",
  status: "ready",
  error: null,
  ...overrides,
});
const picked = (name: string, size: number) => ({ name, size });

describe("composer files", () => {
  test("admits files in order while they fit", () => {
    const { admitted, problem } = admitFiles([], [picked("a", 40), picked("b", 50)], LIMITS);
    expect(admitted.map((file) => file.name)).toEqual(["a", "b"]);
    expect(problem).toBeNull();
  });

  test("stops at the total size, but still admits a smaller file after a large one", () => {
    const { admitted, problem } = admitFiles(
      [draftFile({ sizeBytes: 60 })],
      [picked("big", 50), picked("small", 30)],
      LIMITS,
    );
    expect(admitted.map((file) => file.name)).toEqual(["small"]);
    expect(problem).toBe("compose.filesTooLarge");
  });

  test("stops at the number of files, and refuses empty files", () => {
    expect(admitFiles([draftFile({}), draftFile({})], [picked("c", 1), picked("d", 1)], LIMITS)).toEqual({
      admitted: [picked("c", 1)],
      problem: "compose.tooManyFiles",
    });
    expect(admitFiles([], [picked("empty", 0)], LIMITS)).toEqual({ admitted: [], problem: "compose.fileEmpty" });
  });

  test("failed uploads do not count against the limits", () => {
    const failed = draftFile({ status: "failed", uploadId: null, sizeBytes: 90 });
    expect(admitFiles([failed, failed, failed], [picked("e", 90)], LIMITS).admitted).toHaveLength(1);
  });

  test("a draft sends only when every file is uploaded", () => {
    expect(filesProblem([draftFile({}), draftFile({ status: "uploading", uploadId: null })])).toBe(
      "compose.filesUploading",
    );
    expect(filesProblem([draftFile({ status: "failed", uploadId: null })])).toBe("compose.filesFailed");
    expect(filesProblem([draftFile({})])).toBeNull();
    expect(
      uploadIds([draftFile({ uploadId: "upl_a" }), draftFile({ uploadId: null }), draftFile({ uploadId: "upl_b" })]),
    ).toEqual(["upl_a", "upl_b"]);
  });
});
