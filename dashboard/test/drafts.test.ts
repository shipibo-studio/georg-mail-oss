import { describe, expect, test } from "vitest";
import type { SavedDraft } from "../src/api/types";
import type { DraftFile } from "../src/lib/attachments";
import { draftInput, fromSavedDraft, isBlankDraft } from "../src/lib/drafts";
import { EMPTY_DRAFT } from "../src/lib/reply";

const file = (overrides: Partial<DraftFile>): DraftFile => ({
  key: "k",
  name: "a.pdf",
  sizeBytes: 10,
  uploadId: "upl_1",
  status: "ready",
  error: null,
  ...overrides,
});

describe("drafts", () => {
  test("a draft with nothing written is not worth keeping", () => {
    expect(isBlankDraft(EMPTY_DRAFT)).toBe(true);
    expect(isBlankDraft({ ...EMPTY_DRAFT, subject: "   ", text: "\n" })).toBe(true);
    expect(isBlankDraft({ ...EMPTY_DRAFT, to: ["a@b.cl"] })).toBe(false);
    expect(isBlankDraft({ ...EMPTY_DRAFT, text: "Hola" })).toBe(false);
    expect(isBlankDraft({ ...EMPTY_DRAFT, files: [file({})] })).toBe(false);
  });

  test("saves only files that finished uploading", () => {
    const draft = {
      ...EMPTY_DRAFT,
      to: ["a@b.cl"],
      subject: "x",
      files: [
        file({ uploadId: "upl_ok" }),
        file({ uploadId: null, status: "uploading" }),
        file({ status: "failed", uploadId: null }),
      ],
    };
    expect(draftInput(draft)).toEqual({
      to: ["a@b.cl"],
      cc: [],
      subject: "x",
      text: "",
      inReplyTo: null,
      attachments: ["upl_ok"],
    });
  });

  test("a kept draft opens with its fields and its files ready", () => {
    const saved: SavedDraft = {
      id: "drf_1",
      to: ["a@b.cl"],
      cc: ["c@d.cl"],
      subject: "Re: x",
      text: "Hola",
      inReplyTo: "msg_1",
      attachments: [{ id: "upl_1", filename: "plano.pdf", contentType: "application/pdf", sizeBytes: 42 }],
      createdAt: "2026-10-23T10:00:00.000Z",
      updatedAt: "2026-10-23T10:05:00.000Z",
    };
    expect(fromSavedDraft(saved)).toEqual({
      to: ["a@b.cl"],
      cc: ["c@d.cl"],
      subject: "Re: x",
      text: "Hola",
      inReplyTo: "msg_1",
      files: [{ key: "upl_1", name: "plano.pdf", sizeBytes: 42, uploadId: "upl_1", status: "ready", error: null }],
    });
  });
});
