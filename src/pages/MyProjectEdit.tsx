import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const API_BASE = "/api";

const BUCKETS = [
  "Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live",
] as const;

interface BucketData {
  startDate: string;
  endDate: string;
  assignedTo: string[];
  priority: string;
  expectedHours: number;
  consumptionHr: number;
  acceptanceCriteria: string[];
  completed: boolean;
  inProgress: boolean;
}

interface ExistingTaskItem {
  id: string;
  name: string;
  description: string;
  selectedStages: string[];
  buckets: Record<string, BucketData>;
  expanded: boolean;
}

interface TaskDraft {
  id: string;
  name: string;
  description: string;
  selectedStages: string[];
  stages: Record<string, BucketData>;
  expanded: boolean;
}

interface PendingRequest {
  id: number;
  name: string;
  status: string;
}

function emptyBucket(email: string): BucketData {
  return { startDate: "", endDate: "", assignedTo: [email], priority: "medium", expectedHours: 0, consumptionHr: 0, acceptanceCriteria: [""], completed: false, inProgress: false };
}

export default function MyProjectEdit({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = parseInt(searchParams.get("id") || "0");
  const projectName = searchParams.get("name") || "";
  const isNewProject = !projectId;

  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [existingTasks, setExistingTasks] = useState<ExistingTaskItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(!isNewProject);
  const [saving, setSaving] = useState(false);
  const [savingExisting, setSavingExisting] = useState(false);
  const [dirty, setDirty] = useState(false);

  // New project fields
  const [projName, setProjName] = useState("");
  const [projDescription, setProjDescription] = useState("");

  // New task drafts (for request submission)
  const [newTasks, setNewTasks] = useState<TaskDraft[]>([]);
  const [newTaskName, setNewTaskName] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/employees`).then((r) => r.json()).then(setEmployees).catch(console.error);
    if (!isNewProject) fetchExistingData();
  }, []);

  async function fetchExistingData() {
    setLoading(true);
    try {
      const [tasksRes, reqRes] = await Promise.all([
        fetch(`${API_BASE}/project-tasks/${projectId}`),
        fetch(`${API_BASE}/requests?email=${encodeURIComponent(userEmail)}`),
      ]);
      const tasksData = await tasksRes.json();
      const reqData = await reqRes.json();

      if (Array.isArray(tasksData)) {
        setExistingTasks(tasksData.map((t: any) => ({ ...t, expanded: false })));
      }
      if (Array.isArray(reqData)) {
        setPendingRequests(
          reqData
            .filter((r: any) => r.type === "task" && r.project_id === projectId && r.status === "pending")
            .map((r: any) => ({ id: r.id, name: r.name, status: r.status }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }

  // Load bucket details when expanding an existing task
  async function loadTaskDetails(taskId: string) {
    try {
      const res = await fetch(`${API_BASE}/project-tasks/${projectId}/${taskId}/details`);
      const buckets = await res.json();
      setExistingTasks((prev) =>
        prev.map((t) => t.id === taskId ? { ...t, buckets, selectedStages: Object.keys(buckets).filter((b) => BUCKETS.includes(b as any)) } : t)
      );
    } catch (err) {
      console.error("Failed to load task details:", err);
    }
  }

  function toggleExistingTask(taskId: string) {
    const task = existingTasks.find((t) => t.id === taskId);
    if (task && !task.expanded && Object.keys(task.buckets || {}).length === 0) {
      loadTaskDetails(taskId);
    }
    setExistingTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, expanded: !t.expanded } : t));
  }

  function updateExistingBucket(taskId: string, bucket: string, field: keyof BucketData, value: any) {
    setDirty(true);
    setExistingTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, buckets: { ...t.buckets, [bucket]: { ...t.buckets[bucket], [field]: value } } };
    }));
  }

  function toggleExistingStage(taskId: string, stage: string) {
    setDirty(true);
    setExistingTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      if (t.selectedStages.includes(stage)) {
        const { [stage]: _, ...rest } = t.buckets;
        return { ...t, selectedStages: t.selectedStages.filter((s) => s !== stage), buckets: rest };
      }
      return { ...t, selectedStages: [...t.selectedStages, stage], buckets: { ...t.buckets, [stage]: emptyBucket(userEmail) } };
    }));
  }

  function toggleExistingAssignee(taskId: string, bucket: string, email: string) {
    setDirty(true);
    setExistingTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      const current = t.buckets[bucket]?.assignedTo || [];
      const updated = current.includes(email) ? current.filter((e) => e !== email) : [...current, email];
      return { ...t, buckets: { ...t.buckets, [bucket]: { ...t.buckets[bucket], assignedTo: updated } } };
    }));
  }

  // Save existing tasks via POST /api/project-tasks/:projectId
  async function saveExistingTasks() {
    setSavingExisting(true);
    try {
      const res = await fetch(`${API_BASE}/project-tasks/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: existingTasks }),
      });
      if (res.ok) {
        setDirty(false);
        await fetchExistingData();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      alert("Failed to save");
    } finally {
      setSavingExisting(false);
    }
  }

  // New task draft functions
  function addNewTask() {
    if (!newTaskName.trim()) return;
    // Collapse existing tasks so the input stays visible
    setNewTasks([...newTasks.map((t) => ({ ...t, expanded: false })), {
      id: Date.now().toString(), name: newTaskName.trim(), description: "",
      selectedStages: [], stages: {}, expanded: true,
    }]);
    setNewTaskName("");
  }

  function removeNewTask(id: string) { setNewTasks(newTasks.filter((t) => t.id !== id)); }
  function toggleNewTask(id: string) { setNewTasks(newTasks.map((t) => t.id === id ? { ...t, expanded: !t.expanded } : t)); }

  function toggleNewStage(taskId: string, stage: string) {
    setNewTasks(newTasks.map((t) => {
      if (t.id !== taskId) return t;
      if (t.selectedStages.includes(stage)) {
        const { [stage]: _, ...rest } = t.stages;
        return { ...t, selectedStages: t.selectedStages.filter((s) => s !== stage), stages: rest };
      }
      return { ...t, selectedStages: [...t.selectedStages, stage], stages: { ...t.stages, [stage]: emptyBucket(userEmail) } };
    }));
  }

  function updateNewStage(taskId: string, stage: string, field: keyof BucketData, value: any) {
    setNewTasks(newTasks.map((t) => t.id !== taskId ? t : { ...t, stages: { ...t.stages, [stage]: { ...t.stages[stage], [field]: value } } }));
  }

  function toggleNewAssignee(taskId: string, stage: string, email: string) {
    setNewTasks(newTasks.map((t) => {
      if (t.id !== taskId) return t;
      const current = t.stages[stage]?.assignedTo || [];
      const updated = current.includes(email) ? current.filter((e) => e !== email) : [...current, email];
      return { ...t, stages: { ...t.stages, [stage]: { ...t.stages[stage], assignedTo: updated } } };
    }));
  }

  async function submitNewTasks() {
    if (isNewProject) {
      if (!projName.trim()) { alert("Project name is required"); return; }
      if (newTasks.length === 0) { alert("Add at least one task"); return; }
      const payload = {
        tasks: newTasks.map((t) => ({
          name: t.name, description: t.description,
          stages: Object.fromEntries(t.selectedStages.map((s) => [s, t.stages[s]])),
        })),
      };
      setSaving(true);
      try {
        const res = await fetch(`${API_BASE}/requests`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, type: "project", name: projName, description: projDescription, stages: payload }),
        });
        if (res.ok) navigate("/my-projects");
        else { const err = await res.json(); alert("Error: " + err.error); }
      } catch { alert("Failed to submit"); }
      finally { setSaving(false); }
    } else {
      if (newTasks.length === 0) { alert("Add at least one task"); return; }
      setSaving(true);
      try {
        for (const t of newTasks) {
          const stagesPayload = Object.fromEntries(t.selectedStages.map((s) => [s, t.stages[s]]));
          await fetch(`${API_BASE}/requests`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, type: "task", name: t.name, description: t.description, project_id: projectId, stages: stagesPayload }),
          });
        }
        setNewTasks([]);
        await fetchExistingData();
      } catch { alert("Failed to submit"); }
      finally { setSaving(false); }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center">
        <p className="text-white/60">Loading...</p>
      </div>
    );
  }

  // Shared stage editor component
  function renderStageEditor(
    task: { id: string; selectedStages: string[]; stages?: Record<string, BucketData>; buckets?: Record<string, BucketData> },
    onToggleStage: (taskId: string, stage: string) => void,
    onUpdateField: (taskId: string, stage: string, field: keyof BucketData, value: any) => void,
    onToggleAssignee: (taskId: string, stage: string, email: string) => void,
  ) {
    const data = task.buckets || task.stages || {};
    return (
      <>
        <div className="mb-3">
          <label className="block text-xs text-white/50 mb-2">Stages</label>
          <div className="flex flex-wrap gap-2">
            {BUCKETS.map((stage) => (
              <button key={stage} onClick={() => onToggleStage(task.id, stage)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  task.selectedStages.includes(stage)
                    ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                    : "bg-white/5 text-white/30 border-white/15 hover:bg-white/10"
                }`}>{stage}</button>
            ))}
          </div>
        </div>
        {task.selectedStages.filter((s) => BUCKETS.includes(s as any)).map((stage) => {
          const sd = data[stage] || emptyBucket(userEmail);
          return (
            <div key={stage} className="bg-white/5 rounded-lg border border-white/10 p-4 mb-3">
              <span className="text-white/70 text-xs font-semibold uppercase block mb-3">{stage}</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-white/40 mb-1">Start Date</label>
                  <input type="date" value={sd.startDate || ""}
                    onChange={(e) => onUpdateField(task.id, stage, "startDate", e.target.value)}
                    className="w-full border border-white/20 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">End Date</label>
                  <input type="date" value={sd.endDate || ""}
                    onChange={(e) => onUpdateField(task.id, stage, "endDate", e.target.value)}
                    className="w-full border border-white/20 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Priority</label>
                  <select value={sd.priority || "medium"}
                    onChange={(e) => onUpdateField(task.id, stage, "priority", e.target.value)}
                    className="w-full border border-white/20 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] cursor-pointer">
                    <option value="low" className="bg-[#1a1c2e]">Low</option>
                    <option value="medium" className="bg-[#1a1c2e]">Medium</option>
                    <option value="high" className="bg-[#1a1c2e]">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1">Expected Hours</label>
                  <input type="number" min={0} value={sd.expectedHours || 0}
                    onChange={(e) => onUpdateField(task.id, stage, "expectedHours", parseFloat(e.target.value) || 0)}
                    className="w-full border border-white/20 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-white/40 mb-1">Assign To</label>
                <div className="flex flex-wrap gap-1">
                  {employees.map((emp) => (
                    <button key={emp.email} onClick={() => onToggleAssignee(task.id, stage, emp.email)}
                      className={`px-2 py-0.5 rounded-full text-xs border transition-all ${
                        (sd.assignedTo || []).includes(emp.email)
                          ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                          : "bg-white/5 text-white/30 border-white/15 hover:bg-white/10"
                      }`}>{emp.name}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Acceptance Criteria</label>
                {(sd.acceptanceCriteria || [""]).map((c: string, ci: number) => (
                  <div key={ci} className="flex gap-2 mb-1">
                    <span className="text-white/30 text-xs pt-2">{ci + 1}.</span>
                    <input type="text" value={c} placeholder="Enter acceptance criteria..."
                      onChange={(e) => {
                        const updated = [...(sd.acceptanceCriteria || [""])];
                        updated[ci] = e.target.value;
                        onUpdateField(task.id, stage, "acceptanceCriteria", updated);
                      }}
                      className="flex-1 border border-white/20 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                    {(sd.acceptanceCriteria || [""]).length > 1 && (
                      <button onClick={() => {
                        const updated = (sd.acceptanceCriteria || [""]).filter((_: any, i: number) => i !== ci);
                        onUpdateField(task.id, stage, "acceptanceCriteria", updated);
                      }} className="text-red-400 hover:text-red-300 text-xs">×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => {
                  const updated = [...(sd.acceptanceCriteria || [""]), ""];
                  onUpdateField(task.id, stage, "acceptanceCriteria", updated);
                }} className="text-[#4fc3f7] text-xs mt-1 hover:text-white transition-colors">+ Add Criteria</button>
              </div>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/my-projects")} className="text-[#4fc3f7] hover:text-white transition-colors">← Back</button>
          <h1 className="text-xl font-semibold text-white">{isNewProject ? "New Project" : projectName}</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* Project Details (new project) */}
        {isNewProject && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg">
            <h2 className="text-white font-semibold mb-3">Project Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-white/50 mb-1">Project Name *</label>
                <input type="text" value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="Enter project name"
                  className="w-full border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Description</label>
                <input type="text" value={projDescription} onChange={(e) => setProjDescription(e.target.value)} placeholder="Enter description"
                  className="w-full border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]" />
              </div>
            </div>
          </div>
        )}

        {/* Existing Tasks (editable, for existing project) */}
        {!isNewProject && existingTasks.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">Existing Tasks</h2>
              {dirty && (
                <button onClick={saveExistingTasks} disabled={savingExisting}
                  className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-700 text-white rounded-lg text-sm font-medium shadow-md disabled:opacity-50">
                  {savingExisting ? "Saving..." : "Save Changes"}
                </button>
              )}
            </div>
            <div className="space-y-3">
              {existingTasks.map((task) => (
                <div key={task.id} className="bg-white/5 rounded-xl border border-white/15 overflow-hidden">
                  <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5" onClick={() => toggleExistingTask(task.id)}>
                    <div className="flex items-center gap-3">
                      <span className="text-white/40 text-xs">{task.expanded ? "▼" : "▶"}</span>
                      <span className="text-white font-medium">{task.name}</span>
                      <span className="text-white/30 text-xs">{task.selectedStages.length} stages</span>
                    </div>
                  </div>
                  {task.expanded && (
                    <div className="border-t border-white/10 p-4">
                      <div className="mb-3">
                        <label className="block text-xs text-white/50 mb-1">Task Description</label>
                        <textarea value={task.description || ""}
                          onChange={(e) => { setDirty(true); setExistingTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, description: e.target.value } : t)); }}
                          placeholder="Task description..." rows={2}
                          className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] resize-none" />
                      </div>
                      {renderStageEditor(task, toggleExistingStage, updateExistingBucket, toggleExistingAssignee)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Requests (existing project) */}
        {!isNewProject && pendingRequests.length > 0 && (
          <div className="mb-6">
            <h2 className="text-white font-semibold mb-3">Pending Requests</h2>
            <div className="space-y-2">
              {pendingRequests.map((r) => (
                <div key={r.id} className="bg-white/5 rounded-xl border border-white/15 p-4 flex items-center justify-between">
                  <span className="text-white font-medium">{r.name}</span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium border bg-yellow-500/20 text-yellow-400 border-yellow-500/40">Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add New Tasks (as requests) */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg">
          <h2 className="text-white font-semibold mb-3">{isNewProject ? "Tasks" : "Add New Tasks"}</h2>
          <div className="flex gap-3 mb-4">
            <input type="text" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNewTask()} placeholder="Enter task name..."
              className="flex-1 border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]" />
            <button onClick={addNewTask} className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg text-sm font-medium shadow-md">+ Add</button>
          </div>

          {newTasks.length === 0 && <p className="text-white/30 text-sm text-center py-4">No new tasks added</p>}

          <div className="space-y-4">
            {newTasks.map((task) => (
              <div key={task.id} className="bg-white/5 rounded-xl border border-white/15 overflow-hidden">
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5" onClick={() => toggleNewTask(task.id)}>
                  <div className="flex items-center gap-3">
                    <span className="text-white/40 text-xs">{task.expanded ? "▼" : "▶"}</span>
                    <span className="text-white font-medium">{task.name}</span>
                    <span className="text-white/30 text-xs">{task.selectedStages.length} stages</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeNewTask(task.id); }}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-500/30 bg-red-500/10">Remove</button>
                </div>
                {task.expanded && (
                  <div className="border-t border-white/10 p-4">
                    <div className="mb-3">
                      <label className="block text-xs text-white/50 mb-1">Description</label>
                      <input type="text" value={task.description}
                        onChange={(e) => setNewTasks(newTasks.map((t) => t.id === task.id ? { ...t, description: e.target.value } : t))}
                        placeholder="Task description..."
                        className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]" />
                    </div>
                    {renderStageEditor(
                      { ...task, buckets: task.stages },
                      toggleNewStage,
                      updateNewStage,
                      toggleNewAssignee,
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Submit new tasks */}
        {newTasks.length > 0 && (
          <div className="flex justify-end">
            <button onClick={submitNewTasks} disabled={saving}
              className="px-6 py-3 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium shadow-lg disabled:opacity-50">
              {saving ? "Submitting..." : isNewProject ? "Submit Project for Approval" : "Submit Tasks for Approval"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
