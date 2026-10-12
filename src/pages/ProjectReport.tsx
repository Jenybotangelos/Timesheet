import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import FilterHeader from "../components/FilterHeader";
import Pagination from "../components/Pagination";
import DateFilterHeader, { type DateRange } from "../components/DateFilterHeader";
import { formatDateShort } from "../components/dateRanges";
import { useReport, formatMinutes } from "../components/useReport";

const API_BASE = "/api";

type FilterName = "employee" | "date" | "project" | "task" | "stage";

export default function ProjectReport({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [page, setPage] = useState(1);
  const [filterProject, setFilterProject] = useState<number | null>(null);
  const [filterEmployee, setFilterEmployee] = useState<string | null>(null);
  const [filterTask, setFilterTask] = useState<number | null>(null);
  const [filterStage, setFilterStage] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<DateRange | null>(null);
  const [openDropdown, setOpenDropdown] = useState<FilterName | null>(null);

  // Filtering, totals and paging are done by the server
  const { data, loading } = useReport(`${API_BASE}/tasks/project-report`, {
    email: userEmail,
    page,
    employee: filterEmployee,
    projectId: filterProject,
    taskId: filterTask,
    stage: filterStage,
    startDate: filterDate?.start ?? null,
    endDate: filterDate?.end ?? null,
  });

  function toggleDropdown(name: FilterName) {
    setOpenDropdown((cur) => (cur === name ? null : name));
  }

  // Any filter change starts again from page 1
  function applyFilter(apply: () => void) {
    apply();
    setPage(1);
    setOpenDropdown(null);
  }

  useEffect(() => {
    fetch(`${API_BASE}/employees`)
      .then((r) => r.json())
      .then((emps) => setEmployees(Array.isArray(emps) ? emps : []))
      .catch((err) => console.error("Failed to fetch employees:", err));
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!openDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown]")) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdown]);

  const employeeOptions = employees.map((e) => ({ value: e.email, label: e.name }));
  const rows = data.rows;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/projects")} className="text-[#4fc3f7] hover:text-white transition-colors">
            ← Back
          </button>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Project Report</h1>
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium border border-purple-500/30">
            Admin
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Project totals summary */}
        {data.projectTotals.length > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 px-4 sm:px-5 py-3 mb-4 shadow-lg flex flex-wrap gap-4 sm:gap-6">
            {data.projectTotals.map(({ project_name, minutes }) => (
              <div key={project_name} className="flex items-center gap-2">
                <span className="text-white/80 text-sm font-medium">{project_name}:</span>
                <span className="text-[#4fc3f7] text-sm font-bold">
                  {Math.floor(minutes / 60)}h {minutes % 60 > 0 ? `${minutes % 60}m` : ""}
                </span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-4 border-l border-white/20 pl-4 sm:pl-6">
              {filterDate && (
                <span className="text-white/50 text-xs sm:text-sm">
                  {filterDate.start === filterDate.end
                    ? formatDateShort(filterDate.start)
                    : `${formatDateShort(filterDate.start)} – ${formatDateShort(filterDate.end)}`}
                </span>
              )}
              <span className="text-white/80 text-sm">
                <span className="font-semibold text-white">Rows:</span> {data.totalRows}
              </span>
              <span className="text-white font-semibold text-sm">Total:</span>
              <span className="text-[#4fc3f7] font-bold text-sm -ml-2">{formatMinutes(data.totalMinutes)}</span>
            </div>
          </div>
        )}

        {/* Report Table */}
        {loading ? (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">Loading report...</p>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-gradient-to-r from-purple-600 to-purple-500">
                    <FilterHeader
                      label="Employee"
                      options={employeeOptions}
                      value={filterEmployee}
                      onChange={(v) => applyFilter(() => setFilterEmployee(v))}
                      open={openDropdown === "employee"}
                      onToggle={() => toggleDropdown("employee")}
                    />
                    <DateFilterHeader
                      value={filterDate}
                      onChange={(v) => applyFilter(() => setFilterDate(v))}
                      open={openDropdown === "date"}
                      onToggle={() => toggleDropdown("date")}
                    />
                    <th className="px-4 py-3 text-left font-semibold text-white whitespace-nowrap">
                      Time
                    </th>
                    <FilterHeader
                      label="Project"
                      options={data.options.projects}
                      value={filterProject}
                      onChange={(v) => applyFilter(() => { setFilterProject(v); setFilterTask(null); setFilterStage(null); })}
                      open={openDropdown === "project"}
                      onToggle={() => toggleDropdown("project")}
                    />
                    <FilterHeader
                      label="Task"
                      options={data.options.tasks}
                      value={filterTask}
                      onChange={(v) => applyFilter(() => setFilterTask(v))}
                      open={openDropdown === "task"}
                      onToggle={() => toggleDropdown("task")}
                    />
                    <FilterHeader
                      label="Stage"
                      options={data.options.stages}
                      value={filterStage}
                      onChange={(v) => applyFilter(() => setFilterStage(v))}
                      open={openDropdown === "stage"}
                      onToggle={() => toggleDropdown("stage")}
                    />
                    <th className="px-4 py-3 text-left font-semibold text-white">
                      Task Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-white/40 text-sm">
                        No entries found
                      </td>
                    </tr>
                  ) : (
                    rows.map((r: any, idx: number) => {
                      const dateStr =
                        typeof r.task_date === "string" ? r.task_date.split("T")[0] : "";
                      return (
                        <tr
                          key={idx}
                          className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}
                        >
                          <td className="px-4 py-2.5 text-white/80 border-t border-white/10 text-xs font-medium whitespace-nowrap">
                            {r.employee_name}
                          </td>
                          <td className="px-4 py-2.5 text-white/70 border-t border-white/10 text-xs whitespace-nowrap">
                            {dateStr}
                          </td>
                          <td className="px-4 py-2.5 text-[#4fc3f7] font-medium border-t border-white/10 text-xs whitespace-nowrap">
                            {r.from_time_ist && r.to_time_ist
                              ? `${r.from_time_ist} – ${r.to_time_ist}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-white/60 border-t border-white/10 text-xs whitespace-nowrap">
                            {r.project_name || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-white/60 border-t border-white/10 text-xs whitespace-nowrap">
                            {r.project_task_name || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-white/60 border-t border-white/10 text-xs whitespace-nowrap">
                            {r.bucket_name || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-white/80 border-t border-white/10 text-xs">
                            {r.task_description}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-white/10 border-t-2 border-white/20">
                      <td colSpan={2} className="px-4 py-3 text-white font-semibold text-sm">
                        Grand Total
                      </td>
                      <td colSpan={5} className="px-4 py-3 text-[#4fc3f7] font-bold text-sm">
                        {formatMinutes(data.totalMinutes)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination page={page} pageSize={data.pageSize} totalRows={data.totalRows} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
