import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// Helper: convert a block to individual 1-hour rows (no rounding)
function blockToHours(fromUtc: string, toUtc: string): { from: string; to: string }[] {
  // Extract HH:mm from possible ISO string
  const fromStr = fromUtc.includes("T") ? fromUtc.split("T")[1].substring(0, 5) : fromUtc.substring(0, 5);
  const toStr = toUtc.includes("T") ? toUtc.split("T")[1].substring(0, 5) : toUtc.substring(0, 5);

  const [fh, fm] = fromStr.split(":").map(Number);
  const [th, tm] = toStr.split(":").map(Number);
  const startMin = fh * 60 + fm;
  const endMin = th * 60 + tm;

  const hours: { from: string; to: string }[] = [];
  for (let m = startMin; m < endMin; m += 60) {
    const nextM = Math.min(m + 60, endMin);
    hours.push({
      from: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      to: `${String(Math.floor(nextM / 60)).padStart(2, "0")}:${String(nextM % 60).padStart(2, "0")}`,
    });
  }
  return hours;
}

// GET /api/tasks?email=xxx&date=2026-06-04
// Returns hourly rows with task descriptions + submitted flag
router.get("/", async (req, res) => {
  try {
    const { email, date } = req.query;
    if (!email || !date) {
      return res.status(400).json({ error: "email and date are required" });
    }

    const pool = await getPool();

    // Check if tasks already submitted for this date
    const taskCheck = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .query("SELECT COUNT(*) as count FROM timesheet_task_entries WHERE employee_email = @email AND task_date = @date");

    const submitted = taskCheck.recordset[0].count > 0;

    // Check overrides first (already stored as hourly rows)
    const overrides = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .query(
        `SELECT o.id, o.from_time_utc, o.to_time_utc, t.task_description
         FROM timesheet_date_overrides o
         LEFT JOIN timesheet_task_entries t ON t.override_id = o.id
         WHERE o.employee_email = @email AND o.override_date = @date
         ORDER BY o.from_time_utc`
      );

    if (overrides.recordset.length > 0) {
      // Override rows are already hourly — return them directly
      const hours = overrides.recordset.map((r: any) => {
        const fromRaw = r.from_time_utc instanceof Date
          ? r.from_time_utc.toISOString()
          : String(r.from_time_utc);
        const toRaw = r.to_time_utc instanceof Date
          ? r.to_time_utc.toISOString()
          : String(r.to_time_utc);
        return {
          from_time_utc: fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5),
          to_time_utc: toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5),
          task_description: r.task_description || "",
        };
      });
      return res.json({ source: "override", submitted, hours });
    }

    // Fall back to default blocks — convert to hourly
    const defaults = await pool.request()
      .input("email", email as string)
      .query(
        `SELECT from_time_utc, to_time_utc
         FROM timesheet_default_blocks
         WHERE employee_email = @email
         ORDER BY from_time_utc`
      );

    const hours: { from_time_utc: string; to_time_utc: string; task_description: string }[] = [];
    for (const block of defaults.recordset) {
      // Handle Date objects or strings from mssql
      const fromRaw = block.from_time_utc instanceof Date
        ? block.from_time_utc.toISOString()
        : String(block.from_time_utc);
      const toRaw = block.to_time_utc instanceof Date
        ? block.to_time_utc.toISOString()
        : String(block.to_time_utc);

      const hourSlots = blockToHours(fromRaw, toRaw);
      for (const slot of hourSlots) {
        hours.push({ from_time_utc: slot.from, to_time_utc: slot.to, task_description: "" });
      }
    }

    res.json({ source: "default", submitted, hours });
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// POST /api/tasks — One-time submit: save hourly overrides + task entries
// Body: { email: "jeny@company.com", date: "2026-06-04", hours: [{ from: "04:00", to: "05:00", taskDescription: "Task A" }, ...] }
router.post("/", async (req, res) => {
  try {
    const { email, date, hours } = req.body;

    if (!email || !date || !Array.isArray(hours)) {
      return res.status(400).json({ error: "email, date, and hours array are required" });
    }

    const pool = await getPool();

    // Check if already submitted for this date
    const existing = await pool.request()
      .input("email", email)
      .input("date", date)
      .query("SELECT COUNT(*) as count FROM timesheet_task_entries WHERE employee_email = @email AND task_date = @date");

    if (existing.recordset[0].count > 0) {
      return res.status(409).json({ error: "Tasks already submitted for this date. Cannot re-submit." });
    }

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Delete any existing overrides for this date (in case override was set before)
      await transaction.request()
        .input("email", email)
        .input("date", date)
        .query("DELETE FROM timesheet_date_overrides WHERE employee_email = @email AND override_date = @date");

      // Insert each hour as override + task entry
      for (const hour of hours) {
        // Insert override hour
        const insertResult = await transaction.request()
          .input("email", email)
          .input("date", date)
          .input("from", hour.from)
          .input("to", hour.to)
          .query("INSERT INTO timesheet_date_overrides (employee_email, override_date, from_time_utc, to_time_utc) OUTPUT INSERTED.id VALUES (@email, @date, @from, @to)");

        const overrideId = insertResult.recordset[0].id;

        // Insert task entry linked to override
        await transaction.request()
          .input("email", email)
          .input("date", date)
          .input("taskDescription", hour.taskDescription || "")
          .input("overrideId", overrideId)
          .query("INSERT INTO timesheet_task_entries (employee_email, task_date, task_description, submitted_at_utc, override_id) VALUES (@email, @date, @taskDescription, GETUTCDATE(), @overrideId)");
      }

      await transaction.commit();
      res.status(201).json({ message: "Tasks submitted", count: hours.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error("Error saving tasks:", err);
    res.status(500).json({ error: "Failed to save tasks" });
  }
});

export default router;
