import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import { accounts, apiKeys, attachments, inboxes, messages, projects } from "../../src/worker/db/schema";

// Deleting an inbox or a message relies on ON DELETE CASCADE to remove dependent rows.
// These checks fail if a schema change silently drops a cascade.
function foreignKeys(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      target: getTableConfig(reference.foreignTable).name,
      onDelete: foreignKey.onDelete,
    };
  });
}

describe("schema foreign keys", () => {
  test("accounts belong to a plan and are never deleted with it", () => {
    // Drizzle leaves onDelete undefined for SQLite's default, NO ACTION.
    expect(foreignKeys(accounts)).toEqual([{ columns: ["plan_id"], target: "plans", onDelete: undefined }]);
  });

  test("projects, API keys and inboxes are deleted with their account", () => {
    expect(foreignKeys(projects)).toEqual([{ columns: ["account_id"], target: "accounts", onDelete: "cascade" }]);
    expect(foreignKeys(apiKeys)).toEqual([
      { columns: ["account_id"], target: "accounts", onDelete: "cascade" },
      { columns: ["project_id"], target: "projects", onDelete: "cascade" },
    ]);
    expect(foreignKeys(inboxes)).toEqual([
      { columns: ["account_id"], target: "accounts", onDelete: "cascade" },
      { columns: ["project_id"], target: "projects", onDelete: "cascade" },
    ]);
  });

  test("messages are deleted with their inbox and account", () => {
    expect(foreignKeys(messages)).toEqual(
      expect.arrayContaining([
        { columns: ["inbox_id"], target: "inboxes", onDelete: "cascade" },
        { columns: ["account_id"], target: "accounts", onDelete: "cascade" },
      ]),
    );
  });

  test("attachment metadata is deleted with its message", () => {
    expect(foreignKeys(attachments)).toEqual([{ columns: ["message_id"], target: "messages", onDelete: "cascade" }]);
  });
});
