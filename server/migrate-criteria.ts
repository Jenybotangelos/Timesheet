import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

async function migrate() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || "",
    database: process.env.DB_NAME || "",
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    port: parseInt(process.env.DB_PORT || "1433"),
    options: { encrypt: true, trustServerCertificate: false },
  });

  // 1. Create acceptance criteria table
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'timesheet_bucket_criteria')
    CREATE TABLE timesheet_bucket_criteria (
      id INT IDENTITY(1,1) PRIMARY KEY,
      bucket_id INT NOT NULL,
      criteria NVARCHAR(500) NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES timesheet_task_buckets(id) ON DELETE CASCADE
    )
  `);
  console.log("Created: timesheet_bucket_criteria");

  // 2. Migrate existing acceptance_criteria data to new table
  const existing = await pool.request().query(`
    SELECT id, acceptance_criteria FROM timesheet_task_buckets WHERE acceptance_criteria IS NOT NULL
  `);
  for (const row of existing.recordset) {
    try {
      const criteria: string[] = JSON.parse(row.acceptance_criteria);
      for (const c of criteria) {
        if (c.trim()) {
          await pool.request()
            .input("bucketId", row.id)
            .input("criteria", c.trim())
            .query("INSERT INTO timesheet_bucket_criteria (bucket_id, criteria) VALUES (@bucketId, @criteria)");
        }
      }
    } catch {}
  }
  console.log("Migrated existing criteria data");

  // 3. Drop acceptance_criteria column from timesheet_task_buckets
  await pool.request().query(`
    IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('timesheet_task_buckets') AND name = 'acceptance_criteria')
    ALTER TABLE timesheet_task_buckets DROP COLUMN acceptance_criteria
  `);
  console.log("Dropped: acceptance_criteria from timesheet_task_buckets");

  // 4. Add consumption_hr column to timesheet_task_buckets
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('timesheet_task_buckets') AND name = 'consumption_hr')
    ALTER TABLE timesheet_task_buckets ADD consumption_hr DECIMAL(10,2) DEFAULT 0
  `);
  console.log("Added: consumption_hr to timesheet_task_buckets");

  await pool.close();
  console.log("Done!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
