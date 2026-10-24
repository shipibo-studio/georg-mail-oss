import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for D1 into ./migrations; apply them with `pnpm db:migrate:local` or `:remote`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
});
