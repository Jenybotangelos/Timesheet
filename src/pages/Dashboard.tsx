import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

interface Employee {
  id: number;
  name: string;
  email: string;
}

// UTC "HH:mm" → IST "HH:mm"
function utcToIst(utc: string): string {
  const [h, m] = utc.split(":").map(Number);
  let totalMin = h * 60 + m + 330; // +5:30
  if (totalMin >= 1440) totalMin -= 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

function getHoursBetween(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return (th * 60 + tm - (fh * 60 + fm)) / 60;
}

// Returns which halves of the hour are active: { first: boolean, second: boolean }
function getHalfHourStatus(
  hour: number,
  blocks: { from: string; to: string }[]
): { first: boolean; second: boolean } {
  const firstStart = hour * 60;
  const firstEnd = hour * 60 + 30;
  const secondStart = hour * 60 + 30;
  const secondEnd = hour * 60 + 60;

  let first = false;
  let second = false;

  for (const b of blocks) {
    const [fh, fm] = b.from.split(":").map(Number);
    const [th, tm] = b.to.split(":").map(Number);
    const startMin = fh * 60 + fm;
    const endMin = th * 60 + tm;
    if (firstStart < endMin && startMin < firstEnd) first = true;
    if (secondStart < endMin && startMin < secondEnd) second = true;
  }
  return { first, second };
}

export default function Dashboard({ userEmail, userRole, onLogout }: { userEmail: string; userRole: string; onLogout: () => void }) {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [schedule, setSchedule] = useState<Record<string, { from: string; to: string }[]>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const selectedEmployees = employees.filter((e) => selectedEmails.includes(e.email));

  // Fetch employees on mount
  useEffect(() => {
    fetch(`${API_BASE}/employees`)
      .then((r) => r.json())
      .then((data) => {
        setEmployees(data);
      })
      .catch((err) => console.error("Failed to fetch employees:", err));
  }, []);

  // Fetch schedule when selected employees or date changes
  useEffect(() => {
    if (selectedEmails.length === 0) {
      setSchedule({});
      return;
    }
    const emails = selectedEmails.join(",");
    fetch(`${API_BASE}/schedule?emails=${encodeURIComponent(emails)}&date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => {
        // API returns IST times directly as { from_time_ist, to_time_ist }
        const converted: Record<string, { from: string; to: string }[]> = {};
        for (const email of Object.keys(data)) {
          converted[email] = data[email].map((b: any) => {
            return { from: b.from_time_ist, to: b.to_time_ist };
          });
        }
        setSchedule(converted);
      })
      .catch((err) => console.error("Failed to fetch schedule:", err));
  }, [selectedEmails, selectedDate]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleEmployee(email: string) {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((x) => x !== email) : [...prev, email]
    );
  }

  function getBlocksForEmployee(email: string) {
    return schedule[email] || [];
  }

  function getTotalHours(email: string): number {
    const blocks = getBlocksForEmployee(email);
    return blocks.reduce((sum, b) => sum + getHoursBetween(b.from, b.to), 0);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460]">
      {/* Header bar */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-white">Task Sheet</h1>
        <div className="flex items-center gap-3">
          <span className="text-white/60 text-sm">{userEmail}</span>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 bg-white/10 border border-white/30 text-white/80 rounded-lg hover:bg-white/20 text-sm transition-all"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Controls bar */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 flex flex-wrap items-end gap-4 shadow-lg relative z-20">
          {/* Multiselect Dropdown */}
          <div className="relative flex-1 min-w-[250px]" ref={dropdownRef}>
            <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">
              People
            </label>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full border border-white/30 rounded-lg px-3 py-2 text-left text-sm bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] transition-all min-h-[38px]"
            >
              {selectedEmployees.length === 0 ? (
                <span className="text-white/50">Select employees...</span>
              ) : (
                <span className="text-white flex flex-wrap gap-1 pr-5">
                  {selectedEmployees.map((emp) => (
                    <span
                      key={emp.email}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#4fc3f7]/20 text-[#4fc3f7] rounded-full text-xs font-medium border border-[#4fc3f7]/30"
                    >
                      {emp.name}
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); toggleEmployee(emp.email); }}
                        className="hover:text-red-400 cursor-pointer"
                      >
                        ×
                      </span>
                    </span>
                  ))}
                </span>
              )}
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50">▾</span>
            </button>

            {dropdownOpen && (
              <div className="absolute z-50 mt-2 w-full bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-2 max-h-56 overflow-y-auto">
                {employees.map((emp) => (
                  <label
                    key={emp.email}
                    className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-white/10 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmails.includes(emp.email)}
                      onChange={() => toggleEmployee(emp.email)}
                      className="accent-[#4fc3f7] w-4 h-4 rounded"
                    />
                    <span className="text-sm text-white/90">{emp.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Date Picker */}
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">
              Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] transition-all"
            />
          </div>

          {/* Action Buttons */}
          <button
            onClick={() => navigate("/edit")}
            className="px-4 py-2 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 text-sm font-medium transition-all"
          >
            Edit Hours
          </button>
          <button
            onClick={() => navigate("/submit")}
            className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] text-sm font-medium transition-all shadow-md"
          >
            Submit Task
          </button>
          {userRole === "admin" && (
            <button
              onClick={() => navigate("/projects")}
              className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-700 text-white rounded-lg hover:from-purple-400 hover:to-purple-600 text-sm font-medium transition-all shadow-md"
            >
              Projects
            </button>
          )}
        </div>

        {/* Calendar Grid */}
        {selectedEmployees.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden shadow-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]">
                  <th className="text-left px-4 py-3 font-semibold text-white border-r border-white/20 w-[70px]">
                    Time
                  </th>
                  {selectedEmployees.map((emp) => (
                    <th key={emp.email} className="px-4 py-3 font-semibold text-center text-white border-r border-white/20 last:border-r-0">
                      {emp.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map((h, idx) => (
                  <tr key={h} className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}>
                    <td className="px-4 py-0 font-medium text-white/60 border border-white/10 text-xs align-middle">
                      {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                    </td>
                    {selectedEmployees.map((emp) => {
                      const blocks = getBlocksForEmployee(emp.email);
                      const { first, second } = getHalfHourStatus(h, blocks);
                      return (
                        <td
                          key={emp.email}
                          className="p-0 border border-white/10"
                        >
                          <div className="flex flex-col h-full">
                            <div
                              className={`h-[22px] ${
                                first
                                  ? "bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]"
                                  : ""
                              }`}
                            />
                            <div className="border-t border-white/[0.06]" />
                            <div
                              className={`h-[22px] ${
                                second
                                  ? "bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]"
                                  : ""
                              }`}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Footer row: total hours */}
                <tr className="bg-white/10 font-semibold border-t border-white/20">
                  <td className="px-4 py-3 text-white/80 border-r border-white/10 text-xs uppercase">
                    Total
                  </td>
                  {selectedEmployees.map((emp) => (
                    <td key={emp.email} className="px-4 py-3 text-center text-[#4fc3f7] font-bold border-r border-white/10 last:border-r-0">
                      {getTotalHours(emp.email)}h
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {selectedEmployees.length === 0 && (
          <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 p-16 text-center shadow-xl">
            <p className="text-white/40 text-sm">Select employees to view their schedule</p>
          </div>
        )}
      </div>
    </div>
  );
}
