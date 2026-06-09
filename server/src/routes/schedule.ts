import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// GET /api/schedule?emails=a@company.com,b@company.com&date=2026-06-05
// Returns effective schedule for multiple employees (override > default)
router.get("/", async (req, res) => {
  try {
    const { emails, date } = req.query;
    if (!emails || !date) {
      return res.status(400).json({ error: "emails and date are required" });
    }

    const emailList = (emails as string).split(",").map((e) => e.trim());
    const pool = await getPool();
    const schedule: Record<string, { from_time_utc: string; to_time_utc: string }[]> = {};

    for (const email of emailList) {
      // Check overrides first
      const overrides = await pool.request()
        .input("email", email)
        .input("date", date as string)
        .query(
          `SELECT from_time_utc, to_time_utc
           FROM timesheet_date_overrides
           WHERE employee_email = @email AND override_date = @date
           ORDER BY from_time_utc`
        );

      if (overrides.recordset.length > 0) {
        schedule[email] = overrides.recordset;
      } else {
        // Fallback to default blocks
        const defaults = await pool.request()
          .input("email", email)
          .query(
            `SELECT from_time_utc, to_time_utc
             FROM timesheet_default_blocks
             WHERE employee_email = @email
             ORDER BY from_time_utc`
          );
        schedule[email] = defaults.recordset;
      }
    }

    res.json(schedule);
  } catch (err) {
    console.error("Error fetching schedule:", err);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

export default router;
