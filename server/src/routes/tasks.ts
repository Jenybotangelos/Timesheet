import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// IST offset helpers
function getUtcDate(istDate: string, utcTime: string): string {
  const [h, m] = utcTime.split(":").map(Number);
  if (h * 60 + m >= 1110) { // 18:30
    const d = new Date(istDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split("T")[0];
  }
  return istDate;
}

function prevDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function istToUtcTime(istTime: string): string {
  const [h, m] = istTime.split(":").map(Number);
  let totalMin = h * 60 + m - 330;
  if (totalMin < 0) totalMin += 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

function utcToIst(utcTime: string): string {
  const [h, m] = utcTime.split(":").map(Number);
  let totalMin = h * 60 + m + 330;
  if (totalMin >= 1440) totalMin -= 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

function utcDateTimeToIst(utcDate: string, utcTime: string): { date: string; time: string } {
  const [h, m] = utcTime.split(":").map(Number);
  let totalMin = h * 60 + m + 330;
  let date = utcDate;
  if (totalMin >= 1440) {
    totalMin -= 1440;
    const d = new Date(utcDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    date = d.toISOString().split("T")[0];
  }
  const time = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  return { date, time };
}

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

    // Check task status for this IST date (only entries whose override times belong to this IST day)
    const pDate = prevDay(date as string);
    const taskCheck = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .input("prevDate", pDate)
      .query(
        `SELECT TOP 1 t.status 
         FROM timesheet_task_entries t
         JOIN timesheet_date_overrides o ON o.id = t.override_id
         WHERE t.employee_email = @email AND (
           (o.override_date = @date AND o.from_time_utc < '18:30:00') OR
           (o.override_date = @prevDate AND o.from_time_utc >= '18:30:00')
         )`
      );

    const status: "draft" | "submitted" | null = taskCheck.recordset.length > 0
      ? taskCheck.recordset[0].status
      : null;
    const submitted = status === "submitted";

    // Check overrides first (already stored as hourly rows)
    const overrides = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .input("prevDate", pDate)
      .query(
        `SELECT o.id, o.from_time_utc, o.to_time_utc, t.task_description, t.project_id
         FROM timesheet_date_overrides o
         LEFT JOIN timesheet_task_entries t ON t.override_id = o.id
         WHERE o.employee_email = @email AND (
           (o.override_date = @date AND o.from_time_utc < '18:30:00') OR
           (o.override_date = @prevDate AND o.from_time_utc >= '18:30:00')
         )
         ORDER BY CASE WHEN o.from_time_utc >= '18:30:00' THEN 0 ELSE 1 END, o.from_time_utc`
      );

    if (overrides.recordset.length > 0) {
      // Override rows are already hourly — return them with IST times
      const hours = overrides.recordset.map((r: any) => {
        const fromRaw = r.from_time_utc instanceof Date
          ? r.from_time_utc.toISOString()
          : String(r.from_time_utc);
        const toRaw = r.to_time_utc instanceof Date
          ? r.to_time_utc.toISOString()
          : String(r.to_time_utc);
        const fromUtc = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
        const toUtc = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);
        return {
          from_time_ist: utcToIst(fromUtc),
          to_time_ist: utcToIst(toUtc),
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

    const hours: { from_time_ist: string; to_time_ist: string; task_description: string }[] = [];
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
        hours.push({ from_time_ist: utcToIst(slot.from), to_time_ist: utcToIst(slot.to), task_description: "" });
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

    // Check if already submitted (final) for this IST date
    const pDateCheck = prevDay(date);
    const existing = await pool.request()
      .input("email", email)
      .input("date", date)
      .input("prevDate", pDateCheck)
      .query(
        `SELECT TOP 1 t.status 
         FROM timesheet_task_entries t
         JOIN timesheet_date_overrides o ON o.id = t.override_id
         WHERE t.employee_email = @email AND (
           (o.override_date = @date AND o.from_time_utc < '18:30:00') OR
           (o.override_date = @prevDate AND o.from_time_utc >= '18:30:00')
         )`
      );

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
      // Get existing overrides with their task entry status (both possible dates)
      const pDate = prevDay(date);
      const existingOverrides = await transaction.request()
        .input("email", email)
        .input("date", date)
        .input("prevDate", pDate)
        .query(
          `SELECT o.id, o.from_time_utc, o.to_time_utc, t.id as task_id, t.status as task_status
           FROM timesheet_date_overrides o
           LEFT JOIN timesheet_task_entries t ON t.override_id = o.id
           WHERE o.employee_email = @email AND (
             (o.override_date = @date AND o.from_time_utc < '18:30:00') OR
             (o.override_date = @prevDate AND o.from_time_utc >= '18:30:00')
           )
           ORDER BY CASE WHEN o.from_time_utc >= '18:30:00' THEN 0 ELSE 1 END, o.from_time_utc`
        );

      // Build a map of existing overrides by time slot
      const overrideMap = new Map<string, { id: number; hasTask: boolean; taskId: number | null; taskStatus: string | null }>();
      for (const r of existingOverrides.recordset) {
        const fromRaw = r.from_time_utc instanceof Date ? r.from_time_utc.toISOString() : String(r.from_time_utc);
        const toRaw = r.to_time_utc instanceof Date ? r.to_time_utc.toISOString() : String(r.to_time_utc);
        const fromStr = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
        const toStr = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);
        overrideMap.set(`${fromStr}-${toStr}`, { id: r.id, hasTask: r.task_id !== null, taskId: r.task_id, taskStatus: r.task_status });
      }

      let savedCount = 0;

      for (const hour of hours) {
        // Convert IST from/to to UTC for lookup and storage
        const fromUtc = istToUtcTime(hour.from);
        const toUtc = istToUtcTime(hour.to);
        const key = `${fromUtc}-${toUtc}`;
        const existing = overrideMap.get(key);

        if (existing && existing.hasTask) {
          if (existing.taskStatus === "submitted") {
            // Submitted task — locked, cannot change
            if (action === "submit") {
              await transaction.request()
                .input("taskId", existing.taskId)
                .input("status", "submitted")
                .query("UPDATE timesheet_task_entries SET status = @status WHERE id = @taskId");
            }
            savedCount++;
            continue;
          }
          // Draft task — update description, project, and status
          await transaction.request()
            .input("taskId", existing.taskId)
            .input("taskDescription", hour.taskDescription || "")
            .input("status", status)
            .input("projectId", hour.projectId || null)
            .query("UPDATE timesheet_task_entries SET task_description = @taskDescription, status = @status, project_id = @projectId WHERE id = @taskId");
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
          // No override yet — insert one with correct UTC date
          const utcDate = getUtcDate(date, fromUtc);
          const insertResult = await transaction.request()
            .input("email", email)
            .input("utcDate", utcDate)
            .input("from", fromUtc)
            .input("to", toUtc)
            .query("INSERT INTO timesheet_date_overrides (employee_email, override_date, from_time_utc, to_time_utc) OUTPUT INSERTED.id VALUES (@email, @utcDate, @from, @to)");
          overrideId = insertResult.recordset[0].id;
        }

        // Insert task entry with correct UTC date
        const taskUtcDate = getUtcDate(date, fromUtc);
        await transaction.request()
          .input("email", email)
          .input("utcDate", taskUtcDate)
          .input("taskDescription", hour.taskDescription)
          .input("overrideId", overrideId)
          .input("status", status)
          .input("projectId", hour.projectId || null)
          .query("INSERT INTO timesheet_task_entries (employee_email, task_date, task_description, submitted_at_utc, override_id, status, project_id) VALUES (@email, @utcDate, @taskDescription, GETUTCDATE(), @overrideId, @status, @projectId)");
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

    // Get all task entries for the date range (expand by 1 day to catch UTC dates that map to IST range)
    const prevStart = prevDay(startDate as string);
    const result = await pool.request()
      .input("startDate", prevStart)
      .input("endDate", endDate as string)
      .query(
        `SELECT 
           t.employee_email, e.name AS employee_name,
           t.task_date, t.task_description, t.status, t.project_id,
           p.name AS project_name,
           o.from_time_utc, o.to_time_utc, o.override_date
         FROM timesheet_task_entries t
         JOIN timesheet_employees e ON e.email = t.employee_email
         LEFT JOIN timesheet_projects p ON p.id = t.project_id
         LEFT JOIN timesheet_date_overrides o ON o.id = t.override_id
         WHERE t.task_date >= @startDate AND t.task_date <= @endDate
         ORDER BY e.name, t.task_date, o.from_time_utc`
      );

    const rows = result.recordset.map((r: any) => {
      const fromRaw = r.from_time_utc instanceof Date ? r.from_time_utc.toISOString() : String(r.from_time_utc || "");
      const toRaw = r.to_time_utc instanceof Date ? r.to_time_utc.toISOString() : String(r.to_time_utc || "");
      const fromUtc = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
      const toUtc = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);

      // Get override_date as string
      const overrideDateRaw = r.override_date instanceof Date
        ? r.override_date.toISOString().split("T")[0]
        : String(r.override_date || "").split("T")[0];

      // Convert UTC date+time together to IST date+time
      let istDate = overrideDateRaw;
      let fromIst: string | null = null;
      let toIst: string | null = null;
      if (fromUtc && overrideDateRaw) {
        const fromResult = utcDateTimeToIst(overrideDateRaw, fromUtc);
        istDate = fromResult.date;
        fromIst = fromResult.time;
      }
      if (toUtc && overrideDateRaw) {
        toIst = utcDateTimeToIst(overrideDateRaw, toUtc).time;
      }

      return {
        employee_email: r.employee_email,
        employee_name: r.employee_name,
        task_date: istDate,
        task_description: r.task_description,
        status: r.status,
        project_id: r.project_id,
        project_name: r.project_name,
        from_time_ist: fromIst,
        to_time_ist: toIst,
      };
    });

    // Filter to only rows whose IST date falls within the requested range
    const filtered = rows.filter((r: any) => r.task_date >= (startDate as string) && r.task_date <= (endDate as string));

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching weekly report:", err);
    res.status(500).json({ error: "Failed to fetch weekly report" });
  }
});

export default router;
