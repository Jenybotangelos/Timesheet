import { Router } from "express";
import { getPool } from "../db";

const router = Router();

const BUCKETS = ["Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live"];

// GET /api/project-tasks/my-board?email=...
// Returns all tasks/buckets assigned to employee(s) across all projects
// Supports multiple emails: ?email=a@x.com,b@x.com
router.get("/my-board", async (req, res) => {
  try {
    const emailParam = req.query.email as string;
    if (!emailParam) {
      return res.status(400).json({ error: "email query param is required" });
    }

    const emails = emailParam.split(",").map((e) => e.trim()).filter(Boolean);
    const pool = await getPool();

    // Build a dynamic IN clause for emails
    const emailPlaceholders = emails.map((_, i) => `@email${i}`).join(",");
    const request = pool.request();
    emails.forEach((email, i) => request.input(`email${i}`, email));

    const result = await request.query(`
      SELECT 
        t.id AS taskId,
        t.task_name AS taskName,
        t.description,
        p.id AS projectId,
        p.name AS projectName,
        b.id AS bucketId,
        b.bucket_name AS bucketName,
        b.priority,
        b.status,
        b.start_date AS startDate,
        b.end_date AS endDate,
        b.expected_hours AS expectedHours,
        b.consumption_hr AS consumptionHr,
        (SELECT MAX(te.task_date) FROM timesheet_task_entries te WHERE te.bucket_id = b.id) AS lastEntryDate,
        a.employee_email AS assignedEmail
      FROM timesheet_bucket_assignees a
      JOIN timesheet_task_buckets b ON a.bucket_id = b.id
      JOIN timesheet_project_tasks t ON b.task_id = t.id
      JOIN timesheet_projects p ON t.project_id = p.id
      WHERE a.employee_email IN (${emailPlaceholders})
      ORDER BY b.bucket_name, t.task_name
    `);

    // Group by bucketId to merge assignees
    const bucketMap = new Map<number, any>();
    for (const row of result.recordset) {
      if (bucketMap.has(row.bucketId)) {
        bucketMap.get(row.bucketId).assignedTo.push(row.assignedEmail);
      } else {
        bucketMap.set(row.bucketId, {
          taskId: row.taskId,
          taskName: row.taskName,
          description: row.description || "",
          projectId: row.projectId,
          projectName: row.projectName,
          bucketId: row.bucketId,
          bucketName: row.bucketName,
          priority: row.priority || "medium",
          status: row.status || "not_started",
          startDate: row.startDate ? row.startDate.toISOString().split("T")[0] : "",
          endDate: row.endDate ? row.endDate.toISOString().split("T")[0] : "",
          expectedHours: row.expectedHours || 0,
          consumptionHr: row.consumptionHr || 0,
          lastEntryDate: row.lastEntryDate ? row.lastEntryDate.toISOString().split("T")[0] : "",
          assignedTo: [row.assignedEmail],
        });
      }
    }

    const tasks = Array.from(bucketMap.values());
    res.json(tasks);
  } catch (err: any) {
    console.error("Error fetching my-board:", err);
    res.status(500).json({ error: "Failed to fetch board tasks" });
  }
});

// GET /api/project-tasks/:projectId — Get tasks list (fast, no bucket details)
router.get("/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const pool = await getPool();

    const tasksResult = await pool.request()
      .input("projectId", parseInt(projectId))
      .query("SELECT id, task_name, description, created_at FROM timesheet_project_tasks WHERE project_id = @projectId ORDER BY created_at");

    // Get selected stages for each task (just bucket names, no details)
    const tasks = [];
    for (const task of tasksResult.recordset) {
      const bucketsResult = await pool.request()
        .input("taskId", task.id)
        .query("SELECT bucket_name, status FROM timesheet_task_buckets WHERE task_id = @taskId ORDER BY id");

      const selectedStages = bucketsResult.recordset.map((b: any) => b.bucket_name);

      tasks.push({
        id: task.id.toString(),
        name: task.task_name,
        description: task.description || "",
        selectedStages,
        buckets: {},
        expanded: false,
      });
    }

    res.json(tasks);
  } catch (err: any) {
    console.error("Error fetching project tasks:", err);
    res.status(500).json({ error: "Failed to fetch project tasks" });
  }
});

// GET /api/project-tasks/:projectId/:taskId/details — Get full bucket details for one task (on expand)
router.get("/:projectId/:taskId/details", async (req, res) => {
  try {
    const { taskId } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input("taskId", parseInt(taskId))
      .query(`
        SELECT 
          b.id AS bucketId, b.bucket_name, b.start_date, b.end_date, b.priority, 
          b.expected_hours, b.status, b.consumption_hr,
          a.employee_email,
          c.criteria
        FROM timesheet_task_buckets b
        LEFT JOIN timesheet_bucket_assignees a ON a.bucket_id = b.id
        LEFT JOIN timesheet_bucket_criteria c ON c.bucket_id = b.id
        WHERE b.task_id = @taskId
        ORDER BY b.id, a.employee_email, c.id
      `);

    // Reshape into buckets object
    const buckets: Record<string, any> = {};
    for (const row of result.recordset) {
      if (!buckets[row.bucket_name]) {
        buckets[row.bucket_name] = {
          id: row.bucketId,
          startDate: row.start_date ? row.start_date.toISOString().split("T")[0] : "",
          endDate: row.end_date ? row.end_date.toISOString().split("T")[0] : "",
          priority: row.priority || "medium",
          expectedHours: row.expected_hours || 0,
          consumptionHr: row.consumption_hr || 0,
          status: row.status || "not_started",
          completed: row.status === "completed",
          inProgress: row.status === "in_progress",
          assignedTo: new Set<string>(),
          acceptanceCriteria: new Set<string>(),
        };
      }
      if (row.employee_email) {
        buckets[row.bucket_name].assignedTo.add(row.employee_email);
      }
      if (row.criteria) {
        buckets[row.bucket_name].acceptanceCriteria.add(row.criteria);
      }
    }

    // Convert Sets to arrays
    for (const key of Object.keys(buckets)) {
      buckets[key].assignedTo = Array.from(buckets[key].assignedTo);
      buckets[key].acceptanceCriteria = buckets[key].acceptanceCriteria.size > 0
        ? Array.from(buckets[key].acceptanceCriteria)
        : [""];
    }

    res.json(buckets);
  } catch (err: any) {
    console.error("Error fetching task details:", err);
    res.status(500).json({ error: "Failed to fetch task details" });
  }
});

// POST /api/project-tasks/check-conflicts — Check if time slots already have entries
router.post("/check-conflicts", async (req, res) => {
  try {
    const { email, date, slots } = req.body;
    if (!email || !date || !Array.isArray(slots)) {
      return res.status(400).json({ error: "email, date, and slots are required" });
    }

    const pool = await getPool();

    function istToUtc(time: string): string {
      const [h, m] = time.split(":").map(Number);
      let totalMin = h * 60 + m - 330;
      if (totalMin < 0) totalMin += 1440;
      return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
    }

    const conflicts: { from: string; to: string; existingDescription: string }[] = [];

    for (const slot of slots) {
      const fromUtc = istToUtc(slot.from);
      const toUtc = istToUtc(slot.to);

      const result = await pool.request()
        .input("email", email)
        .input("date", date)
        .input("from", fromUtc)
        .input("to", toUtc)
        .query(`
          SELECT te.task_description 
          FROM timesheet_date_overrides o
          JOIN timesheet_task_entries te ON te.override_id = o.id
          WHERE o.employee_email = @email AND o.override_date = @date 
            AND o.from_time_utc = @from AND o.to_time_utc = @to
        `);

      if (result.recordset.length > 0) {
        conflicts.push({
          from: slot.from,
          to: slot.to,
          existingDescription: result.recordset[0].task_description || "",
        });
      }
    }

    res.json({ conflicts });
  } catch (err: any) {
    console.error("Error checking conflicts:", err);
    res.status(500).json({ error: "Failed to check conflicts" });
  }
});

// POST /api/project-tasks/log-time — Log time entries from the board (hour-wise)
router.post("/log-time", async (req, res) => {
  try {
    const { email, date, slots, projectId, projectTaskId, bucketId } = req.body;

    if (!email || !date || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: "email, date, and slots array are required" });
    }

    const pool = await getPool();

    // Convert IST time to UTC (subtract 5:30)
    function istToUtc(time: string): string {
      const [h, m] = time.split(":").map(Number);
      let totalMin = h * 60 + m - 330;
      if (totalMin < 0) totalMin += 1440;
      return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
    }

    let savedCount = 0;

    for (const slot of slots) {
      const fromUtc = istToUtc(slot.from);
      const toUtc = istToUtc(slot.to);

      const existingOverride = await pool.request()
        .input("email", email)
        .input("date", date)
        .input("from", fromUtc)
        .input("to", toUtc)
        .query("SELECT id FROM timesheet_date_overrides WHERE employee_email = @email AND override_date = @date AND from_time_utc = @from AND to_time_utc = @to");

      let overrideId: number;
      if (existingOverride.recordset.length > 0) {
        overrideId = existingOverride.recordset[0].id;
      } else {
        const insertOverride = await pool.request()
          .input("email", email)
          .input("date", date)
          .input("from", fromUtc)
          .input("to", toUtc)
          .query("INSERT INTO timesheet_date_overrides (employee_email, override_date, from_time_utc, to_time_utc) OUTPUT INSERTED.id VALUES (@email, @date, @from, @to)");
        overrideId = insertOverride.recordset[0].id;
      }

      // Check if a task entry already exists for this override
      const existingEntry = await pool.request()
        .input("email", email)
        .input("overrideId", overrideId)
        .query("SELECT id FROM timesheet_task_entries WHERE employee_email = @email AND override_id = @overrideId");

      if (existingEntry.recordset.length > 0) {
        // Update existing entry
        await pool.request()
          .input("entryId", existingEntry.recordset[0].id)
          .input("description", slot.description || "")
          .input("projectId", projectId || null)
          .input("projectTaskId", projectTaskId || null)
          .input("bucketId", bucketId || null)
          .query(`UPDATE timesheet_task_entries SET task_description = @description, project_id = @projectId, project_task_id = @projectTaskId, bucket_id = @bucketId, status = 'submitted' WHERE id = @entryId`);
      } else {
        // Insert new entry
        await pool.request()
          .input("email", email)
          .input("date", date)
          .input("description", slot.description || "")
          .input("overrideId", overrideId)
          .input("projectId", projectId || null)
          .input("projectTaskId", projectTaskId || null)
          .input("bucketId", bucketId || null)
          .query(`INSERT INTO timesheet_task_entries (employee_email, task_date, task_description, submitted_at_utc, override_id, status, project_id, project_task_id, bucket_id)
                  VALUES (@email, @date, @description, GETUTCDATE(), @overrideId, 'submitted', @projectId, @projectTaskId, @bucketId)`);
      }
      savedCount++;
    }

    if (bucketId) {
      await pool.request()
        .input("bucketId", bucketId)
        .query(`UPDATE timesheet_task_buckets
                SET consumption_hr = ISNULL((
                  SELECT SUM(DATEDIFF(MINUTE, o.from_time_utc, o.to_time_utc)) / 60.0
                  FROM timesheet_task_entries te
                  JOIN timesheet_date_overrides o ON o.id = te.override_id
                  WHERE te.bucket_id = @bucketId
                ), 0)
                WHERE id = @bucketId`);
    }

    res.json({ message: `${savedCount} hour(s) logged`, count: savedCount });
  } catch (err: any) {
    console.error("Error logging time:", err);
    res.status(500).json({ error: "Failed to log time" });
  }
});

// POST /api/project-tasks/:projectId — Save all tasks for a project (create/update)
// Body: { tasks: [{ id?, name, buckets: { "Pipeline": { startDate, endDate, priority, expectedHours, completed, inProgress, acceptanceCriteria, assignedTo } } }] }
router.post("/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { tasks } = req.body;

    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: "tasks array is required" });
    }

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get existing task IDs for this project
      const existing = await transaction.request()
        .input("projectId", parseInt(projectId))
        .query("SELECT id FROM timesheet_project_tasks WHERE project_id = @projectId");
      const existingIds = new Set(existing.recordset.map((r: any) => r.id.toString()));

      // Track which IDs are still present
      const incomingIds = new Set<string>();
      const savedTaskIds: { clientId: string; dbId: number }[] = [];

      for (const task of tasks) {
        let taskId: number;

        if (task.id && existingIds.has(task.id.toString())) {
          // Update existing task
          taskId = parseInt(task.id);
          incomingIds.add(task.id.toString());
          await transaction.request()
            .input("id", taskId)
            .input("name", task.name)
            .input("description", task.description || "")
            .query("UPDATE timesheet_project_tasks SET task_name = @name, description = @description WHERE id = @id");
        } else {
          // Insert new task
          const insertResult = await transaction.request()
            .input("projectId", parseInt(projectId))
            .input("name", task.name)
            .input("description", task.description || "")
            .query("INSERT INTO timesheet_project_tasks (project_id, task_name, description) OUTPUT INSERTED.id VALUES (@projectId, @name, @description)");
          taskId = insertResult.recordset[0].id;
          incomingIds.add(taskId.toString());
        }

        savedTaskIds.push({ clientId: task.id, dbId: taskId });

        // Upsert buckets: update existing, insert new, delete removed
        const taskBucketNames = Object.keys(task.buckets || {}).filter((b) => BUCKETS.includes(b));

        // Get existing buckets for this task
        const existingBuckets = await transaction.request()
          .input("taskId", taskId)
          .query("SELECT id, bucket_name FROM timesheet_task_buckets WHERE task_id = @taskId");

        const existingBucketMap = new Map<string, number>();
        for (const row of existingBuckets.recordset) {
          existingBucketMap.set(row.bucket_name, row.id);
        }

        // Delete buckets that are no longer selected
        for (const [existingName, existingId] of existingBucketMap) {
          if (!taskBucketNames.includes(existingName)) {
            await transaction.request()
              .input("delBucketId1", existingId)
              .query("DELETE FROM timesheet_bucket_assignees WHERE bucket_id = @delBucketId1");
            await transaction.request()
              .input("delBucketId2", existingId)
              .query("DELETE FROM timesheet_bucket_criteria WHERE bucket_id = @delBucketId2");
            await transaction.request()
              .input("delBucketId3", existingId)
              .query("DELETE FROM timesheet_task_buckets WHERE id = @delBucketId3");
          }
        }

        // Upsert each bucket
        for (const bucketName of taskBucketNames) {
          const bucketData = task.buckets[bucketName];
          if (!bucketData) continue;

          const status = bucketData.completed ? "completed" : bucketData.inProgress ? "in_progress" : "not_started";
          let bucketId: number;

          if (existingBucketMap.has(bucketName)) {
            // Update existing bucket — ID stays the same
            bucketId = existingBucketMap.get(bucketName)!;
            await transaction.request()
              .input("bucketId", bucketId)
              .input("startDate", bucketData.startDate || null)
              .input("endDate", bucketData.endDate || null)
              .input("priority", bucketData.priority || "medium")
              .input("expectedHours", bucketData.expectedHours || 0)
              .input("status", status)
              .input("consumptionHr", bucketData.consumptionHr || 0)
              .query(`UPDATE timesheet_task_buckets 
                      SET start_date = @startDate, end_date = @endDate, priority = @priority, 
                          expected_hours = @expectedHours, status = @status, consumption_hr = @consumptionHr
                      WHERE id = @bucketId`);
          } else {
            // Insert new bucket
            const bucketInsert = await transaction.request()
              .input("taskId", taskId)
              .input("bucketName", bucketName)
              .input("startDate", bucketData.startDate || null)
              .input("endDate", bucketData.endDate || null)
              .input("priority", bucketData.priority || "medium")
              .input("expectedHours", bucketData.expectedHours || 0)
              .input("status", status)
              .input("consumptionHr", bucketData.consumptionHr || 0)
              .query(`INSERT INTO timesheet_task_buckets (task_id, bucket_name, start_date, end_date, priority, expected_hours, status, consumption_hr)
                      OUTPUT INSERTED.id
                      VALUES (@taskId, @bucketName, @startDate, @endDate, @priority, @expectedHours, @status, @consumptionHr)`);
            bucketId = bucketInsert.recordset[0].id;
          }

          // Replace assignees (no external ID dependency)
          await transaction.request()
            .input("clearAssignees", bucketId)
            .query("DELETE FROM timesheet_bucket_assignees WHERE bucket_id = @clearAssignees");
          if (bucketData.assignedTo && bucketData.assignedTo.length > 0) {
            for (const email of bucketData.assignedTo) {
              await transaction.request()
                .input("bucketId", bucketId)
                .input("email", email)
                .query("INSERT INTO timesheet_bucket_assignees (bucket_id, employee_email) VALUES (@bucketId, @email)");
            }
          }

          // Replace acceptance criteria (no external ID dependency)
          await transaction.request()
            .input("clearCriteria", bucketId)
            .query("DELETE FROM timesheet_bucket_criteria WHERE bucket_id = @clearCriteria");
          if (bucketData.acceptanceCriteria && bucketData.acceptanceCriteria.length > 0) {
            for (const c of bucketData.acceptanceCriteria) {
              if (c.trim()) {
                await transaction.request()
                  .input("bucketId2", bucketId)
                  .input("criteria", c.trim())
                  .query("INSERT INTO timesheet_bucket_criteria (bucket_id, criteria) VALUES (@bucketId2, @criteria)");
              }
            }
          }
        }
      }

      // Delete tasks that were removed
      for (const existId of existingIds) {
        if (!incomingIds.has(existId)) {
          await transaction.request()
            .input("id", parseInt(existId))
            .query("DELETE FROM timesheet_project_tasks WHERE id = @id");
        }
      }

      await transaction.commit();
      res.json({ message: "Tasks saved", taskCount: tasks.length, savedTaskIds });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: any) {
    console.error("Error saving project tasks:", err);
    res.status(500).json({ error: "Failed to save project tasks" });
  }
});

// POST /api/project-tasks/log-time — Log time entries from the board (hour-wise with per-slot descriptions)
// DELETE /api/project-tasks/:projectId/:taskId — Delete a single task
router.delete("/:projectId/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const pool = await getPool();

    await pool.request()
      .input("id", parseInt(taskId))
      .query("DELETE FROM timesheet_project_tasks WHERE id = @id");

    res.json({ message: "Task deleted" });
  } catch (err: any) {
    console.error("Error deleting task:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// PATCH /api/project-tasks/bucket-status/:bucketId — Update bucket status
router.patch("/bucket-status/:bucketId", async (req, res) => {
  try {
    const { bucketId } = req.params;
    const { status } = req.body;

    if (!["not_started", "in_progress", "completed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const pool = await getPool();
    await pool.request()
      .input("id", parseInt(bucketId))
      .input("status", status)
      .query("UPDATE timesheet_task_buckets SET status = @status WHERE id = @id");

    // If marking as completed, activate the next stage of the same task
    let nextBucketId: number | null = null;
    if (status === "completed") {
      // Get the current bucket's task_id and bucket_name
      const currentBucket = await pool.request()
        .input("id", parseInt(bucketId))
        .query("SELECT task_id, bucket_name FROM timesheet_task_buckets WHERE id = @id");

      if (currentBucket.recordset.length > 0) {
        const { task_id, bucket_name } = currentBucket.recordset[0];
        const currentIndex = BUCKETS.indexOf(bucket_name);

        if (currentIndex >= 0 && currentIndex < BUCKETS.length - 1) {
          const nextBucketName = BUCKETS[currentIndex + 1];
          // Find the next bucket for the same task
          const nextBucket = await pool.request()
            .input("taskId", task_id)
            .input("nextName", nextBucketName)
            .query("SELECT id, status FROM timesheet_task_buckets WHERE task_id = @taskId AND bucket_name = @nextName");

          if (nextBucket.recordset.length > 0 && nextBucket.recordset[0].status === "not_started") {
            nextBucketId = nextBucket.recordset[0].id;
            await pool.request()
              .input("nextId", nextBucketId)
              .query("UPDATE timesheet_task_buckets SET status = 'in_progress' WHERE id = @nextId");
          }
        }
      }
    }

    res.json({ message: "Status updated", nextBucketId, nextStatus: nextBucketId ? "in_progress" : undefined });
  } catch (err: any) {
    console.error("Error updating bucket status:", err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;
