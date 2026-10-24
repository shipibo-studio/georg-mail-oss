# Security policy

## Reporting a vulnerability

If you find a security vulnerability, **do not open a public issue** and do not describe it in a pull request.

Report it privately through GitHub: **[Report a vulnerability](https://github.com/shipibo-studio/georg-mail-oss/security/advisories/new)**.

Please include:

- A description of the vulnerability
- Steps to reproduce it
- Its potential impact
- Suggested mitigations, if any

We acknowledge reports within **48 business hours** and reply with a remediation timeline. Fixes are released here and in the hosted Georg mail at the same time.

We appreciate good-faith reports. Please do not access, modify or extract other people's mail during your research, and do not disclose the finding publicly until a fix is available.

## Your install

Your copy runs on your Cloudflare account, so keeping it safe is shared:

- Keep the Access policy limited to the people who should read the mailbox. It also decides who can reach the first-run page.
- Keep secrets (`ACCESS_AUD`, `RESEND_API_KEY`) in Worker secrets, never in the repository.
- Upgrade when a release says it fixes a security issue.
