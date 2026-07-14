import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

const config: sql.config = {
  server: process.env.DB_SERVER!,
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  port: parseInt(process.env.DB_PORT || "1433"),
  options: { encrypt: true, trustServerCertificate: false },
};

async function migrate() {
  const pool = await sql.connect(config);

  const indexes = [
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_buckets_task_id') CREATE INDEX IX_task_buckets_task_id ON timesheet_task_buckets(task_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bucket_assignees_bucket_id') CREATE INDEX IX_bucket_assignees_bucket_id ON timesheet_bucket_assignees(bucket_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bucket_assignees_email') CREATE INDEX IX_bucket_assignees_email ON timesheet_bucket_assignees(employee_email)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bucket_criteria_bucket_id') CREATE INDEX IX_bucket_criteria_bucket_id ON timesheet_bucket_criteria(bucket_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_project_tasks_project_id') CREATE INDEX IX_project_tasks_project_id ON timesheet_project_tasks(project_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_entries_bucket_id') CREATE INDEX IX_task_entries_bucket_id ON timesheet_task_entries(bucket_id)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_entries_email_date') CREATE INDEX IX_task_entries_email_date ON timesheet_task_entries(employee_email, task_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_date_overrides_email_date') CREATE INDEX IX_date_overrides_email_date ON timesheet_date_overrides(employee_email, override_date)",
    "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_entries_override_id') CREATE INDEX IX_task_entries_override_id ON timesheet_task_entries(override_id)",
  ];

  for (const idx of indexes) {
    await pool.request().query(idx);
  }

  console.log("✅ All indexes created");
  await pool.close();
}

migrate().catch((err) => { console.error(err); process.exit(1); });
