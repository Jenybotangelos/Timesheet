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

  // Create requests table
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'timesheet_requests')
    CREATE TABLE timesheet_requests (
      id INT IDENTITY(1,1) PRIMARY KEY,
      type NVARCHAR(20) NOT NULL,
      name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) NULL,
      project_id INT NULL,
      requested_by NVARCHAR(255) NOT NULL,
      status NVARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_notes NVARCHAR(MAX) NULL,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      reviewed_by NVARCHAR(255) NULL,
      reviewed_at DATETIME2 NULL
    )
  `);
  console.log("timesheet_requests table created (or already exists)");

  await pool.close();
  console.log("Migration complete");
}

migrate().catch(console.error);
