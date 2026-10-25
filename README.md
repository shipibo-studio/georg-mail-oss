# Georg mail

[![CI](https://github.com/shipibo-studio/georg-mail-oss/actions/workflows/ci.yml/badge.svg)](https://github.com/shipibo-studio/georg-mail-oss/actions/workflows/ci.yml)

A mail client for your own domain that you host on your Cloudflare account, and that runs on the **free Workers plan**. Mail arrives through Cloudflare Email Routing, is kept in D1 and R2, and you read and send it from a fast web app behind Cloudflare Access.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/shipibo-studio/georg-mail-oss)

## What it does

- **Inbox, Sent, Drafts, Archive, Spam and Trash**, with keyboard shortcuts (J/K to move, E to archive, ! to report spam, C to compose, ⌘K for everything else).
- **Sending** through [Resend](https://resend.com) (free plan available) or Mailtrap, with replies that thread, recipients as chips and attachments up to 5 MB per message.
- **Drafts** saved on the server as you type, so they follow you to every device.
- **Spam filtering** without a third-party service: forged senders (DMARC), risky content from strangers, and your own Spam / Not spam choices per sender.
- **Search** across subject, sender and the visible text, ignoring case and accents, with `"exact phrases"`, `-word` to leave words out, and `from:`, `has:attachment`, `after:` and `before:` filters. Search terms never leave your browser in a URL.
- **Import** your old mail: a Zoho Mail export, `.mbox` or `.eml` files, with dates kept and duplicates skipped.
- **A forwarded copy** of every new email to the address you sign in with, if you want one.
- **Email HTML is safe to open**: it runs no code and loads no tracker until you ask for images.
- **Updates in one click**: it tells you when a new version is out and, once you confirm, commits it to your copy for Cloudflare to deploy, never touching your settings or your own changes.
- Light and dark themes, accent colors, and display preferences that follow you to every device, in English, Spanish (Latin America) and Portuguese (Brazil).

It keeps one mailbox for its owner. It is not a multi-user mail server.

## What you need

- A Cloudflare account. The free plan is enough: Workers, D1, R2, Email Routing and Access (up to 50 users) all have free tiers. You can create it during the deploy.
- Your domain on that account, using Cloudflare's nameservers. Do this first: moving nameservers can take from minutes to a day.
- A GitHub or GitLab account, for the Deploy button (it copies this repository to your account). Not needed if you deploy from the command line.
- A sending provider: a free [Resend](https://resend.com) account with your domain verified.

Switching your domain's mail to Email Routing replaces its current MX records: mail stops going to your old provider. Read [Self-hosting](docs/self-hosting.md) before you start.

## Install

1. Press **Deploy to Cloudflare** above. It copies this repository to your GitHub account, creates the database and the storage bucket, and deploys the Worker. Or deploy from your computer with the CLI: see [Self-hosting](docs/self-hosting.md#deploy-from-the-command-line).
2. Give the Worker its own subdomain (for example `mail.example.com`) and put it behind Cloudflare Access.
3. Set its secrets: the Access team and audience, and your Resend API key.
4. Send your domain's mail to the Worker with Email Routing.
5. Open `https://mail.example.com/dashboard`. The first person Access lets in creates the mailbox and becomes its owner.

Every step, and where to find each setting in Cloudflare and Resend, is in **[docs/self-hosting.md](docs/self-hosting.md)**.

**Installing with a coding agent?** Point Claude Code, Codex or Cursor at [`skills/install-georg-mail/SKILL.md`](skills/install-georg-mail/SKILL.md) (or [`llms.txt`](llms.txt)): it runs the commands, and leaves to you the steps that are yours, such as the secrets, who may sign in and moving your domain's mail.

## Development

Node.js 24 and pnpm:

```sh
pnpm install
pnpm dashboard:mock    # the app with an in-memory mailbox, no Cloudflare needed
pnpm dev               # the Worker with local D1 and R2
pnpm test              # unit and end-to-end tests inside the Workers runtime
pnpm test:dashboard    # the app in a browser, on a desktop and a phone (Playwright)
```

`pnpm lint`, `pnpm typecheck` and `pnpm test:coverage` (85% minimum) run in CI on every pull request.

## How this repository is made

This mail client is the open-source part of **Georg mail**, a hosted product by Shipibo Studio that also gives AI agents disposable inboxes. It is built in that product's repository and published here with every release, so pull requests are welcome but are applied there and come back with the next release. Bugs and ideas: open an issue.

## License

[MIT](LICENSE). The design system in `vendor/georg-ds` is also MIT ([its license](vendor/georg-ds/LICENSE)).

The license covers the code, not the name: "Georg" and the Georg logo identify Shipibo Studio's products. If you publish a modified version, give it another name.
