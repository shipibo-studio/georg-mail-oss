import { strToU8, zipSync } from "fflate";
import { expect, openInbox, row, test } from "./fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("opens a message with its detected code, verified sender and copy", async ({ page }) => {
  await openInbox(page);
  await row(page, "Your verification code").click();
  await expect(page).toHaveURL(/\/dashboard\/inbox\/msg_/);
  await expect(page.locator(".code-value")).toHaveText(/482\s*913/);
  await expect(page.locator(".sender-badge.verified")).toBeVisible();
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.locator(".code-card .btn.copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("482913");
  await expect(page.getByText("Code copied")).toBeVisible();
});

test("email HTML runs no code and loads no tracker until the owner asks", async ({ page, safety }) => {
  await openInbox(page);
  await row(page, "Hostile HTML").click();
  const frame = page.frameLocator("iframe.mail");
  await expect(frame.getByText("Hostile body")).toBeVisible();
  for (const tag of ["script", "form", "input", "iframe"]) await expect(frame.locator(tag)).toHaveCount(0);
  const handlers = await frame
    .locator("body *")
    .evaluateAll((elements) =>
      elements.flatMap((element) => element.getAttributeNames().filter((name) => name.startsWith("on"))),
    );
  expect(handlers).toEqual([]);
  // The only reports are the policy refusing the email's inline handlers while it was sanitized.
  expect((await safety.violations()).every((violation) => violation.startsWith("script-src-attr "))).toBe(true);
  await expect(frame.locator("a", { hasText: "Click" })).not.toHaveAttribute("href", /javascript:/);
  await expect(page.locator(".risk-banner.risk-high")).toBeVisible();
  await expect(page.locator(".sender-badge.unverified")).toBeVisible();
  expect(safety.externalRequests.filter((url) => url.includes("tracker.evil.test"))).toEqual([]);

  await page.getByRole("button", { name: "Load images" }).click();
  await expect.poll(() => safety.externalRequests.some((url) => url.includes("tracker.evil.test"))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
});

test("composes with recipient chips, validates and sends", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "New message" });
  await expect(composer).toBeVisible();
  const to = composer.locator(".chip-input input").first();
  await to.fill("not-an-address,");
  await expect(composer.locator(".recipient.bad")).toHaveText(/not-an-address/);
  await composer.getByLabel("Subject").fill("Hola Camila");
  await composer.locator("textarea").fill("¿Nos vemos el jueves?");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(composer.getByRole("alert")).toHaveText("not-an-address is not a valid address");

  await composer.getByRole("button", { name: "Remove not-an-address" }).click();
  await expect(composer.locator(".recipient.bad")).toHaveCount(0);
  await to.fill("Camila <camila@estudio.cl>;");
  await expect(composer.locator(".recipient")).toHaveText(/camila@estudio\.cl/);
  await page.keyboard.press("Meta+Enter");
  await expect(composer.getByText("Sent")).toBeVisible();
  await expect(page.getByText("Message sent")).toBeVisible();
  await expect(composer).toBeHidden();

  await page.getByRole("button", { name: "Sent" }).first().click();
  await expect(row(page, "Hola Camila")).toBeVisible();
});

test("attaches files, sends them, and keeps them with the Sent copy", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.locator(".chip-input input").first().fill("camila@estudio.cl,");
  await composer.getByLabel("Subject").fill("Cotización");
  await composer.locator("textarea").fill("Va adjunta.");
  await composer.getByTestId("attach-input").setInputFiles([
    { name: "cotizacion.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 cotización") },
    { name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
  ]);
  await expect(composer.locator(".file-chip.ready")).toHaveText(/cotizacion\.pdf/);
  await expect(composer.locator(".file-chip.failed")).toHaveText(/setup\.exe/);

  await composer.getByRole("button", { name: "Send" }).click();
  await expect(composer.getByRole("alert")).toHaveText("Remove the files that could not be uploaded");
  await composer.getByRole("button", { name: "Remove setup.exe" }).click();
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Message sent")).toBeVisible();
  await expect(composer).toBeHidden();

  await page.goto("/dashboard/sent");
  await row(page, "Cotización").click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: /cotizacion\.pdf/ })
    .first()
    .click();
  expect((await download).suggestedFilename()).toContain(".eml");
});

test("refuses files over the per-message limit, and accepts files dropped on the composer", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByTestId("attach-input").setInputFiles({
    name: "video.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  await expect(composer.getByRole("alert")).toHaveText("Attachments are limited to 5 MB per message");
  await expect(composer.locator(".file-chip")).toHaveCount(0);

  await composer.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["hola"], "notas.txt", { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    element.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(composer.locator(".file-chip.ready")).toHaveText(/notas\.txt/);
});

test("drafts save as you type, reopen from Drafts, and go away when sent", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.locator(".chip-input input").first().fill("camila@estudio.cl,");
  await composer.getByLabel("Subject").fill("Cotización pendiente");
  await composer.locator("textarea").fill("Te la envío mañana.");
  await expect(composer.getByText("Draft saved")).toBeVisible();
  await composer.getByRole("button", { name: "Discard" }).waitFor();
  await page.keyboard.press("Escape");

  // Gone from this tab: the draft is on the server, so a reload still has it.
  await page.reload();
  await page.locator(".sidebar").getByRole("button", { name: "Drafts" }).click();
  await expect(page).toHaveURL(/\/dashboard\/drafts$/);
  const draft = page.locator(".draft-row", { hasText: "Cotización pendiente" });
  await expect(draft).toContainText("To: camila@estudio.cl");
  await draft.locator(".draft-open").click();
  const reopened = page.getByRole("dialog", { name: "New message" });
  await expect(reopened.getByLabel("Subject")).toHaveValue("Cotización pendiente");
  await expect(reopened.locator("textarea")).toHaveValue("Te la envío mañana.");
  await reopened.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Message sent")).toBeVisible();
  await expect(page.getByText("No drafts")).toBeVisible();
});

test("discarding a draft deletes it, and an empty composer saves nothing", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "New message" });
  await page.waitForTimeout(1_800);
  await expect(composer.locator(".draft-status")).toHaveCount(0);
  await composer.getByLabel("Subject").fill("Mejor no");
  await expect(composer.getByText("Draft saved")).toBeVisible();
  await composer.getByRole("button", { name: "Discard" }).click();
  await page.goto("/dashboard/drafts");
  await expect(page.getByText("No drafts")).toBeVisible();
});

test("replies with the subject and the quoted original", async ({ page }) => {
  await openInbox(page);
  await row(page, "Propuesta para el sitio").click();
  await expect(page.getByRole("heading", { name: "Propuesta para el sitio de Georg" })).toBeVisible();
  await page.keyboard.press("r");
  const composer = page.getByRole("dialog", { name: "Reply" });
  await expect(composer.getByLabel("Subject")).toHaveValue("Re: Propuesta para el sitio de Georg");
  await expect(composer.locator("textarea")).toHaveValue(/> Hola Jorge,/);
  await expect(composer.locator(".recipient")).toHaveText(/camila@estudio\.cl/);
});

test("J and K move through the list, Escape goes back", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("j");
  const first = page.locator("button.msg").nth(0);
  await expect(first).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("j");
  await expect(page.locator("button.msg").nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(first).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await expect(page.getByText("Select a message")).toBeVisible();
});

test("Move to Trash takes the message out of the inbox, and Undo puts it back", async ({ page }) => {
  await openInbox(page);
  await row(page, "CI passed on main").click();
  await page.getByRole("button", { name: "Move to Trash (#)" }).click();
  await expect(row(page, "CI passed on main")).toHaveCount(0);
  const toast = page.locator(".toast", { hasText: "Moved to Trash" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone")).toBeVisible();
  await expect(row(page, "CI passed on main")).toBeVisible();
});

test("E archives, and Archive moves it back to the inbox", async ({ page }) => {
  await openInbox(page);
  await row(page, "CI passed on main").click();
  // Shortcuts act on the open message, so wait for it.
  await expect(page.locator(".subject-title")).toContainText("CI passed on main");
  await page.keyboard.press("e");
  await expect(page.locator(".toast", { hasText: "Archived" })).toBeVisible();
  await expect(row(page, "CI passed on main")).toHaveCount(0);

  await page.locator(".sidebar").getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL(/\/dashboard\/archive$/);
  await row(page, "CI passed on main").click();
  await page.getByRole("button", { name: "Move to Inbox" }).click();
  await expect(page.getByText("Message restored")).toBeVisible();
  await expect(page.getByText("Nothing archived")).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Inbox" }).click();
  await expect(row(page, "CI passed on main")).toBeVisible();
});

test("only Trash deletes for good, behind a press and hold", async ({ page }) => {
  await openInbox(page);
  await row(page, "CI passed on main").click();
  await expect(page.locator(".subject-title")).toContainText("CI passed on main");
  await expect(page.getByRole("button", { name: "Hold to delete forever" })).toHaveCount(0);
  await page.keyboard.press("#");
  await expect(row(page, "CI passed on main")).toHaveCount(0);

  await page.locator(".sidebar").getByRole("button", { name: "Trash" }).click();
  await expect(page.getByText("Deleted for good after 30 days")).toBeVisible();
  await row(page, "CI passed on main").click();
  const forever = page.getByRole("button", { name: "Hold to delete forever" });
  await forever.click();
  await expect(row(page, "CI passed on main")).toBeVisible();

  await forever.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_100);
  await page.mouse.up();
  await expect(page.getByText("Deleted forever")).toBeVisible();
  await expect(page.getByText("Trash is empty")).toBeVisible();
});

test("Restore takes a message out of Trash", async ({ page }) => {
  await openInbox(page);
  await row(page, "CI passed on main").click();
  await page.getByRole("button", { name: "Move to Trash (#)" }).click();
  await expect(row(page, "CI passed on main")).toHaveCount(0);
  await page.goto("/dashboard/trash");
  await row(page, "CI passed on main").click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Message restored")).toBeVisible();
  await expect(page.getByText("Trash is empty")).toBeVisible();
});

test("Spam says why a message is there, and Not spam returns it to the inbox", async ({ page }) => {
  await openInbox(page);
  await expect(row(page, "Your account is limited")).toHaveCount(0);
  await page.locator(".sidebar").getByRole("button", { name: "Spam" }).click();
  await expect(page).toHaveURL(/\/dashboard\/spam$/);
  await expect(page.getByText("Deleted for good after 30 days")).toBeVisible();
  await row(page, "Your account is limited").click();
  await expect(page.locator(".spam-banner")).toContainText("did not send this message (DMARC failed)");

  await page.getByRole("button", { name: "Not spam" }).click();
  await expect(page.getByText(/^Not spam\. This sender/)).toBeVisible();
  await expect(page.getByText("No spam")).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Inbox" }).click();
  await row(page, "Your account is limited").click();
  await expect(page.locator(".spam-banner")).toHaveCount(0);
});

test("! reports spam, the banner says so, and Undo brings it back", async ({ page }) => {
  await openInbox(page);
  await row(page, "CI passed on main").click();
  await expect(page.locator(".subject-title")).toContainText("CI passed on main");
  await page.keyboard.press("!");
  const toast = page.locator(".toast", { hasText: "Reported as spam" });
  await expect(toast).toBeVisible();
  await expect(row(page, "CI passed on main")).toHaveCount(0);

  await page.goto("/dashboard/spam");
  await row(page, "CI passed on main").click();
  await expect(page.locator(".spam-banner")).toContainText("You reported this message as spam.");
  await page.goto("/dashboard/inbox");
  await row(page, "Your verification code").click();
  await page.getByRole("button", { name: "Report spam (!)" }).click();
  await page.locator(".toast", { hasText: "Reported as spam" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone")).toBeVisible();
  await expect(row(page, "Your verification code")).toBeVisible();
});

test("sent mail cannot be reported as spam", async ({ page }) => {
  await page.goto("/dashboard/sent");
  await row(page, "Propuesta para el sitio").click();
  await expect(page.locator(".subject-title")).toContainText("Propuesta para el sitio");
  await expect(page.getByRole("button", { name: "Report spam (!)" })).toHaveCount(0);
});

test("/ searches mail ignoring case and accents, with the terms kept off the server", async ({ page }) => {
  await openInbox(page);
  const searchRequest = page.waitForRequest((request) => request.url().includes("/messages/search"));
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search mail" })).toBeFocused();
  await page.keyboard.type("SERA bloqueada");
  await page.keyboard.press("Enter");
  const request = await searchRequest;
  expect(request.method()).toBe("POST");
  expect(new URL(request.url()).search).toBe("");
  expect(request.postDataJSON()).toMatchObject({ q: "SERA bloqueada" });

  await expect(page).toHaveURL(/\/dashboard\/search#q=SERA\+bloqueada$/);
  await expect(page.locator(".folder-title")).toHaveText("Search");
  await expect(page.locator(".sidebar .folder.active")).toHaveCount(0);
  await expect(page.locator("button.msg")).toHaveCount(1);
  await row(page, "Urgente: confirme sus datos").click();
  await expect(page).toHaveURL(/\/dashboard\/search\/msg_\w+#q=SERA\+bloqueada$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dashboard\/search#q=SERA\+bloqueada$/);

  await page.getByRole("searchbox", { name: "Search mail" }).focus();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await expect(page.locator(".folder-title")).toHaveText("Inbox");
});

test("search covers Archive and Sent, marks archived results, and says when nothing matches", async ({ page }) => {
  await openInbox(page);
  await row(page, "Propuesta para el sitio de Georg").first().click();
  await expect(page.locator(".subject-title")).toContainText("Propuesta para el sitio");
  await page.keyboard.press("e");
  await expect(page.locator(".toast", { hasText: "Archived" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search mail" });
  await search.fill("propuesta");
  await search.press("Enter");
  await expect(page.locator("button.msg")).toHaveCount(2);
  await expect(row(page, "Re: Propuesta")).toBeVisible();
  await expect(page.locator("button.msg .chip", { hasText: "Archive" })).toHaveCount(1);

  await search.fill("zzzz");
  await search.press("Enter");
  await expect(page.getByText("No results")).toBeVisible();
  await expect(page.getByText("Nothing in your mail matches “zzzz”")).toBeVisible();
});

test("⌘K searches the mail for whatever was typed", async ({ page }) => {
  await openInbox(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("camila");
  await page.getByRole("option", { name: "Search mail for “camila”" }).click();
  await expect(page).toHaveURL(/\/dashboard\/search#q=camila$/);
  await expect(page.getByRole("searchbox", { name: "Search mail" })).toHaveValue("camila");
  await expect(page.locator("button.msg")).toHaveCount(2);
});

test("times are 24-hour by default, and 12-hour with AM/PM once chosen in Settings", async ({ page }) => {
  await openInbox(page);
  // A message from minutes ago shows its time of day.
  const time = row(page, "Your verification code").locator("time");
  await expect(time).toHaveText(/^\d{2}:\d{2}$/);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const clock = dialog.getByLabel("Time format");
  await expect(clock).toHaveValue("24h");
  await expect(clock.locator("option")).toHaveText(["24-hour (14:30)", "12-hour (2:30 PM)"]);
  await clock.selectOption("12h");
  await page.keyboard.press("Escape");
  await expect(time).toHaveText(/^\d{1,2}:\d{2}\s?[AP]M$/);

  await page.reload();
  await expect(row(page, "Your verification code").locator("time")).toHaveText(/[AP]M$/);
  await page.evaluate(() => localStorage.clear());
});

test("imports a Zoho export zip with dates kept, and skips what is already here", async ({ page }) => {
  const eml = (subject: string, id: string) =>
    strToU8(
      [
        "From: Camila Rojas <camila@estudio.cl>",
        "To: hello@example.com",
        `Subject: ${subject}`,
        "Date: Tue, 03 Mar 2020 10:15:00 -0300",
        `Message-ID: <${id}@zoho.test>`,
        "",
        "Correo antiguo.",
      ].join("\r\n"),
    );
  const zip = Buffer.from(
    zipSync({
      "Inbox/1.eml": eml("Cotización 2020", "one"),
      "Inbox/2.eml": eml("Contrato 2020", "two"),
      "Inbox/readme.txt": strToU8("not mail"),
    }),
  );
  const importZip = async () => {
    const dialog = page.getByRole("dialog", { name: "Import mail" });
    await dialog
      .getByTestId("import-input")
      .setInputFiles({ name: "zoho-inbox.zip", mimeType: "application/zip", buffer: zip });
    await expect(dialog.getByText("zoho-inbox.zip")).toBeVisible();
    await dialog.getByRole("button", { name: "Start import" }).click();
    return dialog;
  };

  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Import mail" }).click();
  let dialog = await importZip();
  await expect(dialog.getByText("Done: 2 messages imported.")).toBeVisible();
  const bar = dialog.getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-valuetext", "2 of 2 · 2 imported · 0 already here · 0 failed");
  await expect(bar).toHaveAttribute("aria-valuenow", "100");
  // Finished cleanly: a full, success-colored bar, the per-outcome counts, and no Stop.
  await expect(dialog.locator(".import-progress")).toHaveAttribute("data-tone", "done");
  await expect(dialog.locator(".import-percent")).toHaveText("100%");
  await expect(dialog.locator(".import-stat")).toHaveText(["2 imported", "0 already here", "0 failed"]);
  await expect(dialog.getByRole("button", { name: "Stop" })).toHaveCount(0);
  // The bar springs to full width.
  await expect
    .poll(
      async () =>
        ((await bar.locator(".progress-bar").boundingBox())?.width ?? 0) / ((await bar.boundingBox())?.width ?? 1),
    )
    .toBeGreaterThan(0.98);
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(row(page, "Cotización 2020")).toBeVisible();
  await expect(row(page, "Cotización 2020").locator("time")).toHaveText("3/3/20");
  await expect(row(page, "Cotización 2020")).not.toHaveClass(/unread/);

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("import mail");
  await page.keyboard.press("Enter");
  dialog = await importZip();
  await expect(dialog.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "2 of 2 · 0 imported · 2 already here · 0 failed",
  );
  await expect(dialog.locator(".import-stat")).toHaveText(["0 imported", "2 already here", "0 failed"]);
  await expect(page.locator("button.msg", { hasText: "Cotización 2020" })).toHaveCount(1);
});

test("imports an mbox into Sent", async ({ page }) => {
  const mbox = [
    "From hello@example.com Wed Mar  4 11:00:00 2020",
    "From: Georg <hello@example.com>",
    "To: ana@cliente.cl",
    "Subject: Propuesta enviada 2020",
    "Date: Wed, 04 Mar 2020 11:00:00 -0300",
    "Message-ID: <sent-1@zoho.test>",
    "",
    "Adjunto la propuesta.",
    "",
  ].join("\n");
  await page.goto("/dashboard/sent");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("import mail");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import mail" });
  await dialog
    .getByTestId("import-input")
    .setInputFiles({ name: "sent.mbox", mimeType: "application/mbox", buffer: Buffer.from(mbox) });
  await dialog.getByLabel("Put them in").selectOption("sent");
  await dialog.getByRole("button", { name: "Start import" }).click();
  await expect(dialog.getByText("Done: 1 message imported.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(row(page, "Propuesta enviada 2020")).toBeVisible();
});

test("settings say what is shared, show who is signed in and offer to sign out", async ({ page }) => {
  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.locator(".label", { hasText: "Appearance" })).toContainText("Mail and workspace");
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await expect(dialog.getByText("Delivery")).toHaveCount(0);
  await expect(dialog.locator(".signed-in .registered-email")).toHaveText("owner@example.org");
  const signOut = dialog.getByRole("link", { name: "Sign out" });
  await expect(signOut).toHaveAttribute("href", "/cdn-cgi/access/logout");
  await expect(signOut).toHaveClass(/btn/);
});

test("Notifications show the registered email and switch the forwarded copy", async ({ page }) => {
  await openInbox(page);
  await page.locator(".sidebar").getByRole("button", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);
  await expect(page.locator("p.registered-email")).toHaveText("owner@example.org");
  const forward = page.getByRole("switch", { name: "Forward a copy" });
  await expect(forward).toHaveAttribute("aria-checked", "true");
  await forward.click();
  await expect(forward).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/emails over 512 KB are kept without a preview/)).toBeVisible();
});

test("settings switch the language", async ({ page }) => {
  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Language").selectOption("es-419");
  await expect(page.getByRole("dialog", { name: "Ajustes" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Recibidos" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("georg-mail-locale"));
});

test("mail too large to preview offers its original", async ({ page }) => {
  await openInbox(page);
  await row(page, "Fotos del lanzamiento").click();
  await expect(page.getByText("Too large to preview")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".large-mail").getByRole("link", { name: "Download original (.eml)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.eml$/);
});

test("new mail slides in with a toast and updates the unread count", async ({ page }) => {
  await page.clock.install();
  await openInbox(page);
  await expect(page.locator(".folder .badge")).toHaveText("3");
  await page.request.post("/dashboard/api/__mock/arrive");
  // No polling: nothing changes until the owner refreshes.
  await page.clock.runFor(60_000);
  await expect(row(page, "GEO-42 moved to In review")).toHaveCount(0);
  const refresh = page.locator(".list").getByRole("button", { name: "Refresh" });
  await refresh.click();
  await expect(row(page, "GEO-42 moved to In review")).toBeVisible();
  await expect(page.getByText("New email from Linear")).toBeVisible();
  await expect(page.locator(".folder .badge")).toHaveText("4");
  await expect(page).toHaveTitle("(4) Georg mail");
});

test("the command palette refreshes what is on screen", async ({ page }) => {
  await openInbox(page);
  await page.request.post("/dashboard/api/__mock/arrive");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("refresh");
  await page.keyboard.press("Enter");
  await expect(row(page, "GEO-42 moved to In review")).toBeVisible();
});

test("the refresh button spins, then shows a check for a moment", async ({ page }) => {
  await page.clock.install();
  await openInbox(page);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  const refresh = page.locator(".list").getByRole("button", { name: "Refresh" });
  await expect(refresh).toHaveAttribute("aria-busy", "false");
  await refresh.click();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  // It keeps spinning for a minimum time even when the answer is instant.
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return refresh.getAttribute("class");
    })
    .toMatch(/refresh-done/);
  await page.clock.runFor(1_000);
  await expect(refresh).toHaveClass(/refresh-idle/);
});

test("accents are neon in dark mode and glow on solid accent elements", async ({ page }) => {
  await openInbox(page);
  // Both in the same tick: georg-ds 0.2.0 dropped the theme here, fixed in 0.2.1.
  await page.evaluate(() => {
    window.georgTheme.setTheme("dark");
    window.georgTheme.setAccent("green");
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const badge = page.locator(".folder .badge");
  await expect(badge).toHaveCSS("background-color", "rgb(124, 255, 0)");
  await expect(badge).not.toHaveCSS("box-shadow", "none");
  // Light mode keeps the hue deep enough to read on white.
  await page.evaluate(() => window.georgTheme.setTheme("light"));
  await expect(badge).toHaveCSS("background-color", "rgb(0, 117, 39)");
});

test("each sender has their own DiceBear face, the same in the list and the message", async ({ page }) => {
  await openInbox(page);
  const avatarIn = (text: string) => row(page, text).locator("img.avatar-sender");
  const acme = await avatarIn("Your verification code").getAttribute("src");
  const camila = await avatarIn("Propuesta para el sitio").getAttribute("src");
  expect(acme).toMatch(/^data:image\/svg\+xml/);
  expect(camila).not.toBe(acme);
  await row(page, "Your verification code").click();
  await expect(page.locator(".detail img.avatar-sender, main img.avatar-sender").first()).toHaveAttribute(
    "src",
    acme ?? "",
  );
});

test("a fresh self-hosted install asks its first visitor to create the mailbox, then opens it", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/fresh");
  await page.goto("/dashboard/inbox");
  const setup = page.getByRole("region", { name: "Set up your mailbox" });
  await expect(setup).toBeVisible();
  await expect(setup.getByText("You are signed in as owner@example.org.")).toBeVisible();
  await expect(setup.locator("output.setup-address")).toHaveText("hello@example.com");
  await setup.getByLabel("Your name").fill("Andalaosa");
  const forward = setup.getByRole("switch", { name: "Forward a copy" });
  await expect(forward).toHaveAttribute("aria-checked", "true");
  await forward.click();
  await setup.getByRole("button", { name: "Create the mailbox" }).click();

  await expect(page.locator("button.msg").first()).toBeVisible();
  await expect(page.locator(".sidebar .who")).toContainText("Andalaosa");
  await page.locator(".sidebar").getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("switch", { name: "Forward a copy" })).toHaveAttribute("aria-checked", "false");
});

test("setup says when someone else got there first", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/fresh");
  await page.goto("/dashboard/inbox");
  const setup = page.getByRole("region", { name: "Set up your mailbox" });
  await expect(setup).toBeVisible();
  // Another person finishes the setup while this page is open.
  await page.request.post("/dashboard/api/setup", { data: { address: "hello@example.com", forward: true } });
  await setup.getByRole("button", { name: "Create the mailbox" }).click();
  await expect(setup.getByRole("alert")).toHaveText(/Someone already set up this mail client/);
});

test("setup offers no copy when the visitor signed in on the mailbox's own domain", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/fresh-same-domain");
  await page.goto("/dashboard/inbox");
  const setup = page.getByRole("region", { name: "Set up your mailbox" });
  await expect(
    setup.getByText(/No copy of new mail: someone@example\.com is on a domain this mail client receives/),
  ).toBeVisible();
  await expect(setup.getByRole("switch")).toHaveCount(0);
  await setup.getByRole("button", { name: "Create the mailbox" }).click();
  await expect(page.locator("button.msg").first()).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("switch", { name: "Forward a copy" })).toHaveAttribute("aria-checked", "false");
});

/** An mbox of `count` messages, each with its own Message-ID. */
function mbox(count: number, prefix: string): Buffer {
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    lines.push(
      `From sender${index}@example.com Mon Jan  6 10:00:00 2020`,
      `From: Sender ${index} <sender${index}@example.com>`,
      "To: hello@example.com",
      `Subject: ${prefix} ${index}`,
      `Message-ID: <${prefix}-${index}@example.com>`,
      "",
      `Body ${index}`,
      "",
    );
  }
  return Buffer.from(lines.join("\n"));
}

async function startImport(page: import("@playwright/test").Page, file: Buffer, name: string) {
  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Import mail" }).click();
  const dialog = page.getByRole("dialog", { name: "Import mail" });
  await dialog.getByTestId("import-input").setInputFiles({ name, mimeType: "application/mbox", buffer: file });
  await dialog.getByRole("button", { name: "Start import" }).click();
  return dialog;
}

test("an import held back by the rate limit pauses, says when it resumes, and loses nothing", async ({ page }) => {
  let refusals = 2;
  await page.route("**/dashboard/api/mailbox/imports", async (route) => {
    if (refusals-- > 0) {
      return route.fulfill({
        status: 429,
        headers: { "Retry-After": "2", "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: "rate_limited", message: "Too many requests." } }),
      });
    }
    return route.continue();
  });
  const dialog = await startImport(page, mbox(4, "Paced"), "paced.mbox");
  await expect(dialog.getByText(/Paused by the server's rate limit · resumes in \d s/)).toBeVisible();
  await expect(dialog.locator(".import-progress")).toHaveAttribute("data-tone", "done", { timeout: 15_000 });
  await expect(dialog.locator(".import-stat")).toHaveText(["4 imported", "0 already here", "0 failed"]);
});

test("an import that ends with failures says so with an X and how to retry them", async ({ page }) => {
  let calls = 0;
  await page.route("**/dashboard/api/mailbox/imports", async (route) => {
    if (calls++ === 1) {
      return route.fulfill({
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: "internal_error", message: "Boom." } }),
      });
    }
    return route.continue();
  });
  const dialog = await startImport(page, mbox(3, "Partial"), "partial.mbox");
  const result = dialog.locator(".import-progress");
  await expect(result).toHaveAttribute("data-state", "done");
  await expect(result).toHaveAttribute("data-tone", "warn");
  await expect(dialog.locator(".import-stat.failed")).toHaveText("1 failed");
  await expect(dialog.getByText(/Import the same files again to retry the ones that failed/)).toBeVisible();
  // Centered, and the Close button no longer spans the dialog.
  const close = dialog.getByRole("button", { name: "Close" }).last();
  const closeBox = await close.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(closeBox && dialogBox && closeBox.width < dialogBox.width / 2).toBe(true);
  expect(
    closeBox && dialogBox && Math.abs(closeBox.x + closeBox.width / 2 - (dialogBox.x + dialogBox.width / 2)) < 4,
  ).toBe(true);
});

test("aliases: add one in Settings, reply from the alias the mail reached, and remove it", async ({ page }) => {
  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator(".alias-row")).toHaveCount(1);
  await expect(settings.locator(".alias-row").first()).toContainText("hello@example.com");
  await expect(settings.locator(".alias-row").first()).toContainText("Main");
  await settings.getByLabel("Address to add as an alias").selectOption("contact@example.com");
  await settings.getByRole("button", { name: "Add alias" }).click();
  await expect(page.getByText("contact@example.com now delivers here")).toBeVisible();
  await expect(settings.locator(".alias-row")).toHaveCount(2);
  await settings.getByRole("button", { name: "Close settings" }).click();

  // "Propuesta" reached contact@: the reply goes out from it.
  await row(page, "Propuesta para el sitio de Georg").first().click();
  await page.getByRole("button", { name: "Reply" }).first().click();
  const composer = page.getByRole("dialog", { name: "Reply" });
  const from = composer.getByLabel("From");
  await expect(from).toHaveValue("contact@example.com");
  await from.selectOption("hello@example.com");
  await from.selectOption("contact@example.com");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Message sent")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByRole("button", { name: "Remove contact@example.com" }).click();
  await expect(page.getByText("contact@example.com no longer receives mail")).toBeVisible();
  await expect(settings.locator(".alias-row")).toHaveCount(1);
});

test("sender avatars are faces by default, and initials once chosen in Settings, until changed back", async ({
  page,
}) => {
  await openInbox(page);
  const camila = row(page, "Propuesta para el sitio de Georg").first();
  await expect(camila.locator("img.avatar-sender")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByLabel("Sender avatars")).toHaveValue("faces");
  await settings.getByLabel("Sender avatars").selectOption("initials");
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(camila.locator(".avatar-initials")).toHaveText("CR");
  await expect(camila.locator("img.avatar-sender")).toHaveCount(0);

  // Kept in this browser.
  await page.reload();
  await expect(row(page, "Propuesta para el sitio de Georg").first().locator(".avatar-initials")).toHaveText("CR");

  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByLabel("Sender avatars").selectOption("faces");
  await expect(row(page, "Propuesta para el sitio de Georg").first().locator("img.avatar-sender")).toBeVisible();
});

test("display preferences follow the person to another browser", async ({ page, browser }, testInfo) => {
  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/dashboard/api/mailbox/preferences"),
  );
  await settings.getByLabel("Sender avatars").selectOption("initials");
  await settings.getByLabel("Time format").selectOption("12h");
  await saved;

  // A browser with nothing stored: the saved preferences apply as soon as the mailbox loads.
  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const fresh = await other.newPage();
  await fresh.goto("/dashboard/inbox");
  await expect(fresh.locator("button.msg .avatar-initials").first()).toBeVisible();
  await fresh.getByRole("button", { name: "Settings" }).click();
  await expect(fresh.getByRole("dialog", { name: "Settings" }).getByLabel("Time format")).toHaveValue("12h");
  // …and become this browser's cache for the next first paint.
  expect(await fresh.evaluate(() => localStorage.getItem("georg-mail.avatar-style"))).toBe("initials");
  await other.close();
});

test("a browser's own preferences are saved the first time, when the server has none", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("georg-mail.avatar-style", "initials"));
  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/dashboard/api/mailbox/preferences"),
  );
  await openInbox(page);
  expect((await saved).postDataJSON()).toMatchObject({ avatars: "initials" });
  const mailbox = await (await page.request.get("/dashboard/api/mailbox")).json();
  expect(mailbox.preferences).toMatchObject({ avatars: "initials" });
});

test("the import form: buttons as wide as their label, and a file picker reachable from the keyboard", async ({
  page,
}) => {
  await openInbox(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Import mail" }).click();
  const dialog = page.getByRole("dialog", { name: "Import mail" });
  const width = async (locator: ReturnType<typeof page.locator>) => (await locator.boundingBox())?.width ?? 0;
  const dialogWidth = await width(dialog);
  expect(await width(dialog.locator("label.import-files"))).toBeLessThan(dialogWidth / 2);
  expect(await width(dialog.getByRole("button", { name: "Start import" }))).toBeLessThan(dialogWidth / 3);

  // The picker is a real control: Tab reaches its input, and the label shows the focus.
  const input = dialog.getByTestId("import-input");
  for (let step = 0; step < 4 && !(await input.evaluate((node) => node === document.activeElement)); step++) {
    await page.keyboard.press("Tab");
  }
  await expect(input).toBeFocused();
  await expect(dialog.locator("label.import-files")).toHaveCSS("outline-style", "solid");
});

test("an install that is up to date says so in Settings, with no notice", async ({ page }) => {
  await openInbox(page);
  await expect(page.locator(".update-notice")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByText("Georg mail 0.1.0, up to date.")).toBeVisible();
});

test("a new release: the notice opens the review, which asks first, then copies the files and commits", async ({
  page,
}) => {
  await page.request.post("/dashboard/api/__mock/update-available");
  const stages: string[][] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/dashboard/api/updates/stage")) stages.push(request.postDataJSON().paths);
  });
  await openInbox(page);
  await page.getByRole("button", { name: "Version 0.2.0 is available" }).click();

  const dialog = page.getByRole("dialog", { name: "Update Georg mail" });
  await expect(dialog.getByText("45 files change in github.com/owner/mail (main). 2 files are removed.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Release notes" })).toHaveAttribute(
    "href",
    "https://github.com/shipibo-studio/georg-mail-oss/releases/tag/v0.2.0",
  );
  // Nothing is written before the owner confirms.
  expect(stages).toEqual([]);
  await dialog.getByRole("button", { name: "Update to 0.2.0" }).click();

  await expect(dialog.getByText(/0\.2\.0 is committed to github\.com\/owner\/mail \(main\)/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "See the commit" })).toHaveAttribute(
    "href",
    "https://github.com/owner/mail/commit/ddd",
  );
  // In batches the Worker can take within Workers Free's subrequest limit.
  expect(stages.map((paths) => paths.length)).toEqual([20, 20, 5]);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".update-notice")).toHaveCount(0);
});

test("a release that would overwrite the owner's own changes is left to a hand update", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/update-blocked");
  await openInbox(page);
  await page.getByRole("button", { name: "Version 0.2.0 is available" }).click();
  const dialog = page.getByRole("dialog", { name: "Update Georg mail" });
  await expect(dialog.getByText("src/worker/mail-app.ts")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Update to 0.2.0" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "How to update" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("without an update token, the notice leads to Settings and the hand update", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/update-manual");
  await openInbox(page);
  await page.getByRole("button", { name: "Version 0.2.0 is available" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByText("Georg mail 0.2.0 is available. This install has 0.1.0.")).toBeVisible();
  await expect(settings.getByRole("link", { name: "How to update" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Update…" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Update Georg mail" })).toHaveCount(0);
});
