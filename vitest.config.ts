import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      projects: [
        {
          // The Worker, inside workerd with local D1 and R2.
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              // Tests never reach remote resources: Workers AI is replaced by a fake where it is used.
              remoteBindings: false,
              miniflare: {
                // A fake token overrides the real one wrangler reads from .env, so tests can never send email.
                // The dashboard tests sign their own Access tokens for this team and audience.
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  // Whatever the install sends with, tests send through a faked Mailtrap.
                  MAIL_PROVIDER: "mailtrap",
                  MAILTRAP_API_KEY: "test-mailtrap-token",
                  ACCESS_TEAM_DOMAIN: "https://georg-test.cloudflareaccess.com",
                  ACCESS_AUD: "test-access-audience",
                  WEBHOOK_SIGNING_KEY: "test-webhook-signing-key",
                },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/**/*.test.ts"],
            setupFiles: ["./test/apply-migrations.ts"],
          },
        },
        {
          // The dashboard's logic (sanitizing email HTML, recipients, routes, i18n) in a simulated DOM.
          test: {
            name: "dashboard",
            include: ["dashboard/test/**/*.test.ts"],
            environment: "jsdom",
          },
        },
      ],
      coverage: {
        // istanbul instruments the code, so it works inside workerd (the V8 provider does not).
        provider: "istanbul" as const,
        include: ["src/worker/**/*.ts", "dashboard/src/lib/**/*.ts", "dashboard/src/i18n/**/*.ts"],
        exclude: ["src/worker/worker-configuration.d.ts"],
        reporter: ["text-summary", "text", "html"],
        // Minimum required by AGENTS.md; CI fails below it.
        thresholds: { lines: 85, statements: 85, functions: 85, branches: 85 },
      },
    },
  };
});
