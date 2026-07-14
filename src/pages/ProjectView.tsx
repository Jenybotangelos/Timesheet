import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const BUCKETS = ["Pipeline", "Development", "Unit Testing", "Integration Testing", "UAT", "Go Live"];

interface BucketData {
  id: number;
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

interface Task {
  id: string;
  name: string;
  buckets: Record<string, BucketData>;
  expanded: boolean;
}

export default function ProjectView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectName = searchParams.get("name") || "Project";
  const projectId = searchParams.get("id") || "";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/employees")
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, string> = {};
        data.forEach((e: any) => { map[e.email] = e.name; });
        setEmployees(map);
      })
      .catch((err) => console.error("Failed to fetch employees:", err));
  }, []);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    fetch(`/api/project-tasks/${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const filled = data.map((t: any) => ({
            ...t,
            expanded: false,
            buckets: t.buckets,
          }));
          setTasks(filled);
        }
      })
      .catch((err) => console.error("Failed to fetch tasks:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  function toggleTask(taskId: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, expanded: !t.expanded } : t)));
  }

  function getStatusLabel(bucket: BucketData) {
    if (bucket.completed) return { text: "Completed", color: "text-green-400 bg-green-500/20 border-green-500/30" };
    if (bucket.inProgress) return { text: "In Progress", color: "text-orange-400 bg-orange-500/20 border-orange-500/30" };
    return { text: "Not Started", color: "text-white/40 bg-white/5 border-white/20" };
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
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/projects")} className="text-[#4fc3f7] hover:text-white transition-colors">
            ← Back
          </button>
          <h1 className="text-xl font-semibold text-white">{projectName}</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {tasks.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center">
            <p className="text-white/40 text-sm">No tasks added to this project yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <div key={task.id} className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 shadow-xl overflow-hidden">
                {/* Task Header */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-white/5 transition-all"
                  onClick={() => toggleTask(task.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-white/50 text-sm">{task.expanded ? "▼" : "▶"}</span>
                    <h3 className="text-white font-semibold text-lg">{task.name}</h3>
                  </div>
                  {/* Progress summary */}
                  <div className="flex items-center gap-2">
                    {(() => {
                      const taskStages = BUCKETS.filter((b) => task.buckets[b]);
                      const activeBucket = taskStages.find((b) => task.buckets[b]?.inProgress);
                      const allDone = taskStages.length > 0 && taskStages.every((b) => task.buckets[b]?.completed);
                      if (allDone) {
                        return <span className="text-green-400 text-xs font-medium px-2 py-1 bg-green-500/15 border border-green-500/30 rounded-full">✓ All Completed</span>;
                      }
                      if (activeBucket) {
                        return <span className="text-orange-400 text-xs font-medium px-2 py-1 bg-orange-500/15 border border-orange-500/30 rounded-full">● {activeBucket}</span>;
                      }
                      if (taskStages.length === 0) {
                        return <span className="text-white/40 text-xs font-medium px-2 py-1 bg-white/5 border border-white/15 rounded-full">No Stages</span>;
                      }
                      return <span className="text-white/40 text-xs font-medium px-2 py-1 bg-white/5 border border-white/15 rounded-full">Not Started</span>;
                    })()}
                    <div className="flex items-center gap-1">
                      {BUCKETS.filter((b) => task.buckets[b]).map((bucket) => {
                        const b = task.buckets[bucket];
                        const color = b?.completed ? "bg-green-500" : b?.inProgress ? "bg-orange-500" : "bg-white/20";
                        return <div key={bucket} className={`w-3 h-3 rounded-full ${color}`} title={`${bucket}: ${b?.completed ? "Done" : b?.inProgress ? "Active" : "Pending"}`} />;
                      })}
                    </div>
                  </div>
                </div>

                {/* Bucket Details */}
                {task.expanded && (
                  <div className="px-5 pb-5 space-y-3">
                    {BUCKETS.filter((b) => task.buckets[b]).map((bucket) => {
                      const data = task.buckets[bucket];
                      if (!data) return null;
                      const status = getStatusLabel(data);
                      return (
                        <div
                          key={bucket}
                          className={`rounded-lg border p-4 ${data.completed ? "bg-green-500/10 border-green-500/20" : data.inProgress ? "bg-orange-500/10 border-orange-500/20" : "bg-white/5 border-white/15"}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-white font-medium text-sm uppercase tracking-wide">{bucket}</h4>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${status.color}`}>
                              {status.text}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div>
                              <span className="text-white/40">Start:</span>
                              <span className="text-white/80 ml-1">{data.startDate || "—"}</span>
                            </div>
                            <div>
                              <span className="text-white/40">End:</span>
                              <span className="text-white/80 ml-1">{data.endDate || "—"}</span>
                            </div>
                            <div>
                              <span className="text-white/40">Priority:</span>
                              <span className={`ml-1 capitalize ${data.priority === "high" ? "text-red-400" : data.priority === "medium" ? "text-yellow-400" : "text-blue-400"}`}>
                                {data.priority}
                              </span>
                            </div>
                            <div>
                              <span className="text-white/40">Hours:</span>
                              <span className="text-white/80 ml-1">{data.expectedHours || "—"}</span>
                            </div>
                          </div>

                          {/* Assigned People */}
                          {data.assignedTo.length > 0 && (
                            <div className="mt-2">
                              <span className="text-white/40 text-xs">Assigned: </span>
                              <span className="text-[#4fc3f7] text-xs">
                                {data.assignedTo.map((email) => employees[email] || email.split("@")[0]).join(", ")}
                              </span>
                            </div>
                          )}

                          {/* Acceptance Criteria */}
                          {data.acceptanceCriteria.filter((c) => c.trim()).length > 0 && (
                            <div className="mt-2">
                              <span className="text-white/40 text-xs">Criteria:</span>
                              <ul className="mt-1 space-y-0.5">
                                {data.acceptanceCriteria.filter((c) => c.trim()).map((c, i) => (
                                  <li key={i} className="text-white/70 text-xs pl-3">• {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
