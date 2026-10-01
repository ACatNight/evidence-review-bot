import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { transaction } from "./transaction.js";

export async function migrate(pool: Pool): Promise<void> {
  const directory = "db/migrations";
  const files = (await readdir(directory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(482713, 90127)");
    await client.query("CREATE SCHEMA IF NOT EXISTS review_bot");
    await client.query(`CREATE TABLE IF NOT EXISTS review_bot.schema_migration (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    for (const file of files) {
      const sql = await readFile(`${directory}/${file}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM review_bot.schema_migration WHERE name = $1",
        [file],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Migration ${file} changed after application`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO review_bot.schema_migration (name, checksum) VALUES ($1, $2)",
        [file, checksum],
      );
    }
  });
}
