import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import FilterHeader from "../components/FilterHeader";
import Pagination from "../components/Pagination";
import { useReport, formatMinutes } from "../components/useReport";
import { PRESETS, presetRange, formatDateShort, type RangePreset } from "../components/dateRanges";

const API_BASE = "/api";

type FilterName = "employee" | "project" | "task" | "stage";

// Admin report of all task entries in a date range (defaults to last week, Sunday–Saturday)
export default function DateReport({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<RangePreset>("lastWeek");
  const [reportStartDate, setReportStartDate] = useState(() => presetRange("lastWeek")[0]);
  const [reportEndDate, setReportEndDate] = useState(() => presetRange("lastWeek")[1]);

  function choosePreset(next: RangePreset) {
    setPreset(next);
    setPage(1);
    if (next === "custom") return; // keep the current dates as the starting point
    const [start, end] = presetRange(next);
    setReportStartDate(start);
    setReportEndDate(end);
  }
  const [employees, setEmployees] = useState<{ id: number; name: string; email: string }[]>([]);
  const [reportEmployee, setReportEmployee] = useState<string | null>(null);
  const [reportProject, setReportProject] = useState<number | null>(null);
  const [reportTask, setReportTask] = useState<number | null>(null);
  const [reportStage, setReportStage] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<FilterName | null>(null);
  const [page, setPage] = useState(1);

  // Filtering, totals and paging are done by the server
  const { data, loading } = useReport(`${API_BASE}/tasks/weekly`, {
    email: userEmail,
    startDate: reportStartDate,
    endDate: reportEndDate,
    page,
    employee: reportEmployee,
    projectId: reportProject,
    taskId: reportTask,
    stage: reportStage,
  });

  // Any filter change starts again from page 1
  function applyFilter(apply: () => void) {
    apply();
    setPage(1);
    setOpenDropdown(null);
  }

  function toggleDropdown(name: FilterName) {
    setOpenDropdown((cur) => (cur === name ? null : name));
  }

  useEffect(() => {
    if (!openDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown]")) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdown]);

  useEffect(() => {
    fetch(`${API_BASE}/employees`)
      .then((r) => r.json())
      .then((data) => setEmployees(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to fetch employees:", err));
  }, []);

  const reportEmployeeOptions = employees.map((e) => ({ value: e.email, label: e.name }));
  const rows = data.rows;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-4">
          <button onClick={() => navigate("/")} className="text-[#4fc3f7] hover:text-white transition-colors">
            ← Back
          </button>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Date-wise Report</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30">
            Admin
          </span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-24">
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 px-4 sm:px-5 py-3 mb-4 shadow-lg flex flex-wrap items-center gap-2 sm:gap-3">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => choosePreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border transition-all ${
                preset === p.key
                  ? "bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50"
                  : "bg-white/5 text-white/60 border-white/15 hover:bg-white/10 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}

          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
              <input
                type="date"
                value={reportStartDate}
                max={reportEndDate}
                onChange={(e) => { setReportStartDate(e.target.value); setPage(1); }}
                className="border border-white/30 rounded-lg px-2 py-1 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
              />
              <span className="text-white/50 text-sm">to</span>
              <input
                type="date"
                value={reportEndDate}
                min={reportStartDate}
                onChange={(e) => { setReportEndDate(e.target.value); setPage(1); }}
                className="border border-white/30 rounded-lg px-2 py-1 text-sm bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]"
              />
            </div>
          ) : (
            <span className="text-white/50 text-xs sm:text-sm w-full sm:w-auto sm:ml-auto">
              {reportStartDate === reportEndDate
                ? formatDateShort(reportStartDate)
                : `${formatDateShort(reportStartDate)} – ${formatDateShort(reportEndDate)}`}
            </span>
          )}
        </div>

        {!loading && data.totalRows > 0 && (
          <div className="flex flex-wrap items-center gap-4 mb-3 px-1 text-sm">
            <span className="text-white/80">
              <span className="font-semibold text-white">Rows:</span> {data.totalRows}
            </span>
            <span className="text-white/80">
              <span className="font-semibold text-white">Total:</span>{" "}
              <span className="text-[#4fc3f7] font-bold">{formatMinutes(data.totalMinutes)}</span>
            </span>
          </div>
        )}

        {loading ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">Loading report...</p>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]">
                    <FilterHeader
                      label="Employee"
                      options={reportEmployeeOptions}
                      value={reportEmployee}
                      onChange={(v) => applyFilter(() => setReportEmployee(v))}
                      open={openDropdown === "employee"}
                      onToggle={() => toggleDropdown("employee")}
                    />
                    <th className="px-4 py-3 text-left font-semibold text-white">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-white">Time</th>
                    <FilterHeader
                      label="Project"
                      options={data.options.projects}
                      value={reportProject}
                      onChange={(v) => applyFilter(() => { setReportProject(v); setReportTask(null); setReportStage(null); })}
                      open={openDropdown === "project"}
                      onToggle={() => toggleDropdown("project")}
                    />
                    <FilterHeader
                      label="Task"
                      options={data.options.tasks}
                      value={reportTask}
                      onChange={(v) => applyFilter(() => setReportTask(v))}
                      open={openDropdown === "task"}
                      onToggle={() => toggleDropdown("task")}
                    />
                    <FilterHeader
                      label="Stage"
                      options={data.options.stages}
                      value={reportStage}
                      onChange={(v) => applyFilter(() => setReportStage(v))}
                      open={openDropdown === "stage"}
                      onToggle={() => toggleDropdown("stage")}
                    />
                    <th className="px-4 py-3 text-left font-semibold text-white">Task Description</th>
                    <th className="px-4 py-3 text-left font-semibold text-white w-[90px]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-white/40 text-sm">
                        No tasks found for this date range
                      </td>
                    </tr>
                  ) : (
                    rows.map((t: any, idx: number) => {
                      const fromIst = t.from_time_ist || "";
                      const toIst = t.to_time_ist || "";
                      const dateStr =
                        typeof t.task_date === "string"
                          ? t.task_date.split("T")[0]
                          : new Date(t.task_date).toISOString().split("T")[0];
                      return (
                        <tr key={idx} className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}>
                          <td className="px-4 py-2 text-white/80 border-t border-white/10 text-xs font-medium whitespace-nowrap">
                            {t.employee_name}
                          </td>
                          <td className="px-4 py-2 text-white/70 border-t border-white/10 text-xs whitespace-nowrap">
                            {formatDateShort(dateStr)}
                          </td>
                          <td className="px-4 py-2 text-[#4fc3f7] font-medium border-t border-white/10 text-xs whitespace-nowrap">
                            {fromIst && toIst ? `${fromIst} – ${toIst}` : "—"}
                          </td>
                          <td className="px-4 py-2 text-white/60 border-t border-white/10 text-xs whitespace-nowrap">
                            {t.project_name || "—"}
                          </td>
                          <td className="px-4 py-2 text-white/60 border-t border-white/10 text-xs whitespace-nowrap">
                            {t.project_task_name || "—"}
                          </td>
                          <td className="px-4 py-2 text-white/60 border-t border-white/10 text-xs whitespace-nowrap">
                            {t.bucket_name || "—"}
                          </td>
                          <td className="px-4 py-2 text-white/80 border-t border-white/10 text-xs">
                            {t.task_description}
                          </td>
                          <td className="px-4 py-2 border-t border-white/10 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                t.status === "submitted"
                                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                  : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                              }`}
                            >
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={data.pageSize} totalRows={data.totalRows} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
