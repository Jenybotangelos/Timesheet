import express from "express";
import cors from "cors";
import employeesRouter from "../server/src/routes/employees";
import defaultBlocksRouter from "../server/src/routes/defaultBlocks";
import overridesRouter from "../server/src/routes/overrides";
import tasksRouter from "../server/src/routes/tasks";
import scheduleRouter from "../server/src/routes/schedule";
import authRouter from "../server/src/routes/auth";

const app = express();

app.use(cors());
app.use(express.json());

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Routes
app.use("/api/employees", employeesRouter);
app.use("/api/default-blocks", defaultBlocksRouter);
app.use("/api/overrides", overridesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/auth", authRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", env: !!process.env.DB_SERVER });
});

export default app;
