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

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'timesheet_tokens')
    CREATE TABLE timesheet_tokens (
      id INT IDENTITY(1,1) PRIMARY KEY,
      token_key NVARCHAR(100) UNIQUE NOT NULL,
      token_value NVARCHAR(MAX) NOT NULL,
      updated_at DATETIME DEFAULT GETDATE()
    )
  `);

  console.log("✅ timesheet_tokens table created (or already exists)");
  await pool.close();
}

migrate().catch((err) => { console.error(err); process.exit(1); });
