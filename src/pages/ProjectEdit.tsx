import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const BUCKETS = [
  "Pipeline",
  "Development",
  "Unit Testing",
  "Integration Testing",
  "UAT",
  "Go Live",
] as const;

type Priority = "low" | "medium" | "high";

interface BucketData {
  startDate: string;
  endDate: string;
  assignedTo: string[];
  priority: Priority;
  expectedHours: number;
  consumptionHr: number;
  acceptanceCriteria: string[];
  completed: boolean;
  inProgress: boolean;
}

interface Task {
  id: string;
  name: string;
  description: string;
  buckets: Record<string, BucketData>;
  selectedStages: string[];
  expanded: boolean;
}

function createEmptyBucketData(): BucketData {
  return {
    startDate: "",
    endDate: "",
    assignedTo: [],
    priority: "medium",
    expectedHours: 0,
    consumptionHr: 0,
    acceptanceCriteria: [""],
    completed: false,
    inProgress: false,
  };
}

// Mock employees for multi-select (replace with API call later)
const EMPLOYEES: string[] = [];

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
};

const BUCKET_COLORS = [
  "from-white/10 to-white/5 border-white/20",
  "from-white/10 to-white/5 border-white/20",
  "from-white/10 to-white/5 border-white/20",
  "from-white/10 to-white/5 border-white/20",
  "from-white/10 to-white/5 border-white/20",
  "from-white/10 to-white/5 border-white/20",
];

export default function ProjectEdit({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectName = searchParams.get("name") || "Project";
  const projectId = searchParams.get("id") || "";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskName, setNewTaskName] = useState("");
  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editName, setEditName] = useState(projectName);
  const [editDescription, setEditDescription] = useState("");

  function handleNavigateBack() {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
    }
    navigate("/projects");
  }

  useEffect(() => {
    fetch("/api/employees")
      .then((res) => res.json())
      .then((data) => setEmployees(data))
      .catch((err) => console.error("Failed to fetch employees:", err));
    // Fetch project details by ID
    if (projectId) {
      fetch(`/api/projects/${projectId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.name) {
            setEditName(data.name);
            setEditDescription(data.description || "");
          }
        })
        .catch((err) => console.error("Failed to fetch project details:", err));
    }
  }, []);

  // Load existing tasks for this project
  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    fetch(`/api/project-tasks/${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setTasks(data);
        }
      })
      .catch((err) => console.error("Failed to fetch tasks:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Load bucket details when a task is expanded
  async function loadTaskDetails(taskId: string) {
    try {
      const res = await fetch(`/api/project-tasks/${projectId}/${taskId}/details`);
      const buckets = await res.json();
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, buckets, selectedStages: Object.keys(buckets).filter((b) => BUCKETS.includes(b as any)) } : t
        )
      );
    } catch (err) {
      console.error("Failed to load task details:", err);
    }
  }

  function addTask() {
    if (!newTaskName.trim()) return;
    const task: Task = {
      id: Date.now().toString(),
      name: newTaskName.trim(),
      description: "",
      buckets: {},
      selectedStages: [],
      expanded: true,
    };
    setTasks([...tasks, task]);
    setNewTaskName("");
    setDirty(true);
  }

  async function removeTask(taskId: string) {
    // If task exists in DB (numeric id), delete from server
    if (!isNaN(Number(taskId))) {
      try {
        await fetch(`/api/project-tasks/${projectId}/${taskId}`, { method: "DELETE" });
      } catch (err) {
        console.error("Failed to delete task:", err);
      }
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  function toggleTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (task && !task.expanded && Object.keys(task.buckets).length === 0 && !isNaN(Number(taskId))) {
      // Load details from server on first expand
      loadTaskDetails(taskId);
    }
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, expanded: !t.expanded } : t)));
  }

  function updateBucket(taskId: string, bucket: string, field: keyof BucketData, value: any) {
    setDirty(true);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          buckets: {
            ...t.buckets,
            [bucket]: { ...t.buckets[bucket], [field]: value },
          },
        };
      })
    );
  }

  function addCriteria(taskId: string, bucket: string) {
    setTasks(
      tasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          buckets: {
            ...t.buckets,
            [bucket]: {
              ...t.buckets[bucket],
              acceptanceCriteria: [...t.buckets[bucket].acceptanceCriteria, ""],
            },
          },
        };
      })
    );
  }

  function updateCriteria(taskId: string, bucket: string, index: number, value: string) {
    setTasks(
      tasks.map((t) => {
        if (t.id !== taskId) return t;
        const criteria = [...t.buckets[bucket].acceptanceCriteria];
        criteria[index] = value;
        return {
          ...t,
          buckets: {
            ...t.buckets,
            [bucket]: { ...t.buckets[bucket], acceptanceCriteria: criteria },
          },
        };
      })
    );
  }

  function removeCriteria(taskId: string, bucket: string, index: number) {
    setTasks(
      tasks.map((t) => {
        if (t.id !== taskId) return t;
        const criteria = t.buckets[bucket].acceptanceCriteria.filter((_, i) => i !== index);
        return {
          ...t,
          buckets: {
            ...t.buckets,
            [bucket]: { ...t.buckets[bucket], acceptanceCriteria: criteria.length ? criteria : [""] },
          },
        };
      })
    );
  }

  function toggleAssignee(taskId: string, bucket: string, email: string) {
    setTasks(
      tasks.map((t) => {
        if (t.id !== taskId) return t;
        const current = t.buckets[bucket].assignedTo;
        const updated = current.includes(email)
          ? current.filter((e) => e !== email)
          : [...current, email];
        return {
          ...t,
          buckets: {
            ...t.buckets,
            [bucket]: { ...t.buckets[bucket], assignedTo: updated },
          },
        };
      })
    );
  }

  function toggleStage(taskId: string, stage: string) {
    setDirty(true);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const isSelected = t.selectedStages.includes(stage);
        if (isSelected) {
          // Remove stage
          const { [stage]: _, ...remainingBuckets } = t.buckets;
          return {
            ...t,
            selectedStages: t.selectedStages.filter((s) => s !== stage),
            buckets: remainingBuckets,
          };
        } else {
          // Add stage
          return {
            ...t,
            selectedStages: [...t.selectedStages, stage],
            buckets: { ...t.buckets, [stage]: createEmptyBucketData() },
          };
        }
      })
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button
            onClick={handleNavigateBack}
            className="text-[#4fc3f7] hover:text-white transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-semibold text-white">Edit Project: {editName}</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30">
            Admin
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-white/60">Loading tasks...</p>
          </div>
        ) : (
        <>
        {/* Project Details */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg">
          <h2 className="text-white font-semibold mb-3">Project Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-white/50 mb-1">Project Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
                placeholder="Project name..."
                className="w-full border border-white/30 rounded-lg px-4 py-2.5 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Project Description</label>
              <input
                type="text"
                value={editDescription}
                onChange={(e) => { setEditDescription(e.target.value); setDirty(true); }}
                placeholder="Project description..."
                className="w-full border border-white/30 rounded-lg px-4 py-2.5 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
              />
            </div>
          </div>
        </div>

        {/* Add Task Section */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg">
          <h2 className="text-white font-semibold mb-3">Add Task</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Enter task name..."
              className="flex-1 border border-white/30 rounded-lg px-4 py-2.5 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
            />
            <button
              onClick={addTask}
              className="px-5 py-2.5 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium transition-all shadow-md"
            >
              + Add Task
            </button>
          </div>
        </div>

        {/* Tasks List */}
        {tasks.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center">
            <p className="text-white/40 text-sm">No tasks added yet. Add a task above to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 shadow-xl overflow-hidden"
              >
                {/* Task Header */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-white/5 transition-all"
                  onClick={() => toggleTask(task.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-white/50 text-sm">{task.expanded ? "▼" : "▶"}</span>
                    <h3 className="text-white font-semibold text-lg">{task.name}</h3>
                    <span className="text-white/30 text-xs">
                      {task.selectedStages.length} stage{task.selectedStages.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTask(task.id);
                    }}
                    className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 text-xs font-medium transition-all"
                  >
                    Remove
                  </button>
                </div>

                {/* Bucket Pipeline */}
                {task.expanded && (
                  <div className="px-5 pb-5">
                    {/* Task Description */}
                    <div className="mb-4">
                      <label className="block text-xs text-white/50 mb-1">Task Description</label>
                      <textarea
                        value={task.description}
                        onChange={(e) => {
                          setDirty(true);
                          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, description: e.target.value } : t));
                        }}
                        placeholder="Describe this task..."
                        rows={2}
                        className="w-full border border-white/20 rounded-lg px-4 py-2 text-sm bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] resize-none"
                      />
                    </div>

                    {/* Stage Selector */}
                    <div className="mb-4">
                      <label className="block text-xs text-white/50 mb-2">Select Stages</label>
                      <div className="flex flex-wrap gap-2">
                        {BUCKETS.map((bucket) => {
                          const isSelected = task.selectedStages.includes(bucket);
                          return (
                            <button
                              key={bucket}
                              onClick={() => toggleStage(task.id, bucket)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                isSelected
                                  ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                                  : "bg-white/5 text-white/40 border-white/15 hover:bg-white/10 hover:text-white/60"
                              }`}
                            >
                              {isSelected ? "✓ " : ""}{bucket}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Pipeline Visual (only selected stages) */}
                    {task.selectedStages.length > 0 && (
                      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-2">
                        {BUCKETS.filter((b) => task.selectedStages.includes(b)).map((bucket, i, arr) => {
                          const b = task.buckets[bucket];
                          if (!b) return null;
                          return (
                            <div key={bucket} className="flex items-center">
                              <div className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border ${b.completed ? "bg-green-500/20 text-green-400 border-green-500/40" : b.inProgress ? "bg-orange-500/20 text-orange-400 border-orange-500/40" : "bg-white/10 text-white/70 border-white/20"}`}>
                                {b.completed ? "✓ " : b.inProgress ? "● " : ""}{bucket}
                              </div>
                              {i < arr.length - 1 && (
                                <span className="text-white/30 mx-1">→</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Bucket Details (only selected stages) */}
                    <div className="space-y-3">
                      {BUCKETS.filter((b) => task.selectedStages.includes(b)).map((bucket, bucketIndex, selectedArr) => {
                        const bucketData = task.buckets[bucket];
                        if (!bucketData) return null;
                        // Determine if this is the first non-completed bucket among selected stages
                        const firstIncompleteIndex = selectedArr.findIndex((b) => !task.buckets[b]?.completed);
                        const isFirstIncomplete = bucketIndex === firstIncompleteIndex;
                        // Show "Set Active" only on the first incomplete bucket that isn't already active
                        const showSetActive = isFirstIncomplete && !bucketData.inProgress;
                        // Show "Mark Complete" only on the currently active bucket
                        const showMarkComplete = bucketData.inProgress;
                        // Show "Undo" on the last completed bucket (the one just before the first incomplete)
                        const isLastCompleted = bucketData.completed && (firstIncompleteIndex === bucketIndex + 1 || (firstIncompleteIndex === -1 && bucketIndex === selectedArr.length - 1));

                        return (
                        <div
                          key={bucket}
                          className={`bg-gradient-to-r rounded-lg border p-4 ${bucketData.completed ? "from-green-500/15 to-green-600/10 border-green-500/30" : bucketData.inProgress ? "from-orange-500/15 to-orange-600/10 border-orange-500/30" : "from-blue-500/15 to-blue-600/10 border-blue-500/30"}`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-white font-medium text-sm uppercase tracking-wide flex items-center gap-2">
                              {bucket}
                              {bucketData.completed && <span className="text-green-400 text-xs font-normal">✓ Completed</span>}
                              {bucketData.inProgress && <span className="text-orange-400 text-xs font-normal">● Active</span>}
                            </h4>
                            <div className="flex items-center gap-2">
                              {isLastCompleted && (
                                <button
                                  onClick={() => {
                                    setDirty(true);
                                    setTasks((prev) =>
                                      prev.map((t) => {
                                        if (t.id !== task.id) return t;
                                        // Revert this bucket to active, and deactivate the next bucket if it was set active
                                        const updatedBuckets = { ...t.buckets };
                                        updatedBuckets[bucket] = { ...updatedBuckets[bucket], completed: false, inProgress: true };
                                        // Deactivate the next bucket if it exists
                                        if (bucketIndex + 1 < selectedArr.length) {
                                          const nextBucket = selectedArr[bucketIndex + 1];
                                          updatedBuckets[nextBucket] = { ...updatedBuckets[nextBucket], inProgress: false };
                                        }
                                        return { ...t, buckets: updatedBuckets };
                                      })
                                    );
                                  }}
                                  className="px-3 py-1.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 rounded-lg text-xs font-medium hover:bg-yellow-500/30 transition-all"
                                >
                                  ↩ Undo
                                </button>
                              )}
                              {showSetActive && (
                                <button
                                  onClick={() => {
                                    setDirty(true);
                                    setTasks((prev) =>
                                      prev.map((t) => {
                                        if (t.id !== task.id) return t;
                                        return {
                                          ...t,
                                          buckets: {
                                            ...t.buckets,
                                            [bucket]: { ...t.buckets[bucket], inProgress: true },
                                          },
                                        };
                                      })
                                    );
                                  }}
                                  className="px-3 py-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/40 rounded-lg text-xs font-medium hover:bg-orange-500/30 transition-all"
                                >
                                  Set Active
                                </button>
                              )}
                              {showMarkComplete && (
                                <button
                                  onClick={() => {
                                    setDirty(true);
                                    setTasks((prev) =>
                                      prev.map((t) => {
                                        if (t.id !== task.id) return t;
                                        return {
                                          ...t,
                                          buckets: {
                                            ...t.buckets,
                                            [bucket]: { ...t.buckets[bucket], completed: true, inProgress: false },
                                          },
                                        };
                                      })
                                    );
                                  }}
                                  className="px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/40 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-all"
                                >
                                  ✓ Mark Complete
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                            {/* Start Date */}
                            <div>
                              <label className="block text-xs text-white/50 mb-1">Start Date</label>
                              <input
                                type="date"
                                value={task.buckets[bucket].startDate}
                                onChange={(e) => updateBucket(task.id, bucket, "startDate", e.target.value)}
                                className="w-full border border-white/20 rounded-lg px-3 py-2 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
                              />
                            </div>

                            {/* End Date */}
                            <div>
                              <label className="block text-xs text-white/50 mb-1">End Date</label>
                              <input
                                type="date"
                                value={task.buckets[bucket].endDate}
                                onChange={(e) => updateBucket(task.id, bucket, "endDate", e.target.value)}
                                className="w-full border border-white/20 rounded-lg px-3 py-2 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
                              />
                            </div>

                            {/* Priority */}
                            <div>
                              <label className="block text-xs text-white/50 mb-1">Priority</label>
                              <select
                                value={task.buckets[bucket].priority}
                                onChange={(e) => updateBucket(task.id, bucket, "priority", e.target.value)}
                                className="w-full border border-white/20 rounded-lg px-3 py-2 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
                              >
                                <option value="low" className="bg-[#1a1c2e]">Low</option>
                                <option value="medium" className="bg-[#1a1c2e]">Medium</option>
                                <option value="high" className="bg-[#1a1c2e]">High</option>
                              </select>
                            </div>

                            {/* Expected Hours */}
                            <div>
                              <label className="block text-xs text-white/50 mb-1">Expected Hours</label>
                              <input
                                type="number"
                                min="0"
                                value={task.buckets[bucket].expectedHours || ""}
                                onChange={(e) => updateBucket(task.id, bucket, "expectedHours", Number(e.target.value))}
                                placeholder="0"
                                className="w-full border border-white/20 rounded-lg px-3 py-2 text-xs bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
                              />
                            </div>
                          </div>

                          {/* Assigned To - Dropdown Multi Select */}
                          <div className="mt-3 relative">
                            <label className="block text-xs text-white/50 mb-1">Assign To</label>
                            {/* Selected chips */}
                            <div className="flex flex-wrap gap-1 mb-1">
                              {task.buckets[bucket].assignedTo.map((email) => {
                                const emp = employees.find((e) => e.email === email);
                                return (
                                  <span key={email} className="px-2 py-0.5 rounded-full text-xs bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50 flex items-center gap-1">
                                    {emp?.name || email}
                                    <button onClick={() => toggleAssignee(task.id, bucket, email)} className="text-[#4fc3f7] hover:text-red-400 text-xs leading-none">&times;</button>
                                  </span>
                                );
                              })}
                            </div>
                            {/* Dropdown select */}
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) toggleAssignee(task.id, bucket, e.target.value);
                              }}
                              className="w-full border border-white/20 rounded-lg px-3 py-2 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] appearance-none cursor-pointer"
                            >
                              <option value="" className="bg-[#1a1a2e] text-white/50">Select employee...</option>
                              {employees
                                .filter((emp) => !task.buckets[bucket].assignedTo.includes(emp.email))
                                .map((emp) => (
                                  <option key={emp.email} value={emp.email} className="bg-[#1a1a2e] text-white">
                                    {emp.name}
                                  </option>
                                ))}
                            </select>
                          </div>

                          {/* Acceptance Criteria */}
                          <div className="mt-3">
                            <label className="block text-xs text-white/50 mb-1">Acceptance Criteria</label>
                            <div className="space-y-2">
                              {task.buckets[bucket].acceptanceCriteria.map((criteria, ci) => (
                                <div key={ci} className="flex gap-2 items-center">
                                  <span className="text-white/30 text-xs w-5">{ci + 1}.</span>
                                  <input
                                    type="text"
                                    value={criteria}
                                    onChange={(e) => updateCriteria(task.id, bucket, ci, e.target.value)}
                                    placeholder="Enter acceptance criteria..."
                                    className="flex-1 border border-white/20 rounded-lg px-3 py-1.5 text-xs bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
                                  />
                                  <button
                                    onClick={() => removeCriteria(task.id, bucket, ci)}
                                    className="text-red-400/60 hover:text-red-400 text-xs px-2 py-1"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              <button
                                onClick={() => addCriteria(task.id, bucket)}
                                className="text-[#4fc3f7]/70 hover:text-[#4fc3f7] text-xs font-medium mt-1"
                              >
                                + Add Criteria
                              </button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Save Button */}
        {(tasks.length > 0 || dirty) && (
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleNavigateBack}
              className="px-5 py-2.5 bg-white/5 border border-white/20 text-white/60 rounded-lg hover:bg-white/10 text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  // Save project name/description
                  await fetch(`/api/projects/${projectId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: userEmail, name: editName, description: editDescription }),
                  });

                  // Save tasks
                  const res = await fetch(`/api/project-tasks/${projectId}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tasks }),
                  });
                  if (res.ok) {
                    const result = await res.json();
                    // Update task IDs with real DB IDs
                    if (result.savedTaskIds) {
                      setTasks((prev) =>
                        prev.map((t) => {
                          const mapping = result.savedTaskIds.find((m: any) => m.clientId === t.id);
                          if (mapping) {
                            return { ...t, id: mapping.dbId.toString() };
                          }
                          return t;
                        })
                      );
                    }
                    setDirty(false);
                    alert("Saved successfully!");
                  } else {
                    const err = await res.json();
                    alert("Error: " + err.error);
                  }
                } catch (err) {
                  console.error("Failed to save:", err);
                  alert("Failed to save");
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="px-6 py-2.5 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium transition-all shadow-md disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Tasks"}
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
