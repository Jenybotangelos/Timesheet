import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";


// Convert UTC HH:mm to IST HH:mm
function utcToIst(utc: string): string {
  const [h, m] = utc.split(":").map(Number);
  let totalMin = h * 60 + m + 330; // +5:30
  if (totalMin >= 1440) totalMin -= 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

// Convert IST HH:mm to UTC HH:mm
function istToUtc(ist: string): string {
  const [h, m] = ist.split(":").map(Number);
  let totalMin = h * 60 + m - 330; // -5:30
  if (totalMin < 0) totalMin += 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

// Check if a date is editable (today and yesterday only)
function isDateEditable(date: string): boolean {
  const selectedDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  selectedDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - selectedDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 1;
}

interface HourRow {
  from: string; // IST HH:mm
  to: string;   // IST HH:mm
  taskDescription: string;
  projectId: number | null;
  saved: boolean; // true if task was already saved to DB
}

interface Project {
  id: number;
  name: string;
  description: string;
}

export default function TaskSubmission({ userEmail, userRole }: { userEmail: string; userRole: string }) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"my-tasks" | "weekly-report">("my-tasks");
  const [selectedDate, setSelectedDate] = useState(() => {
    return sessionStorage.getItem("tasksheet_selected_date") || new Date().toISOString().split("T")[0];
  });
  const [hours, setHours] = useState<HourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"draft" | "submitted" | null>(null);
  const [editingBlocks, setEditingBlocks] = useState(false);
  const [blocks, setBlocks] = useState<{ from: string; to: string; locked?: boolean }[]>([]);
  const [savingBlocks, setSavingBlocks] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  // Weekly report state (admin only)
  const [reportStartDate, setReportStartDate] = useState(() => {
    const d = new Date();
    const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
    const diff = day === 0 ? -13 : -day - 6; // Previous week Monday
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    return mon.toISOString().split("T")[0];
  });
  const [reportEndDate, setReportEndDate] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -7 : -day; // Previous week Sunday
    const sun = new Date(d);
    sun.setDate(d.getDate() + diff);
    return sun.toISOString().split("T")[0];
  });
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [employees, setEmployees] = useState<{ id: number; name: string; email: string }[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<number[]>([]);
  const [empDropdownOpen, setEmpDropdownOpen] = useState(false);
  const [projDropdownOpen, setProjDropdownOpen] = useState(false);

  // Close dropdowns on any click outside them
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

  const submitted = status === "submitted";
  const isEditable = isDateEditable(selectedDate) && !submitted;

  async function fetchHours() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tasks?email=${userEmail}&date=${selectedDate}`);
      const data = await res.json();

      setStatus(data.status || null);
      setHours(
        data.hours.map((h: any) => ({
          from: utcToIst(h.from_time_utc),
          to: utcToIst(h.to_time_utc),
          taskDescription: h.task_description || "",
          projectId: h.project_id || null,
          saved: !!h.task_description,
        }))
      );
    } catch (err) {
      console.error("Failed to fetch:", err);
      setHours([]);
    } finally {
      setLoading(false);
    }
  }

  // Fetch active projects
  useEffect(() => {
    fetch(`${API_BASE}/projects`)
      .then((r) => r.json())
      .then((data) => setProjects(data.filter((p: any) => p.is_active)))
      .catch((err) => console.error("Failed to fetch projects:", err));
    // Fetch employees for admin weekly report
    fetch(`${API_BASE}/employees`)
      .then((r) => r.json())
      .then((data) => setEmployees(data))
      .catch((err) => console.error("Failed to fetch employees:", err));
  }, []);

  // Fetch weekly report data
  async function fetchWeeklyReport() {
    setWeeklyLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tasks/weekly?startDate=${reportStartDate}&endDate=${reportEndDate}&email=${userEmail}`);
      if (res.ok) {
        const data = await res.json();
        setWeeklyData(data);
      } else {
        const err = await res.json();
        console.error("Weekly report error:", err);
        setWeeklyData([]);
      }
    } catch (err) {
      console.error("Failed to fetch weekly report:", err);
      setWeeklyData([]);
    } finally {
      setWeeklyLoading(false);
    }
  }

  useEffect(() => {
    if (viewMode === "weekly-report") {
      fetchWeeklyReport();
    }
  }, [reportStartDate, reportEndDate, viewMode]);

  function toggleReportEmployee(email: string) {
    setSelectedEmployees((prev) =>
      prev.includes(email) ? prev.filter((x) => x !== email) : [...prev, email]
    );
  }

  function toggleReportProject(id: number) {
    setSelectedProjects((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function formatDateShort(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  useEffect(() => {
    sessionStorage.setItem("tasksheet_selected_date", selectedDate);
    fetchHours();
    setEditingBlocks(false);
  }, [selectedDate]);

  function startEditBlocks() {
    // Group consecutive hours into blocks for editing, marking locked ones
    if (hours.length === 0) {
      setBlocks([{ from: "09:00", to: "10:00" }]);
    } else {
      const grouped: { from: string; to: string; locked?: boolean }[] = [];
      let currentFrom = hours[0].from;
      let currentTo = hours[0].to;
      let currentLocked = status === "draft" && !!hours[0].taskDescription.trim();
      for (let i = 1; i < hours.length; i++) {
        const hourLocked = status === "draft" && !!hours[i].taskDescription.trim();
        if (hours[i].from === currentTo && hourLocked === currentLocked) {
          currentTo = hours[i].to;
        } else {
          grouped.push({ from: currentFrom, to: currentTo, locked: currentLocked });
          currentFrom = hours[i].from;
          currentTo = hours[i].to;
          currentLocked = hourLocked;
        }
      }
      grouped.push({ from: currentFrom, to: currentTo, locked: currentLocked });
      setBlocks(grouped);
    }
    setEditingBlocks(true);
  }

  function addBlock() {
    setBlocks([...blocks, { from: "00:00", to: "00:00" }]);
  }

  function removeBlock(index: number) {
    if (blocks[index]?.locked) return;
    setBlocks(blocks.filter((_, i) => i !== index));
  }

  function updateBlock(index: number, field: "from" | "to", value: string) {
    setBlocks(blocks.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  }

  async function saveBlocks() {
    setSavingBlocks(true);
    try {
      const payload = {
        email: userEmail,
        date: selectedDate,
        blocks: blocks.map((b) => ({
          from: istToUtc(b.from),
          to: istToUtc(b.to),
        })),
      };
      const res = await fetch(`${API_BASE}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditingBlocks(false);
        await fetchHours();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to save blocks:", err);
      alert("Failed to save blocks");
    } finally {
      setSavingBlocks(false);
    }
  }

  function updateTask(index: number, value: string) {
    setHours(hours.map((h, i) => (i === index ? { ...h, taskDescription: value } : h)));
  }

  function updateProject(index: number, projectId: number | null) {
    setHours(hours.map((h, i) => (i === index ? { ...h, projectId } : h)));
  }

  async function handleSave() {
    if (!confirm("After saving, hours with task descriptions cannot have their time changed. Continue?")) return;
    setSaving(true);
    try {
      const payload = {
        email: userEmail,
        date: selectedDate,
        action: "save",
        hours: hours.map((h) => ({
          from: istToUtc(h.from),
          to: istToUtc(h.to),
          taskDescription: h.taskDescription,
          projectId: h.projectId,
        })),
      };

      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setStatus("draft");
        await fetchHours();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to save:", err);
      alert("Failed to save draft");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    const emptyTask = hours.find((h) => !h.taskDescription.trim());
    if (emptyTask) {
      alert("Please fill in the task description for all hours before submitting.");
      return;
    }

    if (!confirm("Once submitted, you cannot edit these tasks. Continue?")) return;

    setSubmitting(true);
    try {
      const payload = {
        email: userEmail,
        date: selectedDate,
        action: "submit",
        hours: hours.map((h) => ({
          from: istToUtc(h.from),
          to: istToUtc(h.to),
          taskDescription: h.taskDescription,
          projectId: h.projectId,
        })),
      };

      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setStatus("submitted");
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to submit:", err);
      alert("Failed to submit tasks");
    } finally {
      setSubmitting(false);
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
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-[#4fc3f7] hover:text-white transition-colors">← Back</button>
          <h1 className="text-xl font-semibold text-white">{viewMode === "weekly-report" ? "Reports" : "My Tasks"}</h1>
          {userRole === "admin" && (
            <div className="ml-auto flex bg-white/10 rounded-lg border border-white/20 p-0.5">
              <button
                onClick={() => setViewMode("my-tasks")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === "my-tasks"
                    ? "bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white shadow"
                    : "text-white/60 hover:text-white"
                }`}
              >
                My Tasks
              </button>
              <button
                onClick={() => setViewMode("weekly-report")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === "weekly-report"
                    ? "bg-gradient-to-r from-purple-500 to-purple-700 text-white shadow"
                    : "text-white/60 hover:text-white"
                }`}
              >
                Report
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* Weekly Report View (Admin) */}
        {viewMode === "weekly-report" && userRole === "admin" ? (
          <>
            {/* Date range bar on top */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 px-5 py-3 mb-4 shadow-lg flex flex-wrap items-center gap-4">
              <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">Date Range</span>
              <input
                type="date"
                value={reportStartDate}
                onChange={(e) => setReportStartDate(e.target.value)}
                className="border border-white/30 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
              />
              <span className="text-white/40 text-sm">to</span>
              <input
                type="date"
                value={reportEndDate}
                onChange={(e) => setReportEndDate(e.target.value)}
                className="border border-white/30 rounded-lg px-3 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
              />
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30 ml-auto">Admin</span>
            </div>

            {/* Report Table */}
            {weeklyLoading ? (
              <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
                <p className="text-white/40 text-sm">Loading report...</p>
              </div>
            ) : (() => {
              let filtered = weeklyData;
              if (selectedEmployees.length > 0) {
                filtered = filtered.filter((r) => selectedEmployees.includes(r.employee_email));
              }
              if (selectedProjects.length > 0) {
                filtered = filtered.filter((r) => selectedProjects.includes(r.project_id));
              }
              return (
                <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-visible shadow-xl relative">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]">
                        {/* Employee - clickable header with dropdown */}
                        <th className="text-left font-semibold text-white relative p-0">
                          <button
                            type="button"
                            data-dropdown
                            onClick={() => { setEmpDropdownOpen(!empDropdownOpen); setProjDropdownOpen(false); }}
                            className="w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            Employee
                            {selectedEmployees.length > 0 && (
                              <span className="bg-white/25 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">{selectedEmployees.length}</span>
                            )}
                            <span className="text-white/60 text-xs">▾</span>
                          </button>
                          {empDropdownOpen && (
                            <div data-dropdown className="absolute top-full left-2 mt-1 min-w-[200px] bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-1 max-h-56 overflow-y-auto" style={{zIndex: 60}}>
                              {selectedEmployees.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedEmployees([])}
                                  className="w-full text-left px-3 py-1.5 text-[11px] text-[#4fc3f7] hover:bg-white/10 border-b border-white/10"
                                >
                                  Clear all
                                </button>
                              )}
                              {employees.map((emp) => (
                                <label key={emp.email} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/10 transition-colors">
                                  <input type="checkbox" checked={selectedEmployees.includes(emp.email)} onChange={() => toggleReportEmployee(emp.email)} className="accent-[#4fc3f7] w-3.5 h-3.5 rounded" />
                                  <span className="text-xs text-white/90">{emp.name}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-white min-w-[150px]">Date</th>
                        <th className="px-4 py-3 text-left font-semibold text-white min-w-[150px]">Time</th>
                        {/* Project - clickable header with dropdown */}
                        <th className="text-left font-semibold text-white relative p-0">
                          <button
                            type="button"
                            data-dropdown
                            onClick={() => { setProjDropdownOpen(!projDropdownOpen); setEmpDropdownOpen(false); }}
                            className="w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            Project
                            {selectedProjects.length > 0 && (
                              <span className="bg-white/25 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">{selectedProjects.length}</span>
                            )}
                            <span className="text-white/60 text-xs">▾</span>
                          </button>
                          {projDropdownOpen && (
                            <div data-dropdown className="absolute top-full left-2 mt-1 min-w-[200px] bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-1 max-h-56 overflow-y-auto" style={{zIndex: 60}}>
                              {selectedProjects.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedProjects([])}
                                  className="w-full text-left px-3 py-1.5 text-[11px] text-[#4fc3f7] hover:bg-white/10 border-b border-white/10"
                                >
                                  Clear all
                                </button>
                              )}
                              {projects.map((p) => (
                                <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/10 transition-colors">
                                  <input type="checkbox" checked={selectedProjects.includes(p.id)} onChange={() => toggleReportProject(p.id)} className="accent-[#4fc3f7] w-3.5 h-3.5 rounded" />
                                  <span className="text-xs text-white/90">{p.name}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-white">Task Description</th>
                        <th className="px-4 py-3 text-left font-semibold text-white w-[90px]">Status</th>
                      </tr>
                    </thead>
                    {filtered.length === 0 ? (
                      <tbody>
                        <tr>
                          <td colSpan={6} className="px-4 py-16 text-center text-white/40 text-sm">No tasks found for this date range</td>
                        </tr>
                      </tbody>
                    ) : (
                    <tbody>
                      {filtered.map((t: any, idx: number) => {
                        const fromRaw = t.from_time_utc instanceof Date ? t.from_time_utc.toISOString() : String(t.from_time_utc || "");
                        const toRaw = t.to_time_utc instanceof Date ? t.to_time_utc.toISOString() : String(t.to_time_utc || "");
                        const fromUtc = fromRaw.includes("T") ? fromRaw.split("T")[1].substring(0, 5) : fromRaw.substring(0, 5);
                        const toUtc = toRaw.includes("T") ? toRaw.split("T")[1].substring(0, 5) : toRaw.substring(0, 5);
                        const fromIst = fromUtc ? utcToIst(fromUtc) : "";
                        const toIst = toUtc ? utcToIst(toUtc) : "";
                        const dateStr = typeof t.task_date === "string" ? t.task_date.split("T")[0] : new Date(t.task_date).toISOString().split("T")[0];
                        return (
                          <tr key={idx} className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}>
                            <td className="px-4 py-2 text-white/80 border-t border-white/10 text-xs font-medium">{t.employee_name}</td>
                            <td className="px-4 py-2 text-white/70 border-t border-white/10 text-xs">{formatDateShort(dateStr)}</td>
                            <td className="px-4 py-2 text-[#4fc3f7] font-medium border-t border-white/10 text-xs">
                              {fromIst && toIst ? `${fromIst} – ${toIst}` : "—"}
                            </td>
                            <td className="px-4 py-2 text-white/60 border-t border-white/10 text-xs">{t.project_name || "—"}</td>
                            <td className="px-4 py-2 text-white/80 border-t border-white/10 text-xs">{t.task_description}</td>
                            <td className="px-4 py-2 border-t border-white/10">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                t.status === "submitted"
                                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                  : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                              }`}>
                                {t.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    )}
                  </table>
                </div>
              );
            })()}
          </>
        ) : (
          <>
        {/* Date picker + status */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
            />
          </div>
          {submitted && (
            <span className="px-3 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-medium border border-green-500/30">
              ✓ Submitted
            </span>
          )}
          {status === "draft" && !submitted && (
            <span className="px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium border border-yellow-500/30">
              Draft Saved
            </span>
          )}
          {!isDateEditable(selectedDate) && (
            <span className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium border border-red-500/30">
              🔒 Read-Only
            </span>
          )}
          {isEditable && !editingBlocks && (
            <button
              onClick={startEditBlocks}
              className="px-3 py-2 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 text-sm font-medium transition-all"
            >
              Edit Hours
            </button>
          )}
          <div className="ml-auto text-lg font-semibold text-[#4fc3f7]">
            Total: {hours.reduce((sum, h) => {
              const [fh, fm] = h.from.split(":").map(Number);
              const [th, tm] = h.to.split(":").map(Number);
              return sum + (th * 60 + tm - (fh * 60 + fm)) / 60;
            }, 0)} hrs
          </div>
        </div>

        {/* Edit Blocks Panel */}
        {editingBlocks && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg">
            <h3 className="text-white font-semibold mb-3">Edit Working Hours</h3>
            {status === "draft" && (
              <p className="text-yellow-400/80 text-xs mb-3">Hours with saved tasks are locked and cannot be changed.</p>
            )}
            <div className="space-y-2 mb-4">
              {blocks.map((block, idx) => (
                <div key={idx} className={`flex items-center gap-3 ${block.locked ? "opacity-50" : ""}`}>
                  <input
                    type="time"
                    value={block.from}
                    onChange={(e) => updateBlock(idx, "from", e.target.value)}
                    disabled={block.locked}
                    className={`border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] ${block.locked ? "cursor-not-allowed" : ""}`}
                  />
                  <span className="text-white/50">to</span>
                  <input
                    type="time"
                    value={block.to}
                    onChange={(e) => updateBlock(idx, "to", e.target.value)}
                    disabled={block.locked}
                    className={`border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] ${block.locked ? "cursor-not-allowed" : ""}`}
                  />
                  {block.locked ? (
                    <span className="text-yellow-400 text-xs">🔒</span>
                  ) : (
                    <button onClick={() => removeBlock(idx)} className="text-red-400 hover:text-red-300 text-lg px-2">✕</button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={addBlock}
                className="px-3 py-1.5 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 text-sm"
              >
                + Add Block
              </button>
              <button
                onClick={saveBlocks}
                disabled={savingBlocks}
                className="px-3 py-1.5 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm disabled:opacity-50"
              >
                {savingBlocks ? "Saving..." : "Save Hours"}
              </button>
              <button
                onClick={() => setEditingBlocks(false)}
                className="px-3 py-1.5 bg-white/5 border border-white/20 text-white/60 rounded-lg hover:bg-white/10 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Hour-wise table */}
        {hours.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">No working hours found for this date</p>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden mb-6 shadow-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]">
                  <th className="px-4 py-3 text-left font-semibold text-white w-[50px]">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-white w-[160px]">Time Slot</th>
                  <th className="px-4 py-3 text-left font-semibold text-white w-[180px]">Project</th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Task Description</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((hour, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}>
                    <td className="px-4 py-3 font-medium text-white/60 border-t border-white/10">{idx + 1}</td>
                    <td className="px-4 py-3 text-[#4fc3f7] font-medium border-t border-white/10">
                      {hour.from} – {hour.to}
                    </td>
                    <td className="px-4 py-3 border-t border-white/10">
                      {!isEditable || hour.saved ? (
                        <span
                          className="text-white/70 text-xs cursor-default"
                          title={projects.find((p) => p.id === hour.projectId)?.description || ""}
                        >
                          {projects.find((p) => p.id === hour.projectId)?.name || "—"}
                        </span>
                      ) : (
                        <select
                          value={hour.projectId || ""}
                          onChange={(e) => updateProject(idx, e.target.value ? Number(e.target.value) : null)}
                          title={projects.find((p) => p.id === hour.projectId)?.description || ""}
                          className="w-full border border-white/30 rounded-lg px-2 py-1.5 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
                        >
                          <option value="" className="bg-[#1e293b]">Select project</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id} title={p.description} className="bg-[#1e293b]">{p.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 border-t border-white/10">
                      {!isEditable || hour.saved ? (
                        <div className="flex items-center gap-2">
                          <span className="text-white/70">{hour.taskDescription}</span>
                          {hour.saved && isDateEditable(selectedDate) && !submitted && <span className="text-yellow-400 text-xs">🔒</span>}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={hour.taskDescription}
                          onChange={(e) => updateTask(idx, e.target.value)}
                          placeholder="What did you work on?"
                          className="w-full border border-white/30 rounded-lg px-3 py-1.5 bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Save & Submit buttons */}
        {isEditable && hours.length > 0 && (
          <div className="flex justify-end gap-3">
            <button
              onClick={handleSave}
              disabled={saving || submitting}
              className="px-6 py-2 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 font-medium transition-all disabled:opacity-50"
            >
              {saving ? "Saving..." : "Submit Task"}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || saving}
              className="px-6 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] font-medium transition-all shadow-md disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit for Today"}
            </button>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
