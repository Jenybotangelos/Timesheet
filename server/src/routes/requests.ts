import { Router } from "express";
import { getPool } from "../db";

const router = Router();

const BUCKETS = ["Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live"];

// GET /api/requests?email=... — Get requests (own for employees, all for admins)
router.get("/", async (req, res) => {
  try {
    const email = req.query.email as string;
    if (!email) return res.status(400).json({ error: "email is required" });

    const pool = await getPool();

    // Check role
    const userCheck = await pool.request()
      .input("email", email)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");
    const isAdmin = userCheck.recordset.length > 0 && userCheck.recordset[0].role === "admin";

    let result;
    if (isAdmin) {
      result = await pool.request().query(
        `SELECT r.*, e.name AS requested_by_name
         FROM timesheet_requests r
         LEFT JOIN timesheet_employees e ON e.email = r.requested_by
         ORDER BY r.created_at DESC`
      );
    } else {
      result = await pool.request()
        .input("email", email)
        .query(
          `SELECT r.*, e.name AS requested_by_name
           FROM timesheet_requests r
           LEFT JOIN timesheet_employees e ON e.email = r.requested_by
           WHERE r.requested_by = @email
           ORDER BY r.created_at DESC`
        );
    }

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching requests:", err);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

// POST /api/requests — Create a new request
router.post("/", async (req, res) => {
  try {
    const { email, type, name, description, project_id, stages } = req.body;
    if (!email || !type || !name) {
      return res.status(400).json({ error: "email, type, and name are required" });
    }
    if (!["project", "task"].includes(type)) {
      return res.status(400).json({ error: "type must be 'project' or 'task'" });
    }
    if (type === "task" && !project_id) {
      return res.status(400).json({ error: "project_id is required for task requests" });
    }

    const pool = await getPool();
    await pool.request()
      .input("type", type)
      .input("name", name)
      .input("description", description || "")
      .input("project_id", type === "task" ? project_id : null)
      .input("requested_by", email)
      .input("stages", stages ? JSON.stringify(stages) : null)
      .query(
        `INSERT INTO timesheet_requests (type, name, description, project_id, requested_by, stages)
         VALUES (@type, @name, @description, @project_id, @requested_by, @stages)`
      );

    res.json({ success: true });
  } catch (err) {
    console.error("Error creating request:", err);
    res.status(500).json({ error: "Failed to create request" });
  }
});

// PUT /api/requests/:id — Update a pending request (admin only)
router.put("/:id", async (req, res) => {
  try {
    const { email, name, description, stages } = req.body;
    const { id } = req.params;
    if (!email) return res.status(400).json({ error: "email is required" });

    const pool = await getPool();
    const userCheck = await pool.request()
      .input("email", email)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");
    if (userCheck.recordset.length === 0 || userCheck.recordset[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can edit requests" });
    }

    const result = await pool.request()
      .input("id", parseInt(id))
      .input("name", name || null)
      .input("description", description || null)
      .input("stages", stages ? JSON.stringify(stages) : null)
      .query(
        `UPDATE timesheet_requests
         SET name = ISNULL(@name, name), description = ISNULL(@description, description), stages = ISNULL(@stages, stages)
         WHERE id = @id AND status = 'pending'`
      );

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Request not found or not pending" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating request:", err);
    res.status(500).json({ error: "Failed to update request" });
  }
});

// PATCH /api/requests/bulk — Bulk approve/reject (admin only)
router.patch("/bulk", async (req, res) => {
  try {
    const { email, ids, action, admin_notes } = req.body;
    if (!email || !Array.isArray(ids) || ids.length === 0 || !action) {
      return res.status(400).json({ error: "email, ids[], and action are required" });
    }
    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
    }

    const pool = await getPool();

    // Verify admin
    const userCheck = await pool.request()
      .input("email", email)
      .query("SELECT role FROM timesheet_employees WHERE email = @email");
    if (userCheck.recordset.length === 0 || userCheck.recordset[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can approve/reject requests" });
    }

    // Fetch the requests to process
    const idPlaceholders = ids.map((_: any, i: number) => `@id${i}`).join(",");
    const fetchReq = pool.request();
    ids.forEach((id: number, i: number) => fetchReq.input(`id${i}`, id));
    const requests = await fetchReq.query(
      `SELECT * FROM timesheet_requests WHERE id IN (${idPlaceholders}) AND status = 'pending'`
    );

    if (requests.recordset.length === 0) {
      return res.status(404).json({ error: "No pending requests found with given IDs" });
    }

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      for (const r of requests.recordset) {
        // Update status
        await transaction.request()
          .input("id", r.id)
          .input("status", action)
          .input("admin_notes", admin_notes || null)
          .input("reviewed_by", email)
          .query(
            `UPDATE timesheet_requests
             SET status = @status, admin_notes = @admin_notes, reviewed_by = @reviewed_by, reviewed_at = GETUTCDATE()
             WHERE id = @id`
          );

        // On approval, create real entries
        if (action === "approved") {
          if (r.type === "project") {
            // Create the project
            const projInsert = await transaction.request()
              .input("name", r.name)
              .input("description", r.description || "")
              .input("created_by", r.requested_by)
              .query(
                `INSERT INTO timesheet_projects (name, description, created_by)
                 OUTPUT INSERTED.id
                 VALUES (@name, @description, @created_by)`
              );
            const newProjectId = projInsert.recordset[0].id;

            // If stages contains embedded tasks, create them
            if (r.stages) {
              let parsed: any;
              try { parsed = JSON.parse(r.stages); } catch { parsed = {}; }
              const taskList = parsed.tasks || [];
              for (const taskData of taskList) {
                const tInsert = await transaction.request()
                  .input("projectId", newProjectId)
                  .input("taskName", taskData.name)
                  .input("taskDesc", taskData.description || "")
                  .query(
                    `INSERT INTO timesheet_project_tasks (project_id, task_name, description)
                     OUTPUT INSERTED.id
                     VALUES (@projectId, @taskName, @taskDesc)`
                  );
                const taskId = tInsert.recordset[0].id;

                const stageEntries = Object.entries(taskData.stages || {}) as [string, any][];
                for (const [bucketName, stageData] of stageEntries) {
                  if (!BUCKETS.includes(bucketName)) continue;
                  const bInsert = await transaction.request()
                    .input("taskId", taskId)
                    .input("bucketName", bucketName)
                    .input("expectedHours", stageData.expectedHours || 0)
                    .input("priority", stageData.priority || "medium")
                    .input("startDate", stageData.startDate || null)
                    .input("endDate", stageData.endDate || null)
                    .query(
                      `INSERT INTO timesheet_task_buckets (task_id, bucket_name, priority, expected_hours, status, start_date, end_date)
                       OUTPUT INSERTED.id
                       VALUES (@taskId, @bucketName, @priority, @expectedHours, 'not_started', @startDate, @endDate)`
                    );
                  const bucketId = bInsert.recordset[0].id;

                  const assignees: string[] = stageData.assignedTo && stageData.assignedTo.length > 0
                    ? stageData.assignedTo : [r.requested_by];
                  for (const assignee of assignees) {
                    await transaction.request()
                      .input("bucketId", bucketId)
                      .input("assignee", assignee)
                      .query(
                        `INSERT INTO timesheet_bucket_assignees (bucket_id, employee_email)
                         VALUES (@bucketId, @assignee)`
                      );
                  }

                  // Insert acceptance criteria
                  if (stageData.acceptanceCriteria && Array.isArray(stageData.acceptanceCriteria)) {
                    for (const criteria of stageData.acceptanceCriteria) {
                      if (criteria && criteria.trim()) {
                        await transaction.request()
                          .input("bucketId", bucketId)
                          .input("criteria", criteria.trim())
                          .query(
                            `INSERT INTO timesheet_bucket_criteria (bucket_id, criteria)
                             VALUES (@bucketId, @criteria)`
                          );
                      }
                    }
                  }
                }
              }
            }
          } else if (r.type === "task") {
            // Create a single task under existing project
            const taskInsert = await transaction.request()
              .input("projectId", r.project_id)
              .input("name", r.name)
              .input("description", r.description || "")
              .query(
                `INSERT INTO timesheet_project_tasks (project_id, task_name, description)
                 OUTPUT INSERTED.id
                 VALUES (@projectId, @name, @description)`
              );
            const taskId = taskInsert.recordset[0].id;

            // Parse stages — can be rich object or simple array
            let stageEntries: [string, any][] = [];
            if (r.stages) {
              let parsed: any;
              try { parsed = JSON.parse(r.stages); } catch { parsed = null; }
              if (Array.isArray(parsed)) {
                stageEntries = parsed.map((s: string) => [s, { expectedHours: 0, assignedTo: [r.requested_by] }]);
              } else if (parsed) {
                stageEntries = Object.entries(parsed);
              }
            } else {
              stageEntries = BUCKETS.map((b) => [b, { expectedHours: 0, assignedTo: [r.requested_by] }]);
            }

            for (const [bucketName, stageData] of stageEntries) {
              if (!BUCKETS.includes(bucketName)) continue;
              const bInsert = await transaction.request()
                .input("taskId", taskId)
                .input("bucketName", bucketName)
                .input("expectedHours", stageData?.expectedHours || 0)
                .input("priority", stageData?.priority || "medium")
                .input("startDate", stageData?.startDate || null)
                .input("endDate", stageData?.endDate || null)
                .query(
                  `INSERT INTO timesheet_task_buckets (task_id, bucket_name, priority, expected_hours, status, start_date, end_date)
                   OUTPUT INSERTED.id
                   VALUES (@taskId, @bucketName, @priority, @expectedHours, 'not_started', @startDate, @endDate)`
                );
              const bucketId = bInsert.recordset[0].id;

              const assignees: string[] = stageData?.assignedTo && stageData.assignedTo.length > 0
                ? stageData.assignedTo : [r.requested_by];
              for (const assignee of assignees) {
                await transaction.request()
                  .input("bucketId", bucketId)
                  .input("assignee", assignee)
                  .query(
                    `INSERT INTO timesheet_bucket_assignees (bucket_id, employee_email)
                     VALUES (@bucketId, @assignee)`
                  );
              }

              // Insert acceptance criteria
              if (stageData?.acceptanceCriteria && Array.isArray(stageData.acceptanceCriteria)) {
                for (const criteria of stageData.acceptanceCriteria) {
                  if (criteria && criteria.trim()) {
                    await transaction.request()
                      .input("bucketId", bucketId)
                      .input("criteria", criteria.trim())
                      .query(
                        `INSERT INTO timesheet_bucket_criteria (bucket_id, criteria)
                         VALUES (@bucketId, @criteria)`
                      );
                  }
                }
              }
            }
          }
        }
      }

      await transaction.commit();
      res.json({ success: true, processed: requests.recordset.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error("Error processing requests:", err);
    res.status(500).json({ error: "Failed to process requests" });
  }
});

export default router;
