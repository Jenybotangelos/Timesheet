import { getPool } from "./src/db";

async function migrate() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID('timesheet_task_entries') AND name = 'status'
    )
    ALTER TABLE timesheet_task_entries ADD status NVARCHAR(20) NOT NULL DEFAULT 'submitted'
  `);
  console.log("Migration done: status column added");
  process.exit(0);
}

migrate().catch((err) => { console.error(err); process.exit(1); });
