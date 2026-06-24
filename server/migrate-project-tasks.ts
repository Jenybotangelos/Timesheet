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

  // Table 1: Project Tasks
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'timesheet_project_tasks')
    CREATE TABLE timesheet_project_tasks (
      id INT IDENTITY(1,1) PRIMARY KEY,
      project_id INT NOT NULL,
      name NVARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (project_id) REFERENCES timesheet_projects(id)
    )
  `);
  console.log("Created: timesheet_project_tasks");

  // Table 2: Task Buckets
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'timesheet_task_buckets')
    CREATE TABLE timesheet_task_buckets (
      id INT IDENTITY(1,1) PRIMARY KEY,
      task_id INT NOT NULL,
      bucket_name NVARCHAR(50) NOT NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      priority NVARCHAR(10) DEFAULT 'medium',
      expected_hours INT DEFAULT 0,
      status NVARCHAR(20) DEFAULT 'not_started',
      acceptance_criteria NVARCHAR(MAX) NULL,
      FOREIGN KEY (task_id) REFERENCES timesheet_project_tasks(id) ON DELETE CASCADE
    )
  `);
  console.log("Created: timesheet_task_buckets");

  // Table 3: Bucket Assignees
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'timesheet_bucket_assignees')
    CREATE TABLE timesheet_bucket_assignees (
      id INT IDENTITY(1,1) PRIMARY KEY,
      bucket_id INT NOT NULL,
      employee_email NVARCHAR(255) NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES timesheet_task_buckets(id) ON DELETE CASCADE
    )
  `);
  console.log("Created: timesheet_bucket_assignees");

  // Add project_task_id and bucket_id to timesheet_task_entries
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('timesheet_task_entries') AND name = 'project_task_id')
    ALTER TABLE timesheet_task_entries ADD project_task_id INT NULL
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('timesheet_task_entries') AND name = 'bucket_id')
    ALTER TABLE timesheet_task_entries ADD bucket_id INT NULL
  `);
  console.log("Altered: timesheet_task_entries (added project_task_id, bucket_id)");

  await pool.close();
  console.log("Done!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
