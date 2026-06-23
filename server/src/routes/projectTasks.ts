import { Router } from "express";
import { getPool } from "../db";

const router = Router();

const BUCKETS = ["Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live"];

// GET /api/project-tasks/:projectId — Get all tasks with buckets and assignees for a project
router.get("/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const pool = await getPool();

    // Get tasks
    const tasksResult = await pool.request()
      .input("projectId", parseInt(projectId))
      .query("SELECT id, task_name, created_at FROM timesheet_project_tasks WHERE project_id = @projectId ORDER BY created_at");

    const tasks = [];
    for (const task of tasksResult.recordset) {
      // Get buckets for this task
      const bucketsResult = await pool.request()
        .input("taskId", task.id)
        .query("SELECT id, bucket_name, start_date, end_date, priority, expected_hours, status, consumption_hr FROM timesheet_task_buckets WHERE task_id = @taskId ORDER BY id");

      const buckets: Record<string, any> = {};
      for (const bucket of bucketsResult.recordset) {
        // Get assignees for this bucket
        const assigneesResult = await pool.request()
          .input("bucketId", bucket.id)
          .query("SELECT employee_email FROM timesheet_bucket_assignees WHERE bucket_id = @bucketId");

        // Get criteria for this bucket
        const criteriaResult = await pool.request()
          .input("bucketId2", bucket.id)
          .query("SELECT criteria FROM timesheet_bucket_criteria WHERE bucket_id = @bucketId2 ORDER BY id");

        buckets[bucket.bucket_name] = {
          id: bucket.id,
          startDate: bucket.start_date ? bucket.start_date.toISOString().split("T")[0] : "",
          endDate: bucket.end_date ? bucket.end_date.toISOString().split("T")[0] : "",
          priority: bucket.priority || "medium",
          expectedHours: bucket.expected_hours || 0,
          consumptionHr: bucket.consumption_hr || 0,
          status: bucket.status || "not_started",
          completed: bucket.status === "completed",
          inProgress: bucket.status === "in_progress",
          acceptanceCriteria: criteriaResult.recordset.length > 0 ? criteriaResult.recordset.map((c: any) => c.criteria) : [""],
          assignedTo: assigneesResult.recordset.map((a: any) => a.employee_email),
        };
      }

      tasks.push({
        id: task.id.toString(),
        name: task.task_name,
        buckets,
        expanded: false,
      });
    }

    res.json(tasks);
  } catch (err: any) {
    console.error("Error fetching project tasks:", err);
    res.status(500).json({ error: "Failed to fetch project tasks" });
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

      for (const task of tasks) {
        let taskId: number;

        if (task.id && existingIds.has(task.id.toString())) {
          // Update existing task
          taskId = parseInt(task.id);
          incomingIds.add(task.id.toString());
          await transaction.request()
            .input("id", taskId)
            .input("name", task.name)
            .query("UPDATE timesheet_project_tasks SET task_name = @name WHERE id = @id");
        } else {
          // Insert new task
          const insertResult = await transaction.request()
            .input("projectId", parseInt(projectId))
            .input("name", task.name)
            .query("INSERT INTO timesheet_project_tasks (project_id, task_name) OUTPUT INSERTED.id VALUES (@projectId, @name)");
          taskId = insertResult.recordset[0].id;
          incomingIds.add(taskId.toString());
        }

        // Delete existing buckets for this task (cascade deletes assignees too)
        await transaction.request()
          .input("taskId", taskId)
          .query("DELETE FROM timesheet_task_buckets WHERE task_id = @taskId");

        // Insert buckets
        for (const bucketName of BUCKETS) {
          const bucketData = task.buckets[bucketName];
          if (!bucketData) continue;

          const status = bucketData.completed ? "completed" : bucketData.inProgress ? "in_progress" : "not_started";

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

          const bucketId = bucketInsert.recordset[0].id;

          // Insert assignees
          if (bucketData.assignedTo && bucketData.assignedTo.length > 0) {
            for (const email of bucketData.assignedTo) {
              await transaction.request()
                .input("bucketId", bucketId)
                .input("email", email)
                .query("INSERT INTO timesheet_bucket_assignees (bucket_id, employee_email) VALUES (@bucketId, @email)");
            }
          }

          // Insert acceptance criteria
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
      res.json({ message: "Tasks saved", taskCount: tasks.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: any) {
    console.error("Error saving project tasks:", err);
    res.status(500).json({ error: "Failed to save project tasks" });
  }
});

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

export default router;
