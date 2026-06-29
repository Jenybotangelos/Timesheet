import { Router } from "express";
import { getPool } from "../db";

const router = Router();

// GET /api/projects — Get all projects with hour totals
router.get("/", async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT p.id, p.name, p.description, p.created_by, p.created_at, p.is_active,
              ISNULL(SUM(tb.expected_hours), 0) AS total_expected_hr,
              ISNULL(SUM(tb.consumption_hr), 0) AS total_consumption_hr
       FROM timesheet_projects p
       LEFT JOIN timesheet_project_tasks pt ON pt.project_id = p.id
       LEFT JOIN timesheet_task_buckets tb ON tb.task_id = pt.id
       GROUP BY p.id, p.name, p.description, p.created_by, p.created_at, p.is_active
       ORDER BY p.created_at DESC`
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching projects:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST /api/projects — Create a new project (admin only)
router.post("/", async (req, res) => {
  try {
    const { email, name, description } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: "email and name are required" });
    }

    const pool = await getPool();

    // Check if user is admin
    const userCheck = await pool.request()
      .input("email", email)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");

    if (userCheck.recordset.length === 0 || userCheck.recordset[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can create projects" });
    }

    await pool.request()
      .input("name", name)
      .input("description", description || "")
      .input("created_by", email)
      .query(
        "INSERT INTO timesheet_projects (name, description, created_by) VALUES (@name, @description, @created_by)"
      );

    res.json({ success: true });
  } catch (err) {
    console.error("Error creating project:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// PUT /api/projects/:id — Update a project (admin only)
router.put("/:id", async (req, res) => {
  try {
    const { email, name, description, is_active } = req.body;
    const { id } = req.params;

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const pool = await getPool();

    // Check if user is admin
    const userCheck = await pool.request()
      .input("email", email)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");

    if (userCheck.recordset.length === 0 || userCheck.recordset[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can update projects" });
    }

    await pool.request()
      .input("id", parseInt(id))
      .input("name", name)
      .input("description", description || "")
      .input("is_active", is_active !== undefined ? is_active : true)
      .query(
        "UPDATE timesheet_projects SET name = @name, description = @description, is_active = @is_active WHERE id = @id"
      );

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating project:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// DELETE /api/projects/:id — Delete a project (admin only)
router.delete("/:id", async (req, res) => {
  try {
    const { email } = req.query;
    const { id } = req.params;

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const pool = await getPool();

    // Check if user is admin
    const userCheck = await pool.request()
      .input("email", email as string)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");

    if (userCheck.recordset.length === 0 || userCheck.recordset[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can delete projects" });
    }

    await pool.request()
      .input("id", parseInt(id))
      .query("DELETE FROM timesheet_projects WHERE id = @id");

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting project:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
