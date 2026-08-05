import dotenv from "dotenv";
import sql from "mssql";

dotenv.config();

async function migrate() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER!,
    database: process.env.DB_NAME!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    port: parseInt(process.env.DB_PORT || "1433"),
    options: { encrypt: true, trustServerCertificate: false },
  });

  console.log("Connected to DB");

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'timesheet_task_comments')
    CREATE TABLE timesheet_task_comments (
      id INT IDENTITY(1,1) PRIMARY KEY,
      bucket_id INT NOT NULL,
      employee_email NVARCHAR(255) NOT NULL,
      message NVARCHAR(MAX) NOT NULL,
      created_at DATETIME2 DEFAULT GETUTCDATE()
    )
  `);
  console.log("timesheet_task_comments table ready");

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'timesheet_attachments')
    CREATE TABLE timesheet_attachments (
      id INT IDENTITY(1,1) PRIMARY KEY,
      bucket_id INT NOT NULL,
      filename NVARCHAR(255) NOT NULL,
      s3_key NVARCHAR(500) NOT NULL,
      file_size INT NULL,
      uploaded_by NVARCHAR(255) NOT NULL,
      created_at DATETIME2 DEFAULT GETUTCDATE()
    )
  `);
  console.log("timesheet_attachments table ready");

  await pool.close();
  console.log("Migration complete");
}

migrate().catch(console.error);
