import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

interface Request {
  id: number;
  type: string;
  name: string;
  description: string;
  project_id: number | null;
  requested_by: string;
  requested_by_name: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  project_name?: string;
  stages: any;
}

interface Project {
  id: number;
  name: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  approved: "bg-green-500/20 text-green-400 border-green-500/40",
  rejected: "bg-red-500/20 text-red-400 border-red-500/40",
};

export default function Approvals({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<Request[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editedStages, setEditedStages] = useState<any>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [employeeFilter, setEmployeeFilter] = useState<string>("");

  // Reject note
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [reqRes, projRes, empRes] = await Promise.all([
        fetch(`${API_BASE}/requests?email=${encodeURIComponent(userEmail)}`),
        fetch(`${API_BASE}/projects`),
        fetch(`${API_BASE}/employees`),
      ]);
      const reqData = await reqRes.json();
      const projData = await projRes.json();
      const empData = await empRes.json();
      if (Array.isArray(empData)) setEmployees(empData);

      const projLookup = new Map<number, string>();
      if (Array.isArray(projData)) {
        for (const p of projData) projLookup.set(p.id, p.name);
        setProjects(projData.map((p: any) => ({ id: p.id, name: p.name })));
      }

      if (Array.isArray(reqData)) {
        setRequests(
          reqData.map((r: any) => ({
            ...r,
            project_name: r.project_id
              ? projLookup.get(r.project_id) || `Project #${r.project_id}`
              : null,
            stages: r.stages ? JSON.parse(r.stages) : null,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }

  // Filtered requests
  const filtered = requests.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (projectFilter) {
      const matchName = r.type === "project" ? r.name : r.project_name;
      if (!matchName || matchName !== projectFilter) return false;
    }
    if (employeeFilter && r.requested_by_name !== employeeFilter) return false;
    return true;
  });

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const pendingFiltered = filtered.filter((r) => r.status === "pending");
    if (pendingFiltered.every((r) => selectedIds.has(r.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingFiltered.map((r) => r.id)));
    }
  }

  function expandRequest(r: Request) {
    if (expandedId === r.id) {
      setExpandedId(null);
      setEditedStages(null);
    } else {
      setExpandedId(r.id);
      if (r.stages) {
        const parsed = JSON.parse(JSON.stringify(r.stages));
        if (!parsed.tasks) {
          setEditedStages({
            _taskRequest: true,
            taskName: r.name,
            taskDescription: r.description || "",
            stages: parsed,
          });
        } else {
          setEditedStages(parsed);
        }
      } else {
        setEditedStages(null);
      }
    }
  }

  async function saveEditedRequest(r: Request) {
    setSavingEdit(true);
    let stagesToSave = editedStages;
    let nameToSave = r.name;
    let descToSave = r.description;
    if (editedStages?._taskRequest) {
      stagesToSave = editedStages.stages;
      nameToSave = editedStages.taskName;
      descToSave = editedStages.taskDescription;
    }
    try {
      const res = await fetch(`${API_BASE}/requests/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          name: nameToSave,
          description: descToSave,
          stages: stagesToSave,
        }),
      });
      if (res.ok) {
        await fetchData();
        setExpandedId(null);
        setEditedStages(null);
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch {
      alert("Failed to save");
    } finally {
      setSavingEdit(false);
    }
  }

  function updateEditedStage(taskIndex: number, stageName: string, field: string, value: any) {
    if (!editedStages) return;
    const updated = JSON.parse(JSON.stringify(editedStages));
    if (updated.tasks) {
      if (!updated.tasks[taskIndex].stages[stageName]) return;
      updated.tasks[taskIndex].stages[stageName][field] = value;
    } else if (updated._taskRequest) {
      if (!updated.stages[stageName]) return;
      updated.stages[stageName][field] = value;
    }
    setEditedStages(updated);
  }

  function toggleEditedAssignee(taskIndex: number, stageName: string, email: string) {
    if (!editedStages) return;
    const updated = JSON.parse(JSON.stringify(editedStages));
    const sd = updated.tasks
      ? updated.tasks[taskIndex].stages[stageName]
      : updated._taskRequest
      ? updated.stages[stageName]
      : null;
    if (!sd) return;
    const current: string[] = sd.assignedTo || [];
    sd.assignedTo = current.includes(email)
      ? current.filter((e: string) => e !== email)
      : [...current, email];
    setEditedStages(updated);
  }

  function updateEditedTaskField(taskIndex: number, field: "name" | "description", value: string) {
    if (!editedStages?.tasks) return;
    const updated = JSON.parse(JSON.stringify(editedStages));
    updated.tasks[taskIndex][field] = value;
    setEditedStages(updated);
  }

  const BUCKETS = ["Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live"];
  const emptyStage = () => ({
    expectedHours: 0,
    assignedTo: [],
    startDate: "",
    endDate: "",
    priority: "medium",
    acceptanceCriteria: [""],
  });

  function toggleEditedStageSelection(taskIndex: number, stageName: string) {
    if (!editedStages) return;
    const updated = JSON.parse(JSON.stringify(editedStages));
    const stages = updated.tasks
      ? updated.tasks[taskIndex].stages
      : updated._taskRequest
      ? updated.stages
      : null;
    if (!stages) return;
    if (stages[stageName]) {
      delete stages[stageName];
    } else {
      stages[stageName] = emptyStage();
    }
    setEditedStages(updated);
  }

  function addEditedTask() {
    if (!editedStages?.tasks) return;
    const updated = JSON.parse(JSON.stringify(editedStages));
    updated.tasks.push({ name: "New Task", description: "", stages: {} });
    setEditedStages(updated);
  }

  function removeEditedTask(taskIndex: number) {
    if (!editedStages?.tasks) return;
    const updated = JSON.parse(JSON.stringify(editedStages));
    updated.tasks.splice(taskIndex, 1);
    setEditedStages(updated);
  }

  async function handleBulkAction(action: "approved" | "rejected") {
    if (selectedIds.size === 0) {
      alert("Select at least one request");
      return;
    }

    if (action === "rejected" && !showRejectNote) {
      setShowRejectNote(true);
      return;
    }

    setProcessing(true);
    try {
      const res = await fetch(`${API_BASE}/requests/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          ids: Array.from(selectedIds),
          action,
          admin_notes: action === "rejected" ? rejectNote : null,
        }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setShowRejectNote(false);
        setRejectNote("");
        await fetchData();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to process:", err);
      alert("Failed to process requests");
    } finally {
      setProcessing(false);
    }
  }

  const employeeNames = [
    ...new Set(requests.map((r) => r.requested_by_name).filter(Boolean)),
  ].sort();
  const projectNames = [
    ...new Set(
      requests.map((r) => (r.type === "project" ? r.name : r.project_name)).filter(Boolean) as string[]
    ),
  ].sort();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center">
        <p className="text-white/60">Loading...</p>
      </div>
    );
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          <button onClick={() => navigate("/projects")} className="text-[#4fc3f7] hover:text-white transition-colors">
            ← Back to Projects
          </button>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Approvals</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30">
            Admin
          </span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-medium border border-yellow-500/40">
              {pendingCount} pending
            </span>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4 sm:mb-6">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] cursor-pointer"
          >
            <option value="" className="bg-[#1a1c2e]">
              All Status
            </option>
            <option value="pending" className="bg-[#1a1c2e]">
              Pending
            </option>
            <option value="approved" className="bg-[#1a1c2e]">
              Approved
            </option>
            <option value="rejected" className="bg-[#1a1c2e]">
              Rejected
            </option>
          </select>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] cursor-pointer"
          >
            <option value="" className="bg-[#1a1c2e]">
              All Employees
            </option>
            {employeeNames.map((n) => (
              <option key={n} value={n} className="bg-[#1a1c2e]">
                {n}
              </option>
            ))}
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7] cursor-pointer"
          >
            <option value="" className="bg-[#1a1c2e]">
              All Projects
            </option>
            {projectNames.map((n) => (
              <option key={n} value={n} className="bg-[#1a1c2e]">
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-4 mb-4 sm:mb-6 flex flex-wrap items-center gap-3 sm:gap-4 shadow-lg">
            <span className="text-white text-sm font-medium">{selectedIds.size} selected</span>
            <button
              onClick={() => handleBulkAction("approved")}
              disabled={processing}
              className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-700 text-white rounded-lg hover:from-green-400 hover:to-green-600 text-sm font-medium transition-all shadow-md disabled:opacity-50"
            >
              {processing ? "Processing..." : "Approve Selected"}
            </button>
            <button
              onClick={() => handleBulkAction("rejected")}
              disabled={processing}
              className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-700 text-white rounded-lg hover:from-red-400 hover:to-red-600 text-sm font-medium transition-all shadow-md disabled:opacity-50"
            >
              {processing ? "Processing..." : "Reject Selected"}
            </button>
            <button
              onClick={() => {
                setSelectedIds(new Set());
                setShowRejectNote(false);
              }}
              className="px-3 py-2 bg-white/5 border border-white/20 text-white/60 rounded-lg hover:bg-white/10 text-sm transition-all"
            >
              Clear
            </button>
          </div>
        )}

        {/* Reject Note Input */}
        {showRejectNote && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4 sm:mb-6">
            <label className="block text-xs font-semibold text-red-400 mb-2 uppercase tracking-wide">
              Rejection Reason
            </label>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Enter reason for rejection (visible to employee)"
              rows={2}
              className="w-full border border-red-500/30 rounded-lg px-3 py-2 text-sm bg-white/5 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-red-400 resize-none mb-3"
            />
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleBulkAction("rejected")}
                disabled={processing}
                className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {processing ? "Processing..." : "Confirm Reject"}
              </button>
              <button
                onClick={() => {
                  setShowRejectNote(false);
                  setRejectNote("");
                }}
                className="px-3 py-2 bg-white/5 border border-white/20 text-white/60 rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Requests Table */}
        {filtered.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">No requests match the current filters.</p>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left w-[40px]">
                      {statusFilter === "pending" && (
                        <input
                          type="checkbox"
                          checked={
                            filtered
                              .filter((r) => r.status === "pending")
                              .every((r) => selectedIds.has(r.id)) &&
                            filtered.some((r) => r.status === "pending")
                          }
                          onChange={toggleSelectAll}
                          className="rounded border-white/30 bg-white/10 cursor-pointer"
                        />
                      )}
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">
                      Type
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">
                      Name
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">
                      Project
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">
                      Requested By
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wide font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <React.Fragment key={r.id}>
                      <tr
                        className={`border-b border-white/5 hover:bg-white/5 transition-all cursor-pointer ${
                          expandedId === r.id ? "bg-white/5" : ""
                        }`}
                        onClick={() => r.stages && expandRequest(r)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {r.status === "pending" && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
                              className="rounded border-white/30 bg-white/10 cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium border ${
                              r.type === "project"
                                ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                                : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                            }`}
                          >
                            {r.type === "project" ? "Project" : "Task"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="text-white text-sm font-medium">{r.name}</span>
                            {r.description && (
                              <p className="text-white/40 text-xs mt-0.5 line-clamp-1">
                                {r.description}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[#4fc3f7] text-xs">{r.project_name || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-white/70 text-sm">
                            {r.requested_by_name || r.requested_by.split("@")[0]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-white/40 text-xs">
                            {new Date(r.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium border ${
                              STATUS_BADGE[r.status] || STATUS_BADGE.pending
                            }`}
                          >
                            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
