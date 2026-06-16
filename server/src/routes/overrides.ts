import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// Helper: convert block (from, to) in UTC HH:mm to individual 1-hour rows
// e.g., "04:30" to "07:30" → ["04:30-05:30", "05:30-06:30", "06:30-07:30"]
function blockToHours(from: string, to: string): { from: string; to: string }[] {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const startMin = fh * 60 + fm;
  const endMin = th * 60 + tm;

  const hours: { from: string; to: string }[] = [];
  for (let m = startMin; m < endMin; m += 60) {
    const nextM = Math.min(m + 60, endMin);
    if (nextM - m < 60 && nextM === endMin) {
      // Last partial chunk — still include it as the remainder
      // Only add if there's something left
      if (nextM > m) {
        hours.push({
          from: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
          to: `${String(Math.floor(nextM / 60)).padStart(2, "0")}:${String(nextM % 60).padStart(2, "0")}`,
        });
      }
    } else {
      hours.push({
        from: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
        to: `${String(Math.floor(nextM / 60)).padStart(2, "0")}:${String(nextM % 60).padStart(2, "0")}`,
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
    const result = await pool.request()
      .input("email", email as string)
      .input("date", date as string)
      .query(
        `SELECT id, from_time_utc, to_time_utc 
         FROM timesheet_date_overrides
         WHERE employee_email = @email AND override_date = @date
         ORDER BY from_time_utc`
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
      return {
        id: r.id,
        from_time_utc: fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5),
        to_time_utc: toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5),
      };
    });

    const blocks = hoursToBlocks(rows);
    res.json(blocks);
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

    // Convert blocks to individual hour rows
    const hourRows: { from: string; to: string }[] = [];
    for (const block of blocks) {
      const hours = blockToHours(block.from, block.to);
      hourRows.push(...hours);
    }

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get existing overrides for this email + date, with task entry info
      const existing = await transaction.request()
        .input("email", email)
        .input("date", date)
        .query(
          `SELECT o.id, o.from_time_utc, o.to_time_utc, 
                  CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END as has_task
           FROM timesheet_date_overrides o
           LEFT JOIN timesheet_task_entries t ON t.override_id = o.id
           WHERE o.employee_email = @email AND o.override_date = @date
           ORDER BY o.from_time_utc`
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
          hasTask: r.has_task === 1,
        };
      });

      let inserted = 0;
      let updated = 0;
      let deleted = 0;
      let skipped = 0;

      // Update rows that exist at same index position
      const updateCount = Math.min(existingRows.length, hourRows.length);
      for (let i = 0; i < updateCount; i++) {
        const ex = existingRows[i];
        const hr = hourRows[i];
        if (ex.from !== hr.from || ex.to !== hr.to) {
          if (ex.hasTask) {
            skipped++;
            continue; // Skip — has task entry, cannot change
          }
          await transaction.request()
            .input("id", ex.id)
            .input("from", hr.from)
            .input("to", hr.to)
            .query("UPDATE timesheet_date_overrides SET from_time_utc = @from, to_time_utc = @to WHERE id = @id");
          updated++;
        }
      }

      // Insert new rows (if incoming has more than existing)
      for (let i = existingRows.length; i < hourRows.length; i++) {
        const hr = hourRows[i];
        await transaction.request()
          .input("email", email)
          .input("date", date)
          .input("from", hr.from)
          .input("to", hr.to)
          .query(
            "INSERT INTO timesheet_date_overrides (employee_email, override_date, from_time_utc, to_time_utc) VALUES (@email, @date, @from, @to)"
          );
        inserted++;
      }

      // Delete extra rows (if existing has more than incoming) — skip rows with tasks
      for (let i = hourRows.length; i < existingRows.length; i++) {
        if (existingRows[i].hasTask) {
          skipped++;
          continue;
        }
        await transaction.request()
          .input("id", existingRows[i].id)
          .query("DELETE FROM timesheet_date_overrides WHERE id = @id");
        deleted++;
      }

      await transaction.commit();
      res.json({
        message: "Override saved",
        inserted,
        updated,
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
