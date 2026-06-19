import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// GET /api/employees — Get all employee names
router.get("/", async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT id, name, email, role FROM timesheet_employees ORDER BY name"
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching employees:", err);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

export default router;
