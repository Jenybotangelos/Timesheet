import { getPool } from "./src/db";

(async () => {
  const pool = await getPool();
  // Delete the wrongly-dated rows (June 21 should be June 22)
  await pool.request().query(
    `DELETE FROM timesheet_date_overrides WHERE id IN (613,614,615,616,617,618)`
  );
  console.log("Deleted bad rows 613-618");
  process.exit(0);
})();
