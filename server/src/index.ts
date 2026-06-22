import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import employeesRouter from "./routes/employees";
import defaultBlocksRouter from "./routes/defaultBlocks";
import overridesRouter from "./routes/overrides";
import tasksRouter from "./routes/tasks";
import scheduleRouter from "./routes/schedule";
import authRouter from "./routes/auth";
import projectsRouter from "./routes/projects";
import cronRouter from "./routes/cron";

// Load env variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/employees", employeesRouter);
app.use("/api/default-blocks", defaultBlocksRouter);
app.use("/api/overrides", overridesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/auth", authRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/cron", cronRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Debug: check table columns (remove later)
app.get("/api/debug/columns/:table", async (req, res) => {
  try {
    const { getPool } = await import("./db");
    const pool = await getPool();
    const result = await pool.request()
      .input("table", req.params.table)
      .query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table");
    res.json(result.recordset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
