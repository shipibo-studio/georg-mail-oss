---
name: install-georg-mail
description: Install Georg mail, the self-hosted mail client for one mailbox on your own domain, on a Cloudflare account from the command line. Use when someone asks an agent to set up, deploy or self-host Georg mail, or to move a domain's mail to it. Covers what the agent runs, what only the person may do (secrets, the Access policy, switching the domain's MX), and how to check each step.
---

# Install Georg mail

Georg mail runs as one Cloudflare Worker with D1, R2, Email Routing and Cloudflare Access, on Workers Free. This runbook installs it from the command line. The person may prefer the Deploy to Cloudflare button instead; then follow `docs/self-hosting.md` with them.

## Rules for the agent

- **Never ask for a secret in the chat, and never print one.** The person types secrets into `pnpm wrangler secret put NAME`, which prompts without echoing. Never write them to `wrangler.jsonc`, `.env` or any tracked file.
- **Switching the domain's mail is the person's decision.** Enabling Email Routing replaces the domain's MX records, and new mail stops reaching the current provider at once. Explain that, ask for an explicit yes, and let the person do it in the dashboard.
- **Access is not optional.** Never deploy without it, and never suggest an "Email domain" policy for a public provider (`gmail.com`, `outlook.com`): that lets in everyone with an address there.
- **Touch only this install.** Do not change other Workers, zones, Access applications or DNS records.
- **Check every step** with the command given before moving on.

## 1. Gather the facts (ask the person)

| What | Example | Why |
| --- | --- | --- |
| The domain, already active on their Cloudflare account | `example.com` | Email Routing and the custom domain need the zone in the same account |
| The mailbox address | `hello@example.com` | `PERSONAL_MAILBOX_ADDRESSES` |
| The subdomain for the app | `mail.example.com` | `PUBLIC_BASE_URL` and the Worker's custom domain |
| The email they will sign in with, **on another domain** | `them@gmail.com` | Access sends its code there; it must not depend on the mailbox being installed |
| A Resend account with the domain verified, or Mailtrap | | Sending; the person creates the API key |

Stop and help them first if the domain is not on Cloudflare (`pnpm wrangler whoami` shows the account; the zone must be **Active** in the dashboard).

## 2. Get the code and sign in

```sh
git clone https://github.com/shipibo-studio/georg-mail-oss.git georg-mail
cd georg-mail
pnpm install
pnpm wrangler login        # the person approves in the browser
pnpm wrangler whoami       # check: the right account
```

## 3. Create the database and the bucket

```sh
pnpm wrangler d1 create georg-mail          # prints a database_id
pnpm wrangler r2 bucket create georg-mail
```

In `wrangler.jsonc`:

- replace the placeholder `database_id` with the printed one;
- set `vars`: `MAIL_DOMAIN`, `PUBLIC_BASE_URL`, `PERSONAL_MAILBOX_ADDRESSES` (comma-separated, the mailbox first), `MAIL_PROVIDER` (`resend` or `mailtrap`);
- add the custom domain: `"routes": [{ "pattern": "mail.example.com", "custom_domain": true }]`;
- if the account already uses rate-limit namespace ids `4102`, `4104`, `4105` or `4106` in another Worker, change them to unused numbers.

Check: `pnpm typecheck` passes, and `git diff wrangler.jsonc` shows only those changes.

## 4. Deploy

```sh
pnpm run deploy            # builds the app, applies migrations to D1, deploys the Worker
```

Check: `pnpm wrangler d1 migrations list DB --remote` lists nothing left to apply, and `https://mail.example.com/dashboard` answers "The dashboard is not configured" (503). That 503 is expected until Access is set.

## 5. Cloudflare Access (the person, guided)

Walk them through `docs/self-hosting.md#put-it-behind-cloudflare-access`:

1. Zero Trust → Access → Applications → Add → Self-hosted, for `mail.example.com`.
2. Policy: Allow, include **Emails** → the sign-in address from step 1 (or **Cloudflare account** members).
3. They copy the team domain (`https://<team>.cloudflareaccess.com`) and the application's **AUD tag**.

Then they run, typing each value at the prompt:

```sh
pnpm wrangler secret put ACCESS_TEAM_DOMAIN
pnpm wrangler secret put ACCESS_AUD
```

Check: `pnpm wrangler secret list` shows both names, and opening `https://mail.example.com/dashboard` asks to sign in through Access.

## 6. Sending (the person creates the key)

Resend: Domains → the domain is **Verified**; API Keys → a key with sending access to that domain only. Then the person runs `pnpm wrangler secret put RESEND_API_KEY` (or `MAILTRAP_API_KEY`).

Check: `pnpm wrangler secret list` shows it.

## 7. Receiving: the MX switch (the person decides)

Explain: from this moment new mail for the domain comes to Georg mail and stops reaching the current provider. Suggest exporting the old mailbox first, since it can be imported later (Settings → Import). With an explicit yes, the person goes to their domain → Email → Email Routing → Get started, then Routing rules → Custom addresses → the mailbox address, action **Send to a Worker**, destination this Worker. They add one rule per address in `PERSONAL_MAILBOX_ADDRESSES`.

Check: Email Routing → Overview shows the rule as active.

## 8. First run and a real email

The person opens `https://mail.example.com/dashboard`, signs in, confirms the mailbox address and their name, and presses **Create the mailbox**. Then they send an email from another account, and reply to it from the app.

Check: the email shows in the inbox, and the reply arrives with SPF and DKIM passing (the recipient's "show original").

## 9. Optional: updates from the app

To update from the app (the version at the foot of the sidebar), the person creates a token that may write their copy's contents (GitHub fine-grained: Contents read and write, only that repository), then runs `pnpm wrangler secret put UPDATE_REPOSITORY` (`github.com/owner/repo`) and `pnpm wrangler secret put UPDATE_TOKEN`. See `docs/self-hosting.md#upgrading`.

## When something fails

Every error the app returns has a `code`; `docs/self-hosting.md#troubleshooting` says what each means. Read the Worker's logs with `pnpm wrangler tail` (they never contain the content of the mail).
