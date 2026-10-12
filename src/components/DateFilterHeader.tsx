import { useState } from "react";
import { PRESETS, presetRange, type RangePreset } from "./dateRanges";

export interface DateRange {
  preset: RangePreset;
  start: string;
  end: string;
}

// Table header cell whose dropdown narrows the column to a date range.
// null means all dates. The page closes it on outside click by checking for [data-dropdown].
export default function DateFilterHeader({
  value,
  onChange,
  open,
  onToggle,
}: {
  value: DateRange | null;
  onChange: (value: DateRange | null) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [customStart, setCustomStart] = useState(value?.start || "");
  const [customEnd, setCustomEnd] = useState(value?.end || "");
  const [showCustom, setShowCustom] = useState(value?.preset === "custom");

  const item = (active: boolean) =>
    `w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${
      active ? "text-[#4fc3f7] bg-white/5" : "text-white/90"
    }`;
  const dateInput =
    "w-full border border-white/20 rounded-lg px-2 py-1 text-xs bg-white/10 text-white focus:outline-none focus:ring-1 focus:ring-[#4fc3f7]";

  return (
    <th className="text-left font-semibold text-white relative p-0 min-w-[110px]">
      <button
        type="button"
        data-dropdown
        onClick={onToggle}
        className="w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
      >
        Date
        {value !== null && (
          <span className="bg-white/25 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">1</span>
        )}
        <span className="text-white/60 text-xs">▾</span>
      </button>
      {open && (
        <div
          data-dropdown
          className="absolute top-full left-2 mt-1 min-w-[220px] bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-1 z-50"
        >
          <button
            type="button"
            onClick={() => {
              setShowCustom(false);
              onChange(null);
            }}
            className={item(value === null) + " border-b border-white/10"}
          >
            All dates
          </button>
          {PRESETS.map((p) =>
            p.key === "custom" ? (
              <button
                key={p.key}
                type="button"
                onClick={() => setShowCustom(true)}
                className={item(value?.preset === "custom")}
              >
                Custom…
              </button>
            ) : (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  const [start, end] = presetRange(p.key as Exclude<RangePreset, "custom">);
                  setShowCustom(false);
                  onChange({ preset: p.key, start, end });
                }}
                className={item(value?.preset === p.key)}
              >
                {p.label}
              </button>
            )
          )}
          {showCustom && (
            <div className="px-3 py-2 border-t border-white/10 space-y-2">
              <input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
                className={dateInput}
              />
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
                className={dateInput}
              />
              <button
                type="button"
                disabled={!customStart || !customEnd}
                onClick={() => onChange({ preset: "custom", start: customStart, end: customEnd })}
                className="w-full px-2 py-1 rounded-lg text-xs font-medium bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50 disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </th>
  );
}
