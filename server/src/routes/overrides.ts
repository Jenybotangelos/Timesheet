import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// IST offset: UTC time >= 18:30 means it belongs to the NEXT IST day
// So when storing with an IST date, the UTC date should be istDate - 1
function getUtcDate(istDate: string, utcTime: string): string {
  const [h, m] = utcTime.split(":").map(Number);
  if (h * 60 + m >= 1110) { // 18:30
    const d = new Date(istDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split("T")[0];
  }
  return istDate;
}

// Get the previous day string
function prevDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

// Convert IST time to UTC time (combined date+time)
function istToUtcDateTime(istDate: string, istTime: string): { date: string; time: string } {
  const [h, m] = istTime.split(":").map(Number);
  let totalMin = h * 60 + m - 330; // -5:30
  let date = istDate;
  if (totalMin < 0) {
    totalMin += 1440;
    const d = new Date(istDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    date = d.toISOString().split("T")[0];
  }
  const time = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  return { date, time };
}

// Convert UTC time to IST time
function utcToIst(utcTime: string): string {
  const [h, m] = utcTime.split(":").map(Number);
  let totalMin = h * 60 + m + 330; // +5:30
  if (totalMin >= 1440) totalMin -= 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

// Helper: convert block (from, to) in UTC HH:mm to individual 1-hour rows
// e.g., "04:30" to "07:30" → ["04:30-05:30", "05:30-06:30", "06:30-07:30"]
// Handles midnight wrap-around (e.g., "23:30" to "00:30")
function blockToHours(from: string, to: string): { from: string; to: string }[] {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const startMin = fh * 60 + fm;
  let endMin = th * 60 + tm;

  // Handle midnight wrap-around
  if (endMin <= startMin) {
    endMin += 1440;
  }

  const hours: { from: string; to: string }[] = [];
  for (let m = startMin; m < endMin; m += 60) {
    const nextM = Math.min(m + 60, endMin);
    if (nextM > m) {
      const fromMin = m % 1440;
      const toMin = nextM % 1440;
      hours.push({
        from: `${String(Math.floor(fromMin / 60)).padStart(2, "0")}:${String(fromMin % 60).padStart(2, "0")}`,
        to: `${String(Math.floor(toMin / 60)).padStart(2, "0")}:${String(toMin % 60).padStart(2, "0")}`,
      });
    }
  }
  return hours;
}

// Helper: group consecutive hourly rows back into blocks for UI display
function hoursToBlocks(rows: { id: number; from_time_utc: string; to_time_utc: string }[]): { id: number | null; from_time_utc: string; to_time_utc: string }[] {
  if (rows.length === 0) return [];

  const blocks: { id: number | null; from_time_utc: string; to_time_utc: string }[] = [];
  let blockStart = rows[0].from_time_utc;
  let blockEnd = rows[0].to_time_utc;

  for (let i = 1; i < rows.length; i++) {
    const currentFrom = rows[i].from_time_utc;
    // If this row starts where the previous ended, extend the block
    if (currentFrom === blockEnd) {
      blockEnd = rows[i].to_time_utc;
    } else {
      // Save current block and start a new one
      blocks.push({ id: null, from_time_utc: blockStart, to_time_utc: blockEnd });
      blockStart = currentFrom;
      blockEnd = rows[i].to_time_utc;
    }
  }
  // Push last block
  blocks.push({ id: null, from_time_utc: blockStart, to_time_utc: blockEnd });

  return blocks;
}

// GET /api/overrides?email=xxx&date=2026-06-04 — Get override blocks for a person on a date
// Returns grouped blocks for the override UI
router.get("/", async (req, res) => {
  try {
    const { email, date } = req.query;
    if (!email || !date) {
      return res.status(400).json({ error: "email and date are required" });
    }

    const pool = await getPool();
    const prevDate = prevDay(date as string);
    const result = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .input("prevDate", prevDate)
      .query(
        `SELECT id, from_time_utc, to_time_utc 
         FROM timesheet_date_overrides
         WHERE employee_email = @email AND (
           (override_date = @date AND from_time_utc < '18:30:00') OR
           (override_date = @prevDate AND from_time_utc >= '18:30:00')
         )
         ORDER BY CASE WHEN from_time_utc >= '18:30:00' THEN 0 ELSE 1 END, from_time_utc`
      );

    // If no overrides exist, return empty array
    if (result.recordset.length === 0) {
      return res.json([]);
    }

    // Group hourly rows back into blocks for the UI
    const rows = result.recordset.map((r: any) => {
      const fromRaw = r.from_time_utc instanceof Date
        ? r.from_time_utc.toISOString()
        : String(r.from_time_utc);
      const toRaw = r.to_time_utc instanceof Date
        ? r.to_time_utc.toISOString()
        : String(r.to_time_utc);
      const fromUtc = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
      const toUtc = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);
      return {
        id: r.id,
        from_time_utc: fromUtc,
        to_time_utc: toUtc,
      };
    });

    const blocks = hoursToBlocks(rows);
    // Return IST times to frontend
    const istBlocks = blocks.map((b) => ({
      ...b,
      from_time_ist: utcToIst(b.from_time_utc),
      to_time_ist: utcToIst(b.to_time_utc),
    }));
    res.json(istBlocks);
  } catch (err) {
    console.error("Error fetching overrides:", err);
    res.status(500).json({ error: "Failed to fetch overrides" });
  }
});

// POST /api/overrides — Smart save: update existing, insert new, delete removed
// Body: { email: "jeny@company.com", date: "2026-06-04", blocks: [{ id?: 1, from: "04:00", to: "07:00" }, { from: "09:00", to: "13:00" }] }
router.post("/", async (req, res) => {
  try {
    const { email, date, blocks } = req.body;

    if (!email || !date || !Array.isArray(blocks)) {
      return res.status(400).json({ error: "email, date, and blocks array are required" });
    }

    // Convert IST blocks to UTC hour rows
    const hourRows: { from: string; to: string; utcDate: string }[] = [];
    for (const block of blocks) {
      const fromUtc = istToUtcDateTime(date, block.from);
      const toUtc = istToUtcDateTime(date, block.to);
      const hours = blockToHours(fromUtc.time, toUtc.time);
      for (const hr of hours) {
        hourRows.push({ ...hr, utcDate: getUtcDate(date, hr.from) });
      }
    }

    // Check for duplicate hour slots
    const hourSet = new Set<string>();
    for (const hr of hourRows) {
      const key = `${hr.from}-${hr.to}`;
      if (hourSet.has(key)) {
        return res.status(400).json({ error: `Duplicate hour slot found: ${hr.from} - ${hr.to}. Please remove overlapping blocks.` });
      }
      hourSet.add(key);
    }

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get existing overrides for this IST date (query both dates)
      const pDate = prevDay(date);
      const existing = await transaction.request()
        .input("email", email)
        .input("date", date)
        .input("prevDate", pDate)
        .query(
          `SELECT o.id, o.from_time_utc, o.to_time_utc, o.override_date,
                  t.id as task_id, t.status as task_status
           FROM timesheet_date_overrides o
           LEFT JOIN timesheet_task_entries t ON t.override_id = o.id
           WHERE o.employee_email = @email AND (
             (o.override_date = @date AND o.from_time_utc < '18:30:00') OR
             (o.override_date = @prevDate AND o.from_time_utc >= '18:30:00')
           )
           ORDER BY CASE WHEN o.from_time_utc >= '18:30:00' THEN 0 ELSE 1 END, o.from_time_utc`
        );

      const existingRows = existing.recordset.map((r: any) => {
        const fromRaw = r.from_time_utc instanceof Date
          ? r.from_time_utc.toISOString()
          : String(r.from_time_utc);
        const toRaw = r.to_time_utc instanceof Date
          ? r.to_time_utc.toISOString()
          : String(r.to_time_utc);
        return {
          id: r.id,
          from: fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5),
          to: toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5),
          taskId: r.task_id,
          taskStatus: r.task_status,
          isSubmitted: r.task_status === "submitted",
        };
      });

      // Build a map of existing overrides by time slot key (keep first, track duplicates)
      const existingMap = new Map<string, typeof existingRows[0]>();
      const duplicateRows: typeof existingRows = [];
      for (const ex of existingRows) {
        const key = `${ex.from}-${ex.to}`;
        if (existingMap.has(key)) {
          duplicateRows.push(ex); // duplicate — mark for cleanup
        } else {
          existingMap.set(key, ex);
        }
      }

      // Build a set of desired time slots
      const desiredSet = new Set<string>();
      for (const hr of hourRows) {
        desiredSet.add(`${hr.from}-${hr.to}`);
      }

      let inserted = 0;
      let deleted = 0;
      let skipped = 0;

      // Clean up duplicate override rows first
      for (const dup of duplicateRows) {
        if (dup.isSubmitted) continue;
        await transaction.request()
          .input("overrideId", dup.id)
          .query("DELETE FROM timesheet_task_entries WHERE override_id = @overrideId");
        await transaction.request()
          .input("id", dup.id)
          .query("DELETE FROM timesheet_date_overrides WHERE id = @id");
        deleted++;
      }

      // Insert new hour rows that don't already exist
      for (const hr of hourRows) {
        const key = `${hr.from}-${hr.to}`;
        if (!existingMap.has(key)) {
          await transaction.request()
            .input("email", email)
            .input("utcDate", hr.utcDate)
            .input("from", hr.from)
            .input("to", hr.to)
            .query(
              "INSERT INTO timesheet_date_overrides (employee_email, override_date, from_time_utc, to_time_utc) VALUES (@email, @utcDate, @from, @to)"
            );
          inserted++;
        }
      }

      // Delete existing rows that are NOT in the desired set
      for (const [key, ex] of existingMap) {
        if (!desiredSet.has(key)) {
          if (ex.isSubmitted) {
            skipped++;
            continue; // Never delete submitted tasks
          }
          // Delete ALL task entries linked to this override (not just one)
          await transaction.request()
            .input("overrideId", ex.id)
            .query("DELETE FROM timesheet_task_entries WHERE override_id = @overrideId");
          await transaction.request()
            .input("id", ex.id)
            .query("DELETE FROM timesheet_date_overrides WHERE id = @id");
          deleted++;
        }
      }

      await transaction.commit();
      res.json({
        message: "Override saved",
        inserted,
        deleted,
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error("Error saving overrides:", err);
    res.status(500).json({ error: "Failed to save overrides" });
  }
});

export default router;
