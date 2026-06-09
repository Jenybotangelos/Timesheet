import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

// Hardcoded for now — will come from login later
interface Block {
  id?: number;
  from: string;
  to: string;
}

function getHoursBetween(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return Math.max(0, (th * 60 + tm - (fh * 60 + fm)) / 60);
}

// Convert UTC time to IST HH:mm (handles both "HH:mm" and ISO "1970-01-01T04:30:00.000Z")
function utcToIst(utcTime: string): string {
  let h: number, m: number;
  if (utcTime.includes("T")) {
    const date = new Date(utcTime);
    h = date.getUTCHours();
    m = date.getUTCMinutes();
  } else {
    [h, m] = utcTime.split(":").map(Number);
  }
  let totalMin = h * 60 + m + 330; // +5:30
  if (totalMin >= 1440) totalMin -= 1440;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

// Convert IST HH:mm to UTC HH:mm
function istToUtc(istTime: string): string {
  const [h, m] = istTime.split(":").map(Number);
  // IST is UTC+5:30
  let utcH = h - 5;
  let utcM = m - 30;
  if (utcM < 0) { utcM += 60; utcH -= 1; }
  if (utcH < 0) utcH += 24;
  return `${String(utcH).padStart(2, "0")}:${String(utcM).padStart(2, "0")}`;
}

export default function WorkingHoursEditor({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"default" | "override">("default");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [overrideDate, setOverrideDate] = useState(() => {
    const now = new Date();
    // Get IST date (UTC+5:30)
    const istOffset = now.getTime() + (330 * 60 * 1000);
    const istDate = new Date(istOffset);
    return istDate.toISOString().split("T")[0];
  });

  // Fetch blocks based on tab
  useEffect(() => {
    fetchBlocks();
  }, [tab, overrideDate]);

  async function fetchBlocks() {
    setLoading(true);
    try {
      let url = "";
      if (tab === "default") {
        url = `${API_BASE}/default-blocks?email=${userEmail}`;
      } else {
        url = `${API_BASE}/overrides?email=${userEmail}&date=${overrideDate}`;
      }

      const res = await fetch(url);
      const data = await res.json();
      const mapped: Block[] = data.map((b: any) => ({
        id: b.id,
        from: b.from_time_utc === "00:00" ? "00:00" : utcToIst(b.from_time_utc),
        to: b.to_time_utc === "00:00" ? "00:00" : utcToIst(b.to_time_utc),
      }));
      if (tab === "default") {
        setBlocks(mapped.length > 0 ? mapped : [{ from: "00:00", to: "00:00" }]);
      } else {
        setBlocks(mapped);
      }
    } catch (err) {
      console.error("Failed to fetch blocks:", err);
      setBlocks(tab === "default" ? [{ from: "00:00", to: "00:00" }] : []);
    } finally {
      setLoading(false);
    }
  }

  function addBlock() {
    setBlocks([...blocks, { from: "00:00", to: "00:00" }]);
    setDirty(true);
  }

  function removeBlock(index: number) {
    setBlocks(blocks.filter((_, i) => i !== index));
    setDirty(true);
  }

  function updateBlock(index: number, field: "from" | "to", value: string) {
    setBlocks(blocks.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
    setDirty(true);
  }

  function handleNavigateBack() {
    if (dirty) {
      const confirm = window.confirm("You have unsaved changes. Leave without saving?");
      if (!confirm) return;
    }
    navigate("/");
  }



  // Check if a block overlaps with any other block
  function hasOverlap(blockList: Block[]): string | null {
    for (let i = 0; i < blockList.length; i++) {
      const a = blockList[i];
      const [aFromH, aFromM] = a.from.split(":").map(Number);
      const [aToH, aToM] = a.to.split(":").map(Number);
      const aStart = aFromH * 60 + aFromM;
      const aEnd = aToH * 60 + aToM;

      for (let j = i + 1; j < blockList.length; j++) {
        const b = blockList[j];
        const [bFromH, bFromM] = b.from.split(":").map(Number);
        const [bToH, bToM] = b.to.split(":").map(Number);
        const bStart = bFromH * 60 + bFromM;
        const bEnd = bToH * 60 + bToM;

        if (aStart < bEnd && bStart < aEnd) {
          return `Block ${i + 1} (${a.from}-${a.to}) overlaps with Block ${j + 1} (${b.from}-${b.to})`;
        }
      }
    }
    return null;
  }

  async function save() {
    // Validate no overlapping blocks
    const overlap = hasOverlap(blocks);
    if (overlap) {
      alert("Overlap detected: " + overlap);
      return;
    }

    // Validate no 00:00 to 00:00 blocks
    const emptyBlock = blocks.find((b) => b.from === "00:00" && b.to === "00:00");
    if (emptyBlock) {
      alert("Please set a valid time for all blocks before saving.");
      return;
    }

    setSaving(true);
    try {
      let url = "";
      let payload: any = {};

      if (tab === "default") {
        url = `${API_BASE}/default-blocks`;
        payload = {
          email: userEmail,
          blocks: blocks.map((b) => ({
            ...(b.id ? { id: b.id } : {}),
            from: istToUtc(b.from),
            to: istToUtc(b.to),
          })),
        };
      } else {
        url = `${API_BASE}/overrides`;
        payload = {
          email: userEmail,
          date: overrideDate,
          blocks: blocks.map((b) => ({
            ...(b.id ? { id: b.id } : {}),
            from: istToUtc(b.from),
            to: istToUtc(b.to),
          })),
        };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        if (tab === "override") {
          const parts = [];
          if (result.inserted) parts.push(`${result.inserted} added`);
          if (result.updated) parts.push(`${result.updated} updated`);
          if (result.deleted) parts.push(`${result.deleted} removed`);
          alert(parts.length > 0 ? `Saved! (${parts.join(", ")})` : "No changes needed");
        } else {
          const parts = [];
          if (result.inserted) parts.push(`${result.inserted} added`);
          if (result.updated) parts.push(`${result.updated} updated`);
          if (result.deleted) parts.push(`${result.deleted} removed`);
          alert(parts.length > 0 ? `Saved! (${parts.join(", ")})` : "No changes needed");
        }
        setDirty(false);
        // Refetch to get updated IDs
        await fetchBlocks();
      } else {
        const err = await res.json();
        alert("Error: " + err.error);
      }
    } catch (err) {
      console.error("Failed to save:", err);
      alert("Failed to save blocks");
    } finally {
      setSaving(false);
    }
  }

  const totalHours = blocks.reduce(
    (sum, b) => sum + getHoursBetween(b.from, b.to),
    0
  );

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
          <button
            onClick={handleNavigateBack}
            className="text-[#4fc3f7] hover:text-white transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-semibold text-white">Working Hours Editor</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Tabs + Date Picker */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 p-5 mb-6 shadow-lg flex flex-wrap items-end gap-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setTab("default")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === "default"
                  ? "bg-[#4fc3f7] text-[#0f3460] shadow-md"
                  : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              Default Schedule
            </button>
            <button
              onClick={() => setTab("override")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === "override"
                  ? "bg-[#4fc3f7] text-[#0f3460] shadow-md"
                  : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              Date Override
            </button>
          </div>

          {/* Date picker for override */}
          {tab === "override" && (
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1 uppercase tracking-wide">
                Override Date
              </label>
              <input
                type="date"
                value={overrideDate}
                onChange={(e) => setOverrideDate(e.target.value)}
                className="border border-white/30 rounded-lg px-3 py-2 text-sm bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7]"
              />
            </div>
          )}
        </div>
        {/* Block Table */}
        <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden mb-6 shadow-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-[#0078d4] to-[#4fc3f7]">
                <th className="px-4 py-3 text-left font-semibold text-white">Block</th>
                <th className="px-4 py-3 text-left font-semibold text-white">From</th>
                <th className="px-4 py-3 text-left font-semibold text-white">To</th>
                <th className="px-4 py-3 text-left font-semibold text-white">Duration</th>
                <th className="px-4 py-3 text-center font-semibold text-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white/5" : "bg-white/[0.02]"}>
                  <td className="px-4 py-3 font-medium text-white/80 border-t border-white/10">Block {idx + 1}</td>
                  <td className="px-4 py-3 border-t border-white/10">
                    <input
                      type="time"
                      value={block.from}
                      onChange={(e) =>
                        updateBlock(idx, "from", e.target.value)
                      }
                      className="border border-white/30 rounded-lg px-2 py-1 bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] w-28"
                    />
                  </td>
                  <td className="px-4 py-3 border-t border-white/10">
                    <input
                      type="time"
                      value={block.to}
                      onChange={(e) =>
                        updateBlock(idx, "to", e.target.value)
                      }
                      className="border border-white/30 rounded-lg px-2 py-1 bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-[#4fc3f7] w-28"
                    />
                  </td>
                  <td className="px-4 py-3 text-[#4fc3f7] font-medium border-t border-white/10">
                    {getHoursBetween(block.from, block.to).toFixed(1)} hrs
                  </td>
                  <td className="px-4 py-3 text-center border-t border-white/10">
                    <button
                      onClick={() => removeBlock(idx)}
                      className="text-red-400 hover:text-red-300 font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <button
              onClick={addBlock}
              className="px-4 py-2 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 font-medium transition-all"
            >
              + Add Block
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-gradient-to-r from-[#4fc3f7] to-[#0078d4] text-white rounded-lg hover:from-[#81d4fa] hover:to-[#2196f3] font-medium transition-all shadow-md disabled:opacity-50"
            >
              {saving ? "Saving..." : tab === "default" ? "Save Default" : "Save Override"}
            </button>
          </div>
          <div className="text-lg font-semibold text-[#4fc3f7]">
            Total: {totalHours.toFixed(1)} hrs
          </div>
        </div>
      </div>
    </div>
  );
}
