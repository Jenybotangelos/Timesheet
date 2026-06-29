import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

interface Project {
  id: number;
  name: string;
}

export default function ProjectReport({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState<number | null>(null);
  const [filterEmployee, setFilterEmployee] = useState<string>("");
  const [empDropdownOpen, setEmpDropdownOpen] = useState(false);
  const [projDropdownOpen, setProjDropdownOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/projects`).then((r) => r.json()),
      fetch(`${API_BASE}/tasks/project-report?email=${userEmail}`).then((r) => r.json()),
      fetch(`${API_BASE}/employees`).then((r) => r.json()),
    ])
      .then(([projectsData, reportRows, emps]) => {
        setProjects(projectsData.filter((p: any) => p.is_active));
        setReportData(reportRows);
        setEmployees(emps);
      })
      .catch((err) => console.error("Failed to fetch report:", err))
      .finally(() => setLoading(false));
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!empDropdownOpen && !projDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown]")) {
        setEmpDropdownOpen(false);
        setProjDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [empDropdownOpen, projDropdownOpen]);

  let filtered = reportData;
  if (filterProject) {
    filtered = filtered.filter((r) => r.project_id === filterProject);
  }
  if (filterEmployee) {
    filtered = filtered.filter((r) => r.employee_email === filterEmployee);
  }

  // Group by project for totals
  const projectTotals = new Map<string, number>();
  filtered.forEach((r) => {
    const pName = r.project_name || "Unassigned";
    const fromIst = r.from_time_ist || "";
    const toIst = r.to_time_ist || "";
    if (fromIst && toIst) {
      const [fh, fm] = fromIst.split(":").map(Number);
      const [th, tm] = toIst.split(":").map(Number);
      let diff = (th * 60 + tm) - (fh * 60 + fm);
      if (diff < 0) diff += 1440;
      projectTotals.set(pName, (projectTotals.get(pName) || 0) + diff);
    }
  });

  const grandTotalMin = Array.from(projectTotals.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/projects")} className="text-[#4fc3f7] hover:text-white transition-colors">← Back</button>
          <h1 className="text-xl font-semibold text-white">Project Report</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30">Admin</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {/* Project totals summary */}
        {projectTotals.size > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 px-5 py-3 mb-4 shadow-lg flex flex-wrap gap-6">
            {Array.from(projectTotals.entries()).map(([pName, mins]) => (
              <div key={pName} className="flex items-center gap-2">
                <span className="text-white/80 text-sm font-medium">{pName}:</span>
                <span className="text-[#4fc3f7] text-sm font-bold">
                  {Math.floor(mins / 60)}h {mins % 60 > 0 ? `${mins % 60}m` : ""}
                </span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2 border-l border-white/20 pl-6">
              <span className="text-white font-semibold text-sm">Total:</span>
              <span className="text-[#4fc3f7] font-bold text-sm">
                {Math.floor(grandTotalMin / 60)} hrs{grandTotalMin % 60 > 0 ? ` ${grandTotalMin % 60} mins` : ""}
              </span>
            </div>
          </div>
        )}

        {/* Report Table */}
        {loading ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">Loading report...</p>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-visible shadow-xl relative">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-purple-600 to-purple-500">
                  {/* Employee - clickable header with dropdown */}
                  <th className="text-left font-semibold text-white relative p-0">
                    <button
                      type="button"
                      data-dropdown
                      onClick={() => { setEmpDropdownOpen(!empDropdownOpen); setProjDropdownOpen(false); }}
                      className="w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Employee
                      {filterEmployee && (
                        <span className="bg-white/25 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">1</span>
                      )}
                      <span className="text-white/60 text-xs">▾</span>
                    </button>
                    {empDropdownOpen && (
                      <div data-dropdown className="absolute top-full left-2 mt-1 min-w-[200px] bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-1 max-h-56 overflow-y-auto" style={{zIndex: 60}}>
                        {filterEmployee && (
                          <button
                            type="button"
                            onClick={() => { setFilterEmployee(""); setEmpDropdownOpen(false); }}
                            className="w-full text-left px-3 py-1.5 text-[11px] text-[#4fc3f7] hover:bg-white/10 border-b border-white/10"
                          >
                            Clear filter
                          </button>
                        )}
                        {employees.map((emp) => (
                          <button
                            key={emp.email}
                            type="button"
                            onClick={() => { setFilterEmployee(emp.email); setEmpDropdownOpen(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${filterEmployee === emp.email ? "text-[#4fc3f7] bg-white/5" : "text-white/90"}`}
                          >
                            {emp.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Time</th>
                  {/* Project - clickable header with dropdown */}
                  <th className="text-left font-semibold text-white relative p-0">
                    <button
                      type="button"
                      data-dropdown
                      onClick={() => { setProjDropdownOpen(!projDropdownOpen); setEmpDropdownOpen(false); }}
                      className="w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Project
                      {filterProject && (
                        <span className="bg-white/25 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">1</span>
                      )}
                      <span className="text-white/60 text-xs">▾</span>
                    </button>
                    {projDropdownOpen && (
                      <div data-dropdown className="absolute top-full left-2 mt-1 min-w-[200px] bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-1 max-h-56 overflow-y-auto" style={{zIndex: 60}}>
                        {filterProject && (
                          <button
                            type="button"
                            onClick={() => { setFilterProject(null); setProjDropdownOpen(false); }}
                            className="w-full text-left px-3 py-1.5 text-[11px] text-[#4fc3f7] hover:bg-white/10 border-b border-white/10"
                          >
                            Clear filter
                          </button>
                        )}
                        {projects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setFilterProject(p.id); setProjDropdownOpen(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${filterProject === p.id ? "text-[#4fc3f7] bg-white/5" : "text-white/90"}`}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Task Description</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-white/40 text-sm">No entries found</td>
                  </tr>
                ) : (
                  filtered.map((r: any, idx: number) => {
                    const dateStr = typeof r.task_date === "string" ? r.task_date.split("T")[0] : "";
                    return (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}>
                        <td className="px-4 py-2.5 text-white/80 border-t border-white/10 text-xs font-medium">{r.employee_name}</td>
                        <td className="px-4 py-2.5 text-white/70 border-t border-white/10 text-xs">{dateStr}</td>
                        <td className="px-4 py-2.5 text-[#4fc3f7] font-medium border-t border-white/10 text-xs">
                          {r.from_time_ist && r.to_time_ist ? `${r.from_time_ist} – ${r.to_time_ist}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-white/60 border-t border-white/10 text-xs">{r.project_name || "—"}</td>
                        <td className="px-4 py-2.5 text-white/80 border-t border-white/10 text-xs">{r.task_description}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-white/10 border-t-2 border-white/20">
                    <td colSpan={2} className="px-4 py-3 text-white font-semibold text-sm">Grand Total</td>
                    <td colSpan={3} className="px-4 py-3 text-[#4fc3f7] font-bold text-sm">
                      {Math.floor(grandTotalMin / 60)} hrs{grandTotalMin % 60 > 0 ? ` ${grandTotalMin % 60} mins` : ""}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
