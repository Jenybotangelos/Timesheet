import { Router } from "express";
import { getPool } from "../db";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const router = Router();

// S3 client (will fail gracefully if credentials not set)
let s3: S3Client | null = null;
const BUCKET = process.env.AWS_S3_BUCKET || "";
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && BUCKET) {
  s3 = new S3Client({
    region: process.env.AWS_REGION || "eu-north-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

// --- COMMENTS ---

// GET /api/task-activity/comments/:bucketId
router.get("/comments/:bucketId", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("bucketId", parseInt(req.params.bucketId))
      .query(
        `SELECT c.id, c.message, c.employee_email, c.created_at, e.name AS employee_name
         FROM timesheet_task_comments c
         LEFT JOIN timesheet_employees e ON e.email = c.employee_email
         WHERE c.bucket_id = @bucketId
         ORDER BY c.created_at ASC`
      );
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// POST /api/task-activity/comments/:bucketId
router.post("/comments/:bucketId", async (req, res) => {
  try {
    const { email, message } = req.body;
    if (!email || !message?.trim()) {
      return res.status(400).json({ error: "email and message are required" });
    }
    const pool = await getPool();
    await pool.request()
      .input("bucketId", parseInt(req.params.bucketId))
      .input("email", email)
      .input("message", message.trim())
      .query(
        `INSERT INTO timesheet_task_comments (bucket_id, employee_email, message)
         VALUES (@bucketId, @email, @message)`
      );
    res.json({ success: true });
  } catch (err) {
    console.error("Error posting comment:", err);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// --- ATTACHMENTS ---

// GET /api/task-activity/attachments/:bucketId
router.get("/attachments/:bucketId", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("bucketId", parseInt(req.params.bucketId))
      .query(
        `SELECT a.id, a.filename, a.s3_key, a.file_size, a.uploaded_by, a.created_at, e.name AS uploaded_by_name
         FROM timesheet_attachments a
         LEFT JOIN timesheet_employees e ON e.email = a.uploaded_by
         WHERE a.bucket_id = @bucketId
         ORDER BY a.created_at DESC`
      );
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching attachments:", err);
    res.status(500).json({ error: "Failed to fetch attachments" });
  }
});

// GET /api/task-activity/upload-url — Generate presigned upload URL
router.get("/upload-url", async (req, res) => {
  try {
    if (!s3) {
      return res.status(503).json({ error: "S3 not configured" });
    }
    const { filename, bucketId } = req.query;
    if (!filename || !bucketId) {
      return res.status(400).json({ error: "filename and bucketId are required" });
    }

    const key = `attachments/${bucketId}/${crypto.randomUUID()}-${filename}`;
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({ url, key });
  } catch (err) {
    console.error("Error generating upload URL:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// POST /api/task-activity/attachments/:bucketId — Save attachment metadata after upload
router.post("/attachments/:bucketId", async (req, res) => {
  try {
    const { email, filename, s3_key, file_size } = req.body;
    if (!email || !filename || !s3_key) {
      return res.status(400).json({ error: "email, filename, and s3_key are required" });
    }
    const pool = await getPool();
    await pool.request()
      .input("bucketId", parseInt(req.params.bucketId))
      .input("filename", filename)
      .input("s3Key", s3_key)
      .input("fileSize", file_size || null)
      .input("uploadedBy", email)
      .query(
        `INSERT INTO timesheet_attachments (bucket_id, filename, s3_key, file_size, uploaded_by)
         VALUES (@bucketId, @filename, @s3Key, @fileSize, @uploadedBy)`
      );
    res.json({ success: true });
  } catch (err) {
    console.error("Error saving attachment:", err);
    res.status(500).json({ error: "Failed to save attachment" });
  }
});

// GET /api/task-activity/download-url/:id — Generate presigned download URL
router.get("/download-url/:id", async (req, res) => {
  try {
    if (!s3) {
      return res.status(503).json({ error: "S3 not configured" });
    }
    const pool = await getPool();
    const result = await pool.request()
      .input("id", parseInt(req.params.id))
      .query("SELECT s3_key, filename FROM timesheet_attachments WHERE id = @id");

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const { s3_key } = result.recordset[0];
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3_key });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({ url });
  } catch (err) {
    console.error("Error generating download URL:", err);
    res.status(500).json({ error: "Failed to generate download URL" });
  }
});

// DELETE /api/task-activity/attachments/:id
router.delete("/attachments/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input("id", parseInt(req.params.id))
      .query("DELETE FROM timesheet_attachments WHERE id = @id");
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting attachment:", err);
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

export default router;
