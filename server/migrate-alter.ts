import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || "",
    database: process.env.DB_NAME || "",
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    port: parseInt(process.env.DB_PORT || "1433"),
    options: { encrypt: true, trustServerCertificate: false },
  });

  // Rename column 'name' to 'task_name'
  await pool.request().query(
    "EXEC sp_rename 'timesheet_project_tasks.name', 'task_name', 'COLUMN'"
  );
  console.log("Renamed: name -> task_name");

  // Add FK for project_task_id in task_entries
  await pool.request().query(
    "ALTER TABLE timesheet_task_entries ADD CONSTRAINT FK_task_entries_project_task FOREIGN KEY (project_task_id) REFERENCES timesheet_project_tasks(id)"
  );
  console.log("Added FK: project_task_id -> timesheet_project_tasks");

  // Add FK for bucket_id in task_entries
  await pool.request().query(
    "ALTER TABLE timesheet_task_entries ADD CONSTRAINT FK_task_entries_bucket FOREIGN KEY (bucket_id) REFERENCES timesheet_task_buckets(id)"
  );
  console.log("Added FK: bucket_id -> timesheet_task_buckets");

  await pool.close();
  console.log("Done!");
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
