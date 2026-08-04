import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

interface AssignedProject {
  projectId: number;
  projectName: string;
  taskCount: number;
}

interface Request {
  id: number;
  type: string;
  name: string;
  description: string;
  project_id: number | null;
  requested_by: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  project_name?: string;
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

export default function MyProjects({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"assigned" | "requests">("assigned");
  const [assignedProjects, setAssignedProjects] = useState<AssignedProject[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [boardRes, reqRes, projRes] = await Promise.all([
        fetch(`${API_BASE}/project-tasks/my-board?email=${encodeURIComponent(userEmail)}`),
        fetch(`${API_BASE}/requests?email=${encodeURIComponent(userEmail)}`),
        fetch(`${API_BASE}/projects`),
      ]);
      const boardData = await boardRes.json();
      const reqData = await reqRes.json();
      const projData = await projRes.json();

      // Derive assigned projects from board tasks
      const projMap = new Map<number, AssignedProject>();
      if (Array.isArray(boardData)) {
        for (const t of boardData) {
          if (!projMap.has(t.projectId)) {
            projMap.set(t.projectId, { projectId: t.projectId, projectName: t.projectName, taskCount: 0 });
          }
          projMap.get(t.projectId)!.taskCount++;
        }
      }
      setAssignedProjects(Array.from(projMap.values()));

      // Enrich task requests with project name
      const projLookup = new Map<number, string>();
      if (Array.isArray(projData)) {
        for (const p of projData) projLookup.set(p.id, p.name);
        setAllProjects(projData.map((p: any) => ({ id: p.id, name: p.name })));
      }
      if (Array.isArray(reqData)) {
        setRequests(reqData.map((r: any) => ({
          ...r,
          project_name: r.project_id ? projLookup.get(r.project_id) || `Project #${r.project_id}` : null,
        })));
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }

  function openForm() {
    setName("");
    setDescription("");
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setName("");
    setDescription("");
  }

  async function handleSubmit() {
    if (!name.trim()) { alert("Name is required"); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          type: "project",
          name,
          description,
        }),
      });
      if (res.ok) {
        cancelForm();
        await fetchData();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to submit request:", err);
      alert("Failed to submit request");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center">
        <p className="text-white/60">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-[#4fc3f7] hover:text-white transition-colors">← Back</button>
          <div className="flex bg-white/10 rounded-lg border border-white/20 p-0.5">
            <button
              onClick={() => navigate("/my-tasks")}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-all text-white/40 hover:text-white/70 hover:bg-white/10"
            >
              My Tasks
            </button>
            <button
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-all bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50"
            >
              Add Project
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab("assigned")}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
              tab === "assigned"
                ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                : "bg-white/5 text-white/40 border-white/15 hover:bg-white/10"
            }`}
          >
            Assigned Projects ({assignedProjects.length})
          </button>
          <button
            onClick={() => setTab("requests")}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
              tab === "requests"
                ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                : "bg-white/5 text-white/40 border-white/15 hover:bg-white/10"
            }`}
          >
            My Requests ({requests.length})
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 mb-6">
          <button
            onClick={() => navigate("/my-projects/edit")}
            className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium transition-all shadow-md"
          >
            + Add Project
          </button>
        </div>

        {/* Assigned Projects Tab */}
        {tab === "assigned" && (
          <>
            {assignedProjects.length === 0 ? (
              <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
                <p className="text-white/40 text-sm">No projects assigned to you yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {assignedProjects.map((p) => (
                  <div
                    key={p.projectId}
                    className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-5 shadow-xl transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-white font-semibold text-lg">{p.projectName}</h3>
                        <p className="text-white/40 text-sm mt-1">{p.taskCount} task{p.taskCount !== 1 ? "s" : ""} assigned to you</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => navigate(`/my-projects/edit?id=${p.projectId}&name=${encodeURIComponent(p.projectName)}`)}
                          className="px-3 py-1.5 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 text-xs font-medium transition-all"
                        >
                          Edit
                        </button>
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium border border-green-500/30">
                          Active
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* My Requests Tab */}
        {tab === "requests" && (
          <>
            {requests.length === 0 ? (
              <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
                <p className="text-white/40 text-sm">No requests yet. Use the buttons above to request a new project or task.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-5 shadow-xl"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                            r.type === "project"
                              ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                              : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                          }`}>
                            {r.type === "project" ? "Project" : "Task"}
                          </span>
                          <h3 className="text-white font-semibold">{r.name}</h3>
                        </div>
                        {r.description && (
                          <p className="text-white/60 text-sm mb-1">{r.description}</p>
                        )}
                        {r.project_name && (
                          <p className="text-white/30 text-xs">Under project: {r.project_name}</p>
                        )}
                        <p className="text-white/30 text-xs mt-1">
                          Submitted {new Date(r.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-lg text-xs font-medium border shrink-0 ${STATUS_BADGE[r.status] || STATUS_BADGE.pending}`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </div>
                    {r.status === "rejected" && r.admin_notes && (
                      <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <p className="text-red-400 text-xs font-medium">Admin note:</p>
                        <p className="text-red-300 text-sm">{r.admin_notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
