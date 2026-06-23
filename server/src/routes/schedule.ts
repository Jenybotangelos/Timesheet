import { Router } from "express";
import { getPool } from "../db";

const router = Router();

function prevDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function utcToIst(utcTime: string): string {
  const [h, m] = utcTime.split(":").map(Number);
  let totalMin = h * 60 + m + 330;
  if (totalMin >= 1440) totalMin -= 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

function parseUtcTime(raw: any): string {
  const s = raw instanceof Date ? raw.toISOString() : String(raw);
  return s.includes("T") ? s.split("T")[1].substring(0, 5) : s.substring(0, 5);
}

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
    const pDate = prevDay(date as string);
    const schedule: Record<string, { from_time_ist: string; to_time_ist: string }[]> = {};

    for (const email of emailList) {
      // Check overrides first (query both dates for IST day)
      const overrides = await pool.request()
        .input("email", email)
        .input("date", date as string)
        .input("prevDate", pDate)
        .query(
          `SELECT from_time_utc, to_time_utc
           FROM timesheet_date_overrides
           WHERE employee_email = @email AND (
             (override_date = @date AND from_time_utc < '18:30:00') OR
             (override_date = @prevDate AND from_time_utc >= '18:30:00')
           )
           ORDER BY CASE WHEN from_time_utc >= '18:30:00' THEN 0 ELSE 1 END, from_time_utc`
        );

      if (overrides.recordset.length > 0) {
        schedule[email] = overrides.recordset.map((r: any) => ({
          from_time_ist: utcToIst(parseUtcTime(r.from_time_utc)),
          to_time_ist: utcToIst(parseUtcTime(r.to_time_utc)),
        }));
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
        schedule[email] = defaults.recordset.map((r: any) => ({
          from_time_ist: utcToIst(parseUtcTime(r.from_time_utc)),
          to_time_ist: utcToIst(parseUtcTime(r.to_time_utc)),
        }));
      }
    }

    res.json(schedule);
  } catch (err) {
    console.error("Error fetching schedule:", err);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

export default router;
