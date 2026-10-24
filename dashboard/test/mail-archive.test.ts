import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { collectMessages, splitMbox, zipEntries, zipEntry } from "../src/lib/mail-archive";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const MBOX = [
  "From camila@estudio.test Tue Mar  3 10:15:00 2020",
  "Subject: Uno",
  "",
  "Hola",
  ">From the start, quoted by mboxrd",
  ">>From twice",
  "",
  "From ana@cliente.test Wed Mar  4 11:00:00 2020",
  "Subject: Dos",
  "",
  "Chao",
  // mbox ends every message with a blank line, the last one too.
  "",
  "",
].join("\n");

describe("mbox", () => {
  test("splits at the From lines, dropping them and the blank line between messages", () => {
    const messages = splitMbox(strToU8(MBOX)).map(text);
    expect(messages).toEqual([
      "Subject: Uno\n\nHola\nFrom the start, quoted by mboxrd\n>From twice\n",
      "Subject: Dos\n\nChao\n",
    ]);
  });

  test("keeps CRLF messages intact and treats a file without From lines as one message", () => {
    const crlf = "From a@b.test Mon Jan 1 00:00:00 2024\r\nSubject: X\r\n\r\nBody\r\n\r\n";
    expect(splitMbox(strToU8(crlf)).map(text)).toEqual(["Subject: X\r\n\r\nBody\r\n"]);
    expect(splitMbox(strToU8("Subject: Solo\n\nBody")).map(text)).toEqual(["Subject: Solo\n\nBody"]);
    expect(splitMbox(new Uint8Array())).toEqual([]);
  });

  test("a body line that merely contains From is not a separator", () => {
    const mbox = "From a@b.test Mon\nSubject: X\n\nSent From my phone\n";
    expect(splitMbox(strToU8(mbox))).toHaveLength(1);
  });
});

describe("zip", () => {
  test("lists messages and mailboxes, skipping other files and macOS metadata", () => {
    const zip = zipSync({
      "Inbox/1.eml": strToU8("Subject: 1\n\nA"),
      "Inbox/2.EML": strToU8("Subject: 2\n\nB"),
      "Inbox/notes.txt": strToU8("not mail"),
      "__MACOSX/Inbox/._1.eml": strToU8("resource fork"),
      "all.mbox": strToU8(MBOX),
    });
    expect(zipEntries(zip).sort()).toEqual(["Inbox/1.eml", "Inbox/2.EML", "all.mbox"]);
    expect(text(zipEntry(zip, "Inbox/1.eml") ?? new Uint8Array())).toBe("Subject: 1\n\nA");
  });

  test("never inflates an entry larger than one message can be", () => {
    const zip = zipSync({ "bomb.eml": new Uint8Array(26 * 1024 * 1024), "ok.eml": strToU8("Subject: ok\n\n") });
    expect(zipEntries(zip)).toEqual(["ok.eml"]);
  });

  test("collects messages from zips, mboxes and loose files, reading each only when asked", async () => {
    const zip = zipSync({ "Inbox/1.eml": strToU8("Subject: 1\n\nA"), "box.mbox": strToU8(MBOX) });
    const files = [
      new File([zip], "zoho.zip"),
      new File([MBOX], "old.mbox"),
      new File(["Subject: suelto\n\n"], "suelto.eml"),
      new File(["ignored"], "photo.jpg"),
    ];
    const messages = await collectMessages(files);
    expect(messages.map((message) => message.label)).toEqual([
      "zoho.zip › Inbox/1.eml",
      "zoho.zip › box.mbox #1",
      "zoho.zip › box.mbox #2",
      "old.mbox #1",
      "old.mbox #2",
      "suelto.eml",
    ]);
    expect(text(await (messages[0]?.read() ?? Promise.resolve(new Uint8Array())))).toBe("Subject: 1\n\nA");
  });
});
