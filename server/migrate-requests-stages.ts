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
    IF NOT EXISTS (
      SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'timesheet_requests' AND COLUMN_NAME = 'stages'
    )
    ALTER TABLE timesheet_requests ADD stages NVARCHAR(MAX) NULL
  `);
  console.log("stages column added (or already exists)");

  await pool.close();
  console.log("Done");
}

migrate().catch(console.error);
