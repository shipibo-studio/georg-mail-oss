# Self-hosting

This guide takes you from nothing to reading your domain's mail at `https://mail.example.com`. Replace `example.com`, `mail.example.com` and `hello@example.com` with your own domain, subdomain and address everywhere.

It takes about 30 minutes. Everything fits Cloudflare's and Resend's free plans.

1. [Before you start](#before-you-start)
2. [Deploy](#deploy)
3. [Configure the Worker](#configure-the-worker)
4. [Give it a subdomain](#give-it-a-subdomain)
5. [Put it behind Cloudflare Access](#put-it-behind-cloudflare-access)
6. [Send with Resend](#send-with-resend)
7. [Receive with Email Routing](#receive-with-email-routing)
8. [First run](#first-run)
9. [Bring your old mail](#bring-your-old-mail)
10. [Upgrading](#upgrading)
11. [Limits](#limits)
12. [Troubleshooting](#troubleshooting)

## Before you start

- **A Cloudflare account** (free) **with your domain on it.** In the Cloudflare dashboard: **Add a domain**, keep the DNS records it imports, and change the nameservers at your registrar to the two Cloudflare shows. The domain is ready when Cloudflare says it is **Active**, which can take from minutes to a day: do it before anything else.
- **A GitHub account** if you use the Deploy button.
- **Moving mail is a switch, not a merge.** Email Routing replaces the domain's MX records, so the day you enable it, new mail stops reaching your current provider (Google Workspace, Zoho, Fastmail…) for that domain. Export your old mail first if you want it here (see [Bring your old mail](#bring-your-old-mail)), and plan the switch for a quiet moment.
- Decide your mailbox address (for example `hello@example.com`) and the subdomain the app will live on (for example `mail.example.com`).
- The email you will sign in with, **on another domain** (for example your personal Gmail). Access sends its one-time code there, so it must not be the mailbox you are installing: once mail for your domain comes to this app, a code sent to `hello@example.com` would land in the mailbox you cannot open without it. For the same reason the app never forwards its copy of new mail to an address on your own domain.
- Your Cloudflare account's login email should also be outside the domain, or protected with an authenticator app and saved backup codes: Cloudflare's recovery emails must reach you even when this mailbox is down.

## Deploy

### With the button

Press **Deploy to Cloudflare** in the [README](../README.md). Cloudflare asks you to connect GitHub, copies this repository to your account, creates the D1 database and the R2 bucket, builds the app and deploys the Worker. When it asks for variables and secrets, you can fill them in now or later (next section).

From then on, every push to your copy's `main` branch deploys again, applying new database migrations first.

### Deploy from the command line

With Node.js 24, pnpm and a copy of this repository:

```sh
pnpm install
pnpm wrangler login
pnpm wrangler d1 create georg-mail        # prints a database_id
pnpm wrangler r2 bucket create georg-mail
```

Replace the placeholder `database_id` in the `d1_databases` entry of `wrangler.jsonc` with the one it printed, set the variables (next section), then:

```sh
pnpm run deploy    # builds the app, applies migrations to D1, deploys the Worker
```

## Configure the Worker

Variables live in `wrangler.jsonc` (`vars`). Edit them in your copy of the repository and deploy again.

| Variable | Example | What it is |
| --- | --- | --- |
| `MAIL_DOMAIN` | `example.com` | The domain whose mail the Worker receives |
| `PUBLIC_BASE_URL` | `https://mail.example.com` | Where the app lives. Writes from any other origin are refused |
| `PERSONAL_MAILBOX_ADDRESSES` | `hello@example.com` | The address the mailbox can take. Mail to any other address is refused |
| `MAIL_PROVIDER` | `resend` | How mail is sent: `resend`, `mailtrap`, or `cloudflare` (Cloudflare Email Sending, which needs Workers Paid) |

Secrets are set once, never written in the repository:

```sh
pnpm wrangler secret put ACCESS_TEAM_DOMAIN   # https://your-team.cloudflareaccess.com
pnpm wrangler secret put ACCESS_AUD           # the Access application's audience tag
pnpm wrangler secret put RESEND_API_KEY       # re_…
```

or in the Cloudflare dashboard: **Workers & Pages → georg-mail → Settings → Variables and Secrets**. The next sections say where each value comes from. For `wrangler dev`, put them in a `.dev.vars` file (see `.dev.vars.example`), which git ignores.

## Give it a subdomain

In the Cloudflare dashboard: **Workers & Pages → georg-mail → Settings → Domains & Routes → Add → Custom domain**, and enter `mail.example.com`. Cloudflare creates the DNS record and the certificate.

To keep it in the repository instead, add this to `wrangler.jsonc` and deploy:

```jsonc
"routes": [{ "pattern": "mail.example.com", "custom_domain": true }]
```

## Put it behind Cloudflare Access

Access signs you in before any request reaches the Worker, and the Worker checks Access's signature on every request itself.

1. Open **Zero Trust** in the Cloudflare dashboard. The first time, it asks you to pick a team name: your team domain is then `https://<team>.cloudflareaccess.com`. You find it again in **Settings → Custom Pages**.
2. **Access → Applications → Add an application → Self-hosted.**
   - Application domain: `mail.example.com` (no path).
   - Policy: **Allow**, include **Emails** → the email you sign in with. Only the people this policy lets in can ever reach the app, including the first-run page.
   - Sign-in: the one-time PIN is on by default; Google is also available under **Settings → Authentication**.
3. Open the application and copy its **Application Audience (AUD) Tag**.
4. Set the secrets `ACCESS_TEAM_DOMAIN` (the team domain, with `https://`) and `ACCESS_AUD` (the tag).

Until both are set, the app answers "The dashboard is not configured" (503).

## Send with Resend

1. Create a [Resend](https://resend.com) account. **Domains → Add domain** → `example.com`, and add the DNS records it shows (Resend can add them to Cloudflare for you). They use a `send.` subdomain and `resend._domainkey`, so they do not touch Email Routing's records.
2. Wait until the domain shows **Verified**.
3. **API Keys → Create API key**, with **Sending access** for `example.com` only.
4. Set the secret `RESEND_API_KEY`, and `MAIL_PROVIDER` to `resend`.

The free plan sends 3,000 emails a month (100 a day). The app itself allows 40 sends a day per mailbox.

## Receive with Email Routing

1. In the Cloudflare dashboard, open your domain: **Email → Email Routing → Get started**. Cloudflare adds its MX and SPF records and offers to remove the old MX records: from here on, new mail for `example.com` comes to Cloudflare.
2. **Routing rules → Custom addresses → Create address**: `hello@example.com`, action **Send to a Worker**, destination **georg-mail**.
3. Add a rule like that for every address you want in this mailbox. Mail to addresses without a rule is refused by Email Routing; the Worker also refuses any address not in `PERSONAL_MAILBOX_ADDRESSES`.

Do not point a catch-all at the Worker unless you want every address of the domain to reach it: it refuses them, but the senders get a bounce.

## First run

Open `https://mail.example.com/dashboard`. Access asks you to sign in; then the app sees that nobody owns it yet and asks you to:

- confirm the mailbox address (one of `PERSONAL_MAILBOX_ADDRESSES`),
- give the name your mail is sent with,
- choose whether new mail is also forwarded to the email you signed in with.

**Create the mailbox**, and it is yours: the first-run page closes for good, for everyone. Send yourself a message from another account to check that mail arrives.

## Bring your old mail

**Settings → Import** takes a Zoho Mail export (the `.zip` it emails you), `.mbox` files (Google Takeout, Thunderbird, Apple Mail) and `.eml` files. Your browser unpacks the file and sends one message at a time, so a large mailbox takes a while but each request stays inside the free plan's limits. Dates are kept, messages already here are skipped, and imported mail arrives already read.

To export from Zoho: **Settings → Import/Export → Export**, choose the folders, and Zoho emails you a link to the `.zip`.

## Upgrading

New versions are published to this repository. If you deployed with the button, open your copy on GitHub and press **Sync fork**: Cloudflare builds and deploys it, applying new migrations first. From the command line:

```sh
git pull
pnpm install
pnpm run deploy
```

Read the release notes before upgrading: they say when a release needs a new variable or secret.

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| Message read in full | Up to 512 KB | Parsing it takes about 6 ms of CPU, inside Workers Free's 10 ms. Larger messages are kept whole (download the original) with their headers shown |
| Text kept in D1 | 300 MB | D1 Free allows 500 MB per database; the rest is for the search index |
| Originals kept in R2 | 2 GB | R2's free tier is 10 GB |
| Attachments when sending | 5 MB per message, 10 files | |
| Sends | 40 a day | |
| Trash and Spam | Emptied after 30 days | Checked at most once an hour, when the app is used or mail arrives: no cron trigger needed (Workers Free allows five per account) |
| Workers Free | 100,000 requests a day | Reading mail all day is a few thousand |

## Troubleshooting

Every error the app returns has a `code`. The common ones:

| Code | Status | What to do |
| --- | --- | --- |
| `unavailable` | 503 | Access is not configured: set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` |
| `unauthorized` | 401 | The Access session is missing or expired: reload the page to sign in again. If it persists, check that `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` match the Access application |
| `forbidden` | 403 | You are signed in, but not as the owner. Only the email that completed the first run can open the mailbox |
| `conflict` | 409 | On the first-run page: someone already set up this install |
| `validation_failed` | 400 | On the first-run page: the address is not in `PERSONAL_MAILBOX_ADDRESSES` |
| `rate_limited` | 429 | Too many requests from your address in a minute; wait and retry |

**Mail does not arrive.** In **Email Routing → Overview**, check the activity log: "Rejected" with "unknown recipient" means the address is missing from `PERSONAL_MAILBOX_ADDRESSES` or has no mailbox yet; "Dropped" means no routing rule matched. The Worker's logs (**Workers & Pages → georg-mail → Logs**) show refusals without the content of the mail.

**Sending fails.** Check that the Resend domain is verified, that `RESEND_API_KEY` is set and that `MAIL_PROVIDER` is `resend`.

**Letting someone else in.** The app has one owner. To give another email access to the same mailbox, add it to Access's policy and run:

```sh
pnpm wrangler d1 execute DB --remote --command \
  "INSERT INTO dashboard_members (email, account_id, created_at) SELECT 'them@example.org', account_id, unixepoch() * 1000 FROM dashboard_members LIMIT 1"
```
