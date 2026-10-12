export interface FilterOption<T extends string | number> {
  value: T;
  label: string;
}

// Table header cell with a dropdown that filters the column to a single value.
// The page closes it on outside click by checking for [data-dropdown].
export default function FilterHeader<T extends string | number>({
  label,
  options,
  value,
  onChange,
  open,
  onToggle,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <th className="text-left font-semibold text-white relative p-0 min-w-[120px]">
      <button
        type="button"
        data-dropdown
        onClick={onToggle}
        className="w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
      >
        {label}
        {value !== null && (
          <span className="bg-white/25 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">1</span>
        )}
        <span className="text-white/60 text-xs">▾</span>
      </button>
      {open && (
        <div
          data-dropdown
          className="absolute top-full left-2 mt-1 min-w-[200px] bg-[#1e293b] border border-white/20 rounded-xl shadow-2xl py-1 max-h-56 overflow-y-auto z-50"
        >
          {value !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-[#4fc3f7] hover:bg-white/10 border-b border-white/10"
            >
              Clear filter
            </button>
          )}
          {options.length === 0 && <p className="px-3 py-1.5 text-xs text-white/40">No options</p>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${
                value === o.value ? "text-[#4fc3f7] bg-white/5" : "text-white/90"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </th>
  );
}
