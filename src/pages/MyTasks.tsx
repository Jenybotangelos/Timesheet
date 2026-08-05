import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

interface TaskCard {
  taskId: number;
  taskName: string;
  projectId: number;
  projectName: string;
  bucketId: number;
  bucketName: string;
  priority: "low" | "medium" | "high";
  status: "not_started" | "in_progress" | "completed";
  startDate: string;
  endDate: string;
  expectedHours: number;
  consumptionHr: number;
  description: string;
  lastEntryDate: string;
  assignedTo: string[];
}

const PRIORITY_COLORS = {
  low: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  high: "bg-red-500/20 text-red-400 border-red-500/40",
};

const STATUS_COLORS = {
  not_started: "bg-white/10 text-white/50 border-white/20",
  in_progress: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
};

const COLUMN_COLORS = [
  "border-t-blue-500",
  "border-t-purple-500",
  "border-t-orange-500",
  "border-t-cyan-500",
  "border-t-pink-500",
  "border-t-green-500",
];

const STAGE_ORDER = ["Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live"];

// Sort priority: overdue > in_progress > not_started > completed
function getTaskSortOrder(task: TaskCard): number {
  const today = new Date().toISOString().split("T")[0];
  const isOverdue = task.endDate && task.endDate < today && task.status !== "completed";
  if (isOverdue) return 0;
  if (task.status === "in_progress") return 1;
  if (task.status === "not_started") return 2;
  return 3; // completed
}

interface TimeEntryModal {
  task: TaskCard;
  date: string;
  fromTime: string;
  toTime: string;
  hourSlots: { from: string; to: string; description: string; conflict?: string }[];
}

export default function MyTasks({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [entryModal, setEntryModal] = useState<TimeEntryModal | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([userEmail]);
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [modalTab, setModalTab] = useState<"time" | "chat" | "attachments">("time");
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [attachments, setAttachments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  // Fetch employees list
  useEffect(() => {
    fetch("/api/employees")
      .then((res) => res.json())
      .then((data) => setEmployees(data))
      .catch((err) => console.error("Failed to fetch employees:", err));
  }, []);

  // Fetch tasks for selected employees
  useEffect(() => {
    if (selectedEmails.length === 0) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/project-tasks/my-board?email=${encodeURIComponent(selectedEmails.join(","))}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setTasks(data);
        }
      })
      .catch((err) => console.error("Failed to fetch board tasks:", err))
      .finally(() => setLoading(false));
  }, [selectedEmails]);

  function toggleEmployee(email: string) {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  }

  // Apply project filter
  const filteredTasks = projectFilter ? tasks.filter((t) => t.projectName === projectFilter) : tasks;

  // Separate shared tasks (assigned to ALL selected) vs individual
  const isMultiSelect = selectedEmails.length > 1;
  const sharedTasks = isMultiSelect
    ? filteredTasks.filter((t) => selectedEmails.every((email) => t.assignedTo.includes(email)))
    : [];
  const individualTasks = isMultiSelect
    ? filteredTasks.filter((t) => !selectedEmails.every((email) => t.assignedTo.includes(email)))
    : filteredTasks;

  // Group tasks by bucket name (stage) — shared first, then individual
  const bucketGroups: Record<string, TaskCard[]> = {};
  // Initialize all 6 stages (always visible)
  for (const stage of STAGE_ORDER) {
    bucketGroups[stage] = [];
  }
  // Add shared tasks first
  for (const task of sharedTasks) {
    if (!bucketGroups[task.bucketName]) bucketGroups[task.bucketName] = [];
    bucketGroups[task.bucketName].push(task);
  }
  // Then individual tasks
  for (const task of individualTasks) {
    if (!bucketGroups[task.bucketName]) bucketGroups[task.bucketName] = [];
    bucketGroups[task.bucketName].push(task);
  }

  // Sort cards within each stage: overdue → in_progress → not_started → completed
  for (const key of Object.keys(bucketGroups)) {
    bucketGroups[key].sort((a, b) => getTaskSortOrder(a) - getTaskSortOrder(b));
  }

  // Stages always in defined order
  const bucketNames = STAGE_ORDER;

  function getProgressPercent(task: TaskCard) {
    if (!task.expectedHours || task.expectedHours === 0) return 0;
    return Math.min(100, Math.round((task.consumptionHr / task.expectedHours) * 100));
  }

  async function updateStatus(bucketId: number, newStatus: string) {
    try {
      const res = await fetch(`/api/project-tasks/bucket-status/${bucketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const result = await res.json();

      // Update local state
      setTasks((prev) => {
        let updated = prev.map((t) =>
          t.bucketId === bucketId ? { ...t, status: newStatus as TaskCard["status"] } : t
        );
        // If next bucket was activated, update it too
        if (result.nextBucketId) {
          updated = updated.map((t) =>
            t.bucketId === result.nextBucketId ? { ...t, status: "in_progress" as TaskCard["status"] } : t
          );
        }
        return updated;
      });
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  }

  function openEntryModal(task: TaskCard) {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const currentHour = now.getHours().toString().padStart(2, "0") + ":00";
    const nextHour = (now.getHours() + 1).toString().padStart(2, "0") + ":00";
    const modal: TimeEntryModal = {
      task,
      date: today,
      fromTime: currentHour,
      toTime: nextHour,
      hourSlots: [{ from: currentHour, to: nextHour, description: "" }],
    };
    setEntryModal(modal);
    setModalTab("time");
    setComments([]);
    setAttachments([]);
    checkConflicts(modal);
    loadComments(task.bucketId);
    loadAttachments(task.bucketId);
  }

  function updateTimeRange(fromTime: string, toTime: string) {
    if (!entryModal) return;
    const [fromH, fromM] = fromTime.split(":").map(Number);
    const [toH, toM] = toTime.split(":").map(Number);
    const startMin = fromH * 60 + fromM;
    const endMin = toH * 60 + toM;

    const slots: { from: string; to: string; description: string; conflict?: string }[] = [];
    if (endMin > startMin) {
      for (let min = startMin; min < endMin; min += 60) {
        const slotEnd = Math.min(min + 60, endMin);
        const slotFrom = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
        const slotTo = `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`;
        const existing = entryModal.hourSlots.find((s) => s.from === slotFrom && s.to === slotTo);
        slots.push({ from: slotFrom, to: slotTo, description: existing?.description || "", conflict: undefined });
      }
    }
    const updated = { ...entryModal, fromTime, toTime, hourSlots: slots };
    setEntryModal(updated);
    // Check conflicts
    checkConflicts(updated);
  }

  async function checkConflicts(modal: TimeEntryModal) {
    if (modal.hourSlots.length === 0) return;
    try {
      const res = await fetch("/api/project-tasks/check-conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, date: modal.date, slots: modal.hourSlots }),
      });
      const data = await res.json();
      if (data.conflicts && data.conflicts.length > 0) {
        setEntryModal((prev) => {
          if (!prev) return prev;
          const updatedSlots = prev.hourSlots.map((slot) => {
            const conflict = data.conflicts.find((c: any) => c.from === slot.from && c.to === slot.to);
            return { ...slot, conflict: conflict ? conflict.existingDescription : undefined };
          });
          return { ...prev, hourSlots: updatedSlots };
        });
      }
    } catch (err) {
      console.error("Failed to check conflicts:", err);
    }
  }

  async function saveTimeEntry() {
    if (!entryModal) return;
    const hasEmpty = entryModal.hourSlots.some((s) => !s.description.trim());
    if (hasEmpty) { alert("Please fill description for all hours"); return; }

    setSavingEntry(true);
    try {
      const res = await fetch("/api/project-tasks/log-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          date: entryModal.date,
          slots: entryModal.hourSlots,
          projectId: entryModal.task.projectId,
          projectTaskId: entryModal.task.taskId,
          bucketId: entryModal.task.bucketId,
        }),
      });
      if (res.ok) {
        setEntryModal(null);
        // Refresh tasks to get updated consumptionHr
        const refreshRes = await fetch(`/api/project-tasks/my-board?email=${encodeURIComponent(selectedEmails.join(","))}`);
        const data = await refreshRes.json();
        if (Array.isArray(data)) setTasks(data);
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to save time entry:", err);
      alert("Failed to save");
    } finally {
      setSavingEntry(false);
    }
  }

  async function loadComments(bucketId: number) {
    try {
      const res = await fetch(`/api/task-activity/comments/${bucketId}`);
      const data = await res.json();
      if (Array.isArray(data)) setComments(data);
    } catch (err) { console.error("Failed to load comments:", err); }
  }

  async function postComment() {
    if (!entryModal || !newComment.trim()) return;
    try {
      await fetch(`/api/task-activity/comments/${entryModal.task.bucketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, message: newComment }),
      });
      setNewComment("");
      await loadComments(entryModal.task.bucketId);
    } catch (err) { console.error("Failed to post comment:", err); }
  }

  async function loadAttachments(bucketId: number) {
    try {
      const res = await fetch(`/api/task-activity/attachments/${bucketId}`);
      const data = await res.json();
      if (Array.isArray(data)) setAttachments(data);
    } catch (err) { console.error("Failed to load attachments:", err); }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!entryModal || !e.target.files?.length) return;
    const file = e.target.files[0];
    setUploading(true);
    try {
      // Get presigned URL
      const urlRes = await fetch(`/api/task-activity/upload-url?filename=${encodeURIComponent(file.name)}&bucketId=${entryModal.task.bucketId}`);
      if (!urlRes.ok) {
        const err = await urlRes.json();
        alert(err.error || "Upload not available");
        return;
      }
      const { url, key } = await urlRes.json();

      // Upload to S3
      await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });

      // Save metadata
      await fetch(`/api/task-activity/attachments/${entryModal.task.bucketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, filename: file.name, s3_key: key, file_size: file.size }),
      });

      await loadAttachments(entryModal.task.bucketId);
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function downloadAttachment(id: number) {
    try {
      const res = await fetch(`/api/task-activity/download-url/${id}`);
      if (!res.ok) { alert("Download not available"); return; }
      const { url } = await res.json();
      window.open(url, "_blank");
    } catch (err) { console.error("Download failed:", err); }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center">
        <p className="text-white/60">Loading your tasks...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="text-[#4fc3f7] hover:text-white transition-colors"
            >
              ← Back
            </button>
            <div className="flex bg-white/10 rounded-lg border border-white/20 p-0.5">
              <button
                className="px-4 py-1.5 rounded-md text-sm font-medium transition-all bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50"
              >
                My Tasks
              </button>
              <button
                onClick={() => navigate("/my-projects")}
                className="px-4 py-1.5 rounded-md text-sm font-medium transition-all text-white/40 hover:text-white/70 hover:bg-white/10"
              >
                Add Project
              </button>
            </div>
            <span className="text-white/30 text-sm">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} across {bucketNames.length} stage{bucketNames.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Employee Multi-Select */}
            <div className="flex flex-wrap gap-1 items-center">
              {selectedEmails.map((email) => {
                const emp = employees.find((e) => e.email === email);
                return (
                  <span key={email} className="px-2 py-0.5 rounded-full text-xs bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50 flex items-center gap-1">
                    {emp?.name || email.split("@")[0]}{email === userEmail ? " (Me)" : ""}
                    <button onClick={() => toggleEmployee(email)} className="text-[#4fc3f7] hover:text-red-400 text-xs leading-none">&times;</button>
                  </span>
                );
              })}
              <select
                value=""
                onChange={(e) => { if (e.target.value) toggleEmployee(e.target.value); }}
                className="border border-white/20 rounded-lg px-2 py-1 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] cursor-pointer"
              >
                <option value="" className="bg-[#1a1c2e] text-white/50">+ Add employee</option>
                {employees
                  .filter((emp) => !selectedEmails.includes(emp.email))
                  .map((emp) => (
                    <option key={emp.email} value={emp.email} className="bg-[#1a1c2e] text-white">
                      {emp.name}
                    </option>
                  ))}
              </select>
            </div>
            {/* Project Filter */}
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="border border-white/20 rounded-lg px-2 py-1 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] cursor-pointer"
            >
              <option value="" className="bg-[#1a1c2e] text-white/50">All Projects</option>
              {[...new Set(tasks.map((t) => t.projectName))].sort().map((name) => (
                <option key={name} value={name} className="bg-[#1a1c2e] text-white">{name}</option>
              ))}
            </select>
            {/* View Mode Toggle */}
            <button
              onClick={() => setViewMode("board")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                viewMode === "board"
                  ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                  : "bg-white/5 text-white/40 border-white/15 hover:bg-white/10"
              }`}
            >
              Board
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                viewMode === "list"
                  ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                  : "bg-white/5 text-white/40 border-white/15 hover:bg-white/10"
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 flex flex-col" style={{ height: "calc(100vh - 73px)" }}>
        {viewMode === "board" ? (
          /* Kanban Board View */
          <div className="flex gap-4 overflow-x-auto pb-4 flex-1 scroll-thin">
            {bucketNames.map((bucketName, colIdx) => (
              <div
                key={bucketName}
                className={`flex-shrink-0 w-80 bg-white/5 backdrop-blur-md rounded-xl border border-white/15 border-t-4 ${COLUMN_COLORS[colIdx % COLUMN_COLORS.length]} flex flex-col`}
              >
                {/* Column Header */}
                <div className="px-4 py-3 border-b border-white/10">
                  <div className="flex items-center justify-between">
                    <h2 className="text-white font-semibold text-sm uppercase tracking-wide">
                      {bucketName}
                    </h2>
                    <span className="text-white/30 text-xs bg-white/10 px-2 py-0.5 rounded-full">
                      {bucketGroups[bucketName].length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3">
                  {bucketGroups[bucketName].map((task) => {
                    const today = new Date().toISOString().split("T")[0];
                    const isOverdue = task.endDate && task.endDate < today && task.status !== "completed";

                    return (
                    <div
                      key={`${task.taskId}-${task.bucketId}`}
                      onClick={() => task.status !== "not_started" && openEntryModal(task)}
                      className={`backdrop-blur-sm rounded-lg border p-4 hover:bg-white/15 transition-all cursor-pointer group ${
                        isOverdue ? "bg-red-500/10 border-red-500/30" : "bg-white/10 border-white/15"
                      }`}
                    >

                      {/* Project Label */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[#4fc3f7] text-xs font-medium truncate">
                          {task.projectName}
                        </span>
                        <div className="flex items-center gap-1">
                          {isMultiSelect && selectedEmails.every((e) => task.assignedTo.includes(e)) && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30">Shared</span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${PRIORITY_COLORS[task.priority]}`}>
                            {task.priority}
                          </span>
                        </div>
                      </div>

                      {/* Task Name */}
                      <h3 className="text-white font-medium text-sm mb-2 group-hover:text-[#4fc3f7] transition-colors">
                        {task.taskName}
                      </h3>

                      {/* Description preview */}
                      {task.description && (
                        <p className="text-white/40 text-xs mb-3 line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      {/* Status Dropdown */}
                      <div className="flex items-center gap-2 mb-3">
                        {task.status === "completed" ? (
                          <span className="px-2 py-1 rounded text-xs font-medium border text-green-400 border-green-500/30 bg-[#1a1c2e]">
                            ✓ Completed
                          </span>
                        ) : (
                          <select
                            value={task.status}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateStatus(task.bucketId, e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] bg-[#1a1c2e] ${
                              task.status === "in_progress" ? "text-orange-400 border-orange-500/30" :
                              "text-white/50 border-white/20"
                            }`}
                          >
                            <option value="not_started" className="bg-[#1a1c2e] text-white">Not Started</option>
                            <option value="in_progress" className="bg-[#1a1c2e] text-white">In Progress</option>
                            <option value="completed" className="bg-[#1a1c2e] text-white">Completed</option>
                          </select>
                        )}
                      </div>

                      {/* Progress Bar */}
                      {task.expectedHours > 0 && (
                        <div className="mb-3">
                          <div className="flex justify-between text-xs text-white/40 mb-1">
                            <span>{task.consumptionHr}h / {task.expectedHours}h</span>
                            <span>{getProgressPercent(task)}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${getProgressPercent(task) >= 100 ? "bg-red-500" : getProgressPercent(task) >= 75 ? "bg-yellow-500" : "bg-[#4fc3f7]"}`}
                              style={{ width: `${getProgressPercent(task)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Dates */}
                      <div className="text-xs text-white/30">
                        <div className="flex items-center gap-1">
                          {task.startDate && <span>{task.startDate}</span>}
                          {task.startDate && task.endDate && <span>—</span>}
                          {task.endDate && <span>{task.endDate}</span>}
                        </div>
                        {task.lastEntryDate && (
                          <div className="mt-1 text-red-400">{task.lastEntryDate}</div>
                        )}
                      </div>

                      {/* Assigned To */}
                      <div className="mt-2 text-xs text-white/40">
                        {task.assignedTo.map((email) => {
                          const emp = employees.find((e) => e.email === email);
                          return emp?.name || email.split("@")[0];
                        }).join(", ")}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Task</th>
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Project</th>
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Stage</th>
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Priority</th>
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Progress</th>
                  <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">Dates</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr
                    key={`${task.taskId}-${task.bucketId}`}
                    className="border-b border-white/5 hover:bg-white/5 transition-all"
                  >
                    <td className="px-4 py-3">
                      <span className="text-white text-sm font-medium">{task.taskName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[#4fc3f7] text-xs">{task.projectName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white/60 text-xs">{task.bucketName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${PRIORITY_COLORS[task.priority]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[task.status]}`}>
                        {task.status === "not_started" ? "Not Started" : task.status === "in_progress" ? "In Progress" : "Completed"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getProgressPercent(task) >= 100 ? "bg-red-500" : getProgressPercent(task) >= 75 ? "bg-yellow-500" : "bg-[#4fc3f7]"}`}
                            style={{ width: `${getProgressPercent(task)}%` }}
                          />
                        </div>
                        <span className="text-white/40 text-xs">{getProgressPercent(task)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white/30 text-xs">
                        {task.startDate || "—"} → {task.endDate || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Task Modal */}
      {entryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={() => setEntryModal(null)}>
          <div className="bg-[#1a1c2e] border border-white/20 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex overflow-hidden" onClick={(e) => e.stopPropagation()}>

            {/* LEFT — Task Details + Time Entry + Attachments */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-6 pt-5 pb-3 border-b border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-white font-semibold text-lg">{entryModal.task.taskName}</h2>
                  <button onClick={() => setEntryModal(null)} className="text-white/40 hover:text-white text-lg">×</button>
                </div>
                <div className="flex gap-4 text-xs text-white/40">
                  <span>Project: <span className="text-[#4fc3f7]">{entryModal.task.projectName}</span></span>
                  <span>Stage: <span className="text-white/70">{entryModal.task.bucketName}</span></span>
                </div>
              </div>

              {/* Tabs */}
              <div className="px-6 pt-3 flex gap-1">
                <button onClick={() => setModalTab("time")}
                  className={`px-4 py-2 rounded-t-lg text-xs font-medium border-b-2 transition-all ${
                    modalTab === "time" ? "border-[#4fc3f7] text-[#4fc3f7] bg-white/5" : "border-transparent text-white/40 hover:text-white/70"
                  }`}>Time Entry</button>
                <button onClick={() => setModalTab("attachments")}
                  className={`px-4 py-2 rounded-t-lg text-xs font-medium border-b-2 transition-all ${
                    modalTab === "attachments" ? "border-[#4fc3f7] text-[#4fc3f7] bg-white/5" : "border-transparent text-white/40 hover:text-white/70"
                  }`}>Attachments ({attachments.length})</button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto scroll-thin px-6 py-4">
                {/* Time Entry Tab */}
                {modalTab === "time" && (
                  <div>
                    {entryModal.task.status === "completed" ? (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-center">
                        <span className="text-green-400 text-sm font-medium">✓ This task is completed</span>
                        <p className="text-white/40 text-xs mt-1">Time submission is disabled for completed tasks</p>
                      </div>
                    ) : (
                    <div>
                    <div className="mb-3">
                      <label className="block text-xs text-white/50 mb-1">Date</label>
                      <input type="date" value={entryModal.date}
                        onChange={(e) => { const updated = { ...entryModal, date: e.target.value }; setEntryModal(updated); checkConflicts(updated); }}
                        className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="block text-xs text-white/50 mb-1">From</label>
                        <input type="time" value={entryModal.fromTime}
                          onChange={(e) => updateTimeRange(e.target.value, entryModal.toTime)}
                          className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                      </div>
                      <div>
                        <label className="block text-xs text-white/50 mb-1">To</label>
                        <input type="time" value={entryModal.toTime}
                          onChange={(e) => updateTimeRange(entryModal.fromTime, e.target.value)}
                          className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                      </div>
                    </div>
                    {entryModal.hourSlots.length > 0 && (
                      <div className="mb-4 space-y-3">
                        <label className="block text-xs text-white/50">Description per hour</label>
                        {entryModal.hourSlots.map((slot, idx) => (
                          <div key={idx}>
                            <div className="flex gap-3 items-start">
                              <span className="text-xs text-white/40 whitespace-nowrap pt-2 min-w-[90px]">{slot.from} — {slot.to}</span>
                              <input type="text" value={slot.description}
                                onChange={(e) => { const updated = [...entryModal.hourSlots]; updated[idx] = { ...updated[idx], description: e.target.value }; setEntryModal({ ...entryModal, hourSlots: updated }); }}
                                placeholder="What did you work on?"
                                className="flex-1 border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                            </div>
                            {slot.conflict && (
                              <div className="ml-[102px] mt-1 text-xs text-yellow-400">⚠️ Already submitted: "{slot.conflict}" — will be overwritten</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end gap-3">
                      <button onClick={saveTimeEntry} disabled={savingEntry || entryModal.hourSlots.length === 0}
                        className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg text-sm font-medium shadow-md disabled:opacity-50">
                        {savingEntry ? "Saving..." : "Submit Task"}
                      </button>
                      <button onClick={() => { setEntryModal({ ...entryModal, date: new Date().toISOString().split("T")[0] }); saveTimeEntry(); }}
                        disabled={savingEntry || entryModal.hourSlots.length === 0}
                        className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-700 text-white rounded-lg text-sm font-medium shadow-md disabled:opacity-50">
                        {savingEntry ? "Saving..." : "Submit for Today"}
                      </button>
                    </div>
                    </div>
                    )}
                  </div>
                )}

                {/* Attachments Tab */}
                {modalTab === "attachments" && (
                  <div>
                    <label className="flex items-center justify-center w-full py-4 mb-3 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-[#4fc3f7]/50 hover:bg-white/5 transition-all">
                      <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                      <span className="text-white/40 text-sm">{uploading ? "Uploading..." : "Click to upload a file"}</span>
                    </label>
                    {attachments.length === 0 ? (
                      <p className="text-white/30 text-xs text-center py-4">No attachments yet</p>
                    ) : (
                      <div className="space-y-2">
                        {attachments.map((a: any) => (
                          <div key={a.id} className="flex items-center justify-between bg-white/5 rounded-lg border border-white/10 px-3 py-2">
                            <div>
                              <span className="text-white text-sm">{a.filename}</span>
                              <span className="text-white/30 text-xs ml-2">{a.file_size ? `${(a.file_size / 1024).toFixed(0)} KB` : ""}</span>
                              <p className="text-white/30 text-xs">{a.uploaded_by_name || a.uploaded_by.split("@")[0]} · {new Date(a.created_at).toLocaleDateString()}</p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => downloadAttachment(a.id)}
                                className="px-3 py-1 bg-white/10 text-white/70 border border-white/20 rounded-lg text-xs hover:bg-white/20">View</button>
                              <button onClick={async () => {
                                try {
                                  const res = await fetch(`/api/task-activity/download-url/${a.id}`);
                                  if (!res.ok) return;
                                  const { url } = await res.json();
                                  const link = document.createElement("a"); link.href = url; link.download = a.filename; link.click();
                                } catch {}
                              }}
                                className="px-3 py-1 bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/30 rounded-lg text-xs hover:bg-[#4fc3f7]/30">Download</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — Chat Sidebar */}
            <div className="w-80 border-l border-white/10 flex flex-col bg-white/5">
              <div className="px-4 py-4 border-b border-white/10">
                <h3 className="text-white font-semibold text-sm">Task Chat</h3>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto scroll-thin px-4 py-3 space-y-3">
                {comments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-8">
                    <p className="text-white/30 text-sm font-medium mb-1">Start the conversation</p>
                    <p className="text-white/20 text-xs">Send a message to discuss this task</p>
                  </div>
                ) : comments.map((c: any) => (
                  <div key={c.id} className={`flex flex-col ${c.employee_email === userEmail ? "items-end" : "items-start"}`}>
                    <span className="text-white/40 text-xs mb-1">{c.employee_name || c.employee_email.split("@")[0]}</span>
                    <div className={`max-w-[90%] rounded-lg px-3 py-2 ${
                      c.employee_email === userEmail ? "bg-[#4fc3f7]/20 border border-[#4fc3f7]/30" : "bg-white/10 border border-white/15"
                    }`}>
                      <p className="text-white text-sm">{c.message}</p>
                    </div>
                    <span className="text-white/20 text-xs mt-0.5">
                      {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>

              {/* Message Input */}
              <div className="px-4 py-3 border-t border-white/10">
                <div className="flex gap-2">
                  <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && postComment()}
                    placeholder="Type a message..."
                    className="flex-1 border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                  <button onClick={postComment} disabled={!newComment.trim()}
                    className="px-3 py-2 bg-[#4fc3f7]/20 text-[#4fc3f7] rounded-lg hover:bg-[#4fc3f7]/30 disabled:opacity-30 transition-all">
                    ➤
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
