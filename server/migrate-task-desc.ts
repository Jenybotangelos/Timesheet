import { getPool } from "./src/db";

async function run() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID('timesheet_project_tasks') AND name = 'description'
    )
    ALTER TABLE timesheet_project_tasks ADD description NVARCHAR(MAX) NULL
  `);
  console.log("Done: description column added to timesheet_project_tasks");
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
