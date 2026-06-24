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

  const r = await pool.request().query(
    "SELECT name, definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('timesheet_date_overrides')"
  );
  console.log("Constraints:", r.recordset);

  // Drop the constraint that blocks cross-midnight UTC times
  if (r.recordset.length > 0) {
    for (const c of r.recordset) {
      console.log(`Dropping constraint: ${c.name} (${c.definition})`);
      await pool.request().query(`ALTER TABLE timesheet_date_overrides DROP CONSTRAINT [${c.name}]`);
    }
    console.log("Done - constraints dropped");
  }

  await pool.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
