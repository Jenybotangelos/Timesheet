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

    // Check task status for this date
    const taskCheck = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .query("SELECT TOP 1 status FROM timesheet_task_entries WHERE employee_email = @email AND task_date = @date");

    const status: "draft" | "submitted" | null = taskCheck.recordset.length > 0
      ? taskCheck.recordset[0].status
      : null;
    const submitted = status === "submitted";

    // Check overrides first (already stored as hourly rows)
    const overrides = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .query(
        `SELECT o.id, o.from_time_utc, o.to_time_utc, t.task_description, t.project_id
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
          project_id: r.project_id || null,
        };
      });
      return res.json({ source: "override", submitted, status, hours });
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

    res.json({ source: "default", submitted, status, hours });
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// POST /api/tasks — Save draft or final submit
// Body: { email, date, hours: [{ from, to, taskDescription }], action: "save" | "submit" }
router.post("/", async (req, res) => {
  try {
    const { email, date, hours, action = "submit" } = req.body;

    if (!email || !date || !Array.isArray(hours)) {
      return res.status(400).json({ error: "email, date, and hours array are required" });
    }

    const pool = await getPool();

    // Check if already submitted (final) for this date
    const existing = await pool.request()
      .input("email", email)
      .input("date", date)
      .query("SELECT TOP 1 status FROM timesheet_task_entries WHERE employee_email = @email AND task_date = @date");

    if (existing.recordset.length > 0 && existing.recordset[0].status === "submitted") {
      return res.status(409).json({ error: "Tasks already submitted for this date. Cannot edit." });
    }

    // For final submit, all tasks must be filled
    if (action === "submit") {
      const emptyTask = hours.find((h: any) => !h.taskDescription || !h.taskDescription.trim());
      if (emptyTask) {
        return res.status(400).json({ error: "All task descriptions must be filled before submitting." });
      }
    }

    const status = action === "submit" ? "submitted" : "draft";

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get existing overrides with their task entry status
      const existingOverrides = await transaction.request()
        .input("email", email)
        .input("date", date)
        .query(
          `SELECT o.id, o.from_time_utc, o.to_time_utc, t.id as task_id
           FROM timesheet_date_overrides o
           LEFT JOIN timesheet_task_entries t ON t.override_id = o.id
           WHERE o.employee_email = @email AND o.override_date = @date
           ORDER BY o.from_time_utc`
        );

      // Build a map of existing overrides by time slot
      const overrideMap = new Map<string, { id: number; hasTask: boolean; taskId: number | null }>();
      for (const r of existingOverrides.recordset) {
        const fromRaw = r.from_time_utc instanceof Date ? r.from_time_utc.toISOString() : String(r.from_time_utc);
        const toRaw = r.to_time_utc instanceof Date ? r.to_time_utc.toISOString() : String(r.to_time_utc);
        const fromStr = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
        const toStr = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);
        overrideMap.set(`${fromStr}-${toStr}`, { id: r.id, hasTask: r.task_id !== null, taskId: r.task_id });
      }

      let savedCount = 0;

      for (const hour of hours) {
        const key = `${hour.from}-${hour.to}`;
        const existing = overrideMap.get(key);

        if (existing && existing.hasTask) {
          // Already has a saved task — skip (locked), but update status if submitting
          if (action === "submit") {
            await transaction.request()
              .input("taskId", existing.taskId)
              .input("status", "submitted")
              .query("UPDATE timesheet_task_entries SET status = @status WHERE id = @taskId");
          }
          savedCount++;
          continue;
        }

        // Only insert task entry if description is filled
        if (!hour.taskDescription || !hour.taskDescription.trim()) {
          // For submit this shouldn't happen (validated above), for save just skip
          continue;
        }

        let overrideId: number;
        if (existing) {
          // Override exists but no task — use its ID
          overrideId = existing.id;
        } else {
          // No override yet — insert one
          const insertResult = await transaction.request()
            .input("email", email)
            .input("date", date)
            .input("from", hour.from)
            .input("to", hour.to)
            .query("INSERT INTO timesheet_date_overrides (employee_email, override_date, from_time_utc, to_time_utc) OUTPUT INSERTED.id VALUES (@email, @date, @from, @to)");
          overrideId = insertResult.recordset[0].id;
        }

        // Insert task entry
        await transaction.request()
          .input("email", email)
          .input("date", date)
          .input("taskDescription", hour.taskDescription)
          .input("overrideId", overrideId)
          .input("status", status)
          .input("projectId", hour.projectId || null)
          .query("INSERT INTO timesheet_task_entries (employee_email, task_date, task_description, submitted_at_utc, override_id, status, project_id) VALUES (@email, @date, @taskDescription, GETUTCDATE(), @overrideId, @status, @projectId)");
        savedCount++;
      }

      await transaction.commit();
      const msg = action === "submit" ? "Tasks submitted" : `Draft saved (${savedCount} tasks)`;
      res.status(201).json({ message: msg, count: savedCount, status });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error("Error saving tasks:", err);
    res.status(500).json({ error: "Failed to save tasks" });
  }
});

// GET /api/tasks/weekly?startDate=2026-06-15&endDate=2026-06-21&email=admin@...
// Returns all employees' submitted tasks for the week (admin only)
router.get("/weekly", async (req, res) => {
  try {
    const { startDate, endDate, email } = req.query;
    if (!startDate || !endDate || !email) {
      return res.status(400).json({ error: "startDate, endDate, and email are required" });
    }

    const pool = await getPool();

    // Check if requesting user is admin
    const adminCheck = await pool.request()
      .input("email", email as string)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");

    if (adminCheck.recordset.length === 0 || adminCheck.recordset[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can view weekly reports" });
    }

    // Get all task entries for the date range with employee names and project names
    const result = await pool.request()
      .input("startDate", startDate as string)
      .input("endDate", endDate as string)
      .query(
        `SELECT 
           t.employee_email, e.name AS employee_name,
           t.task_date, t.task_description, t.status, t.project_id,
           p.name AS project_name,
           o.from_time_utc, o.to_time_utc
         FROM timesheet_task_entries t
         JOIN timesheet_employees e ON e.email = t.employee_email
         LEFT JOIN timesheet_projects p ON p.id = t.project_id
         LEFT JOIN timesheet_date_overrides o ON o.id = t.override_id
         WHERE t.task_date >= @startDate AND t.task_date <= @endDate
         ORDER BY e.name, t.task_date, o.from_time_utc`
      );

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching weekly report:", err);
    res.status(500).json({ error: "Failed to fetch weekly report" });
  }
});

export default router;
