import { Router } from "express";
import { getPool } from "../db";

const router = Router();

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

// GET /api/default-blocks?email=xxx — Get default blocks for a person
router.get("/", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("email", email as string)
      .query(
        `SELECT id, from_time_utc, to_time_utc 
         FROM timesheet_default_blocks
         WHERE employee_email = @email
         ORDER BY from_time_utc`
      );

    // If no default blocks exist, return fallback: 9:00-13:00 & 14:00-18:00 IST
    if (result.recordset.length === 0) {
      return res.json([
        { id: null, from_time_ist: "09:00", to_time_ist: "13:00" },
        { id: null, from_time_ist: "14:00", to_time_ist: "18:00" },
      ]);
    }

    const blocks = result.recordset.map((r: any) => {
      const fromRaw = r.from_time_utc instanceof Date ? r.from_time_utc.toISOString() : String(r.from_time_utc);
      const toRaw = r.to_time_utc instanceof Date ? r.to_time_utc.toISOString() : String(r.to_time_utc);
      const fromUtc = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
      const toUtc = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);
      return { id: r.id, from_time_ist: utcToIst(fromUtc), to_time_ist: utcToIst(toUtc) };
    });

    res.json(blocks);
    console.log(`Fetched default blocks for ${email}:`, blocks);
  } catch (err) {
    console.error("Error fetching default blocks:", err);
    res.status(500).json({ error: "Failed to fetch default blocks" });
  }
});

// POST /api/default-blocks — Smart save: insert new, update existing, delete removed
// Body: { email: "jeny@company.com", blocks: [{ id?: 1, from: "09:00", to: "13:00" }, { from: "14:00", to: "18:00" }] }
router.post("/", async (req, res) => {
  try {
    const { email, blocks } = req.body;

    if (!email || !Array.isArray(blocks)) {
      return res.status(400).json({ error: "email and blocks array are required" });
    }

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get existing blocks for this email
      const existing = await transaction.request()
        .input("email", email)
        .query("SELECT id, from_time_utc, to_time_utc FROM timesheet_default_blocks WHERE employee_email = @email");

      const existingRows = existing.recordset;

      // Separate incoming blocks into updates vs inserts
      const toUpdate: typeof blocks = [];
      const toInsert: typeof blocks = [];
      const incomingIds = new Set<number>();

      for (const block of blocks) {
        if (block.id) {
          incomingIds.add(block.id);
          toUpdate.push(block);
        } else {
          toInsert.push(block);
        }
      }

      // Delete blocks that were removed (exist in DB but not in incoming payload)
      const existingIds = existingRows.map((r: any) => r.id);
      const toDelete = existingIds.filter((id: number) => !incomingIds.has(id));

      for (const id of toDelete) {
        await transaction.request()
          .input("id", id)
          .query("DELETE FROM timesheet_default_blocks WHERE id = @id");
      }

      // Update existing blocks (incoming from/to are IST, convert to UTC)
      for (const block of toUpdate) {
        await transaction.request()
          .input("id", block.id)
          .input("from", istToUtcTime(block.from))
          .input("to", istToUtcTime(block.to))
          .query(
            "UPDATE timesheet_default_blocks SET from_time_utc = @from, to_time_utc = @to WHERE id = @id"
          );
      }

      // Insert new blocks (incoming from/to are IST, convert to UTC)
      for (const block of toInsert) {
        await transaction.request()
          .input("email", email)
          .input("from", istToUtcTime(block.from))
          .input("to", istToUtcTime(block.to))
          .query(
            "INSERT INTO timesheet_default_blocks (employee_email, from_time_utc, to_time_utc) VALUES (@email, @from, @to)"
          );
      }

      await transaction.commit();
      res.json({
        message: "Default blocks saved",
        inserted: toInsert.length,
        updated: toUpdate.length,
        deleted: toDelete.length,
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error("Error saving default blocks:", err);
    res.status(500).json({ error: "Failed to save default blocks" });
  }
});

export default router;
