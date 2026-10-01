import { Pool } from "pg";
import { getQueueStatus } from "../adapters/postgres/inspection.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString });
try {
  const status = await getQueueStatus(pool);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} finally {
  await pool.end();
}
