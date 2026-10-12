// Date range choices shared by the reports

export type RangePreset = "yesterday" | "dayBefore" | "last7" | "lastWeek" | "custom";

export const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "yesterday", label: "Yesterday" },
  { key: "dayBefore", label: "Day before yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "lastWeek", label: "Last week" },
  { key: "custom", label: "Custom" },
];

// YYYY-MM-DD in local time (toISOString would shift the day for IST)
export function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// Start/end dates for a preset; "last7" ends yesterday, "lastWeek" is the previous Sunday–Saturday
export function presetRange(preset: Exclude<RangePreset, "custom">): [string, string] {
  switch (preset) {
    case "yesterday":
      return [toDateStr(daysAgo(1)), toDateStr(daysAgo(1))];
    case "dayBefore":
      return [toDateStr(daysAgo(2)), toDateStr(daysAgo(2))];
    case "last7":
      return [toDateStr(daysAgo(7)), toDateStr(daysAgo(1))];
    case "lastWeek": {
      const lastSaturday = daysAgo(new Date().getDay() + 1);
      const lastSunday = new Date(lastSaturday);
      lastSunday.setDate(lastSaturday.getDate() - 6);
      return [toDateStr(lastSunday), toDateStr(lastSaturday)];
    }
  }
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
