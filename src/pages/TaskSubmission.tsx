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

interface HourRow {
  from: string; // IST HH:mm
  to: string;   // IST HH:mm
  taskDescription: string;
  saved: boolean; // true if task was already saved to DB
}

export default function TaskSubmission({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"draft" | "submitted" | null>(null);
  const [editingBlocks, setEditingBlocks] = useState(false);
  const [blocks, setBlocks] = useState<{ from: string; to: string; locked?: boolean }[]>([]);
  const [savingBlocks, setSavingBlocks] = useState(false);

  const submitted = status === "submitted";

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

  useEffect(() => {
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
        })),
      };

      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setStatus("draft");
        alert("Draft saved successfully!");
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
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="text-[#4fc3f7] hover:text-white transition-colors">← Back</button>
          <h1 className="text-xl font-semibold text-white">Task Submission</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Date picker + status */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              min={new Date(Date.now() - 86400000).toISOString().split("T")[0]}
              max={new Date().toISOString().split("T")[0]}
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
          {!submitted && !editingBlocks && (
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
                      {submitted || hour.saved ? (
                        <div className="flex items-center gap-2">
                          <span className="text-white/70">{hour.taskDescription}</span>
                          {hour.saved && !submitted && <span className="text-yellow-400 text-xs">🔒</span>}
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
        {!submitted && hours.length > 0 && (
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
      </div>
    </div>
  );
}
