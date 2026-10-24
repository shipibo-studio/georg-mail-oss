import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      // Set only in tests (vitest.config.ts); production reads them as optional secrets.
      ACCESS_TEAM_DOMAIN: string;
      ACCESS_AUD: string;
    }
  }
}
