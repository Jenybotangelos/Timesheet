import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

async function fixDates() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || "",
    database: process.env.DB_NAME || "",
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    port: parseInt(process.env.DB_PORT || "1433"),
    options: { encrypt: true, trustServerCertificate: false },
  });

  // Fix ALL override rows where UTC time >= 18:30 (these should have date = date - 1)
  const result1 = await pool.request().query(`
    UPDATE timesheet_date_overrides
    SET override_date = DATEADD(DAY, -1, override_date)
    WHERE DATEPART(HOUR, from_time_utc) * 60 + DATEPART(MINUTE, from_time_utc) >= 1110
  `);
  console.log(`Fixed ${result1.rowsAffected[0]} override rows (moved date back 1 day for UTC >= 18:30)`);

  // Fix ALL task entry rows where the linked override has UTC time >= 18:30
  const result2 = await pool.request().query(`
    UPDATE te
    SET te.task_date = DATEADD(DAY, -1, te.task_date)
    FROM timesheet_task_entries te
    INNER JOIN timesheet_date_overrides o ON te.override_id = o.id
    WHERE DATEPART(HOUR, o.from_time_utc) * 60 + DATEPART(MINUTE, o.from_time_utc) >= 1110
    AND te.task_date > o.override_date
  `);
  console.log(`Fixed ${result2.rowsAffected[0]} task entry rows`);

  await pool.close();
  console.log("Done!");
}

fixDates().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
