import { useState, useEffect } from "react";
import type { FilterOption } from "./FilterHeader";

export const REPORT_PAGE_SIZE = 50;

export interface ReportResponse {
  rows: any[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalMinutes: number;
  projectTotals: { project_name: string; minutes: number }[];
  options: {
    projects: FilterOption<number>[];
    tasks: FilterOption<number>[];
    stages: FilterOption<string>[];
  };
}

const EMPTY: ReportResponse = {
  rows: [],
  page: 1,
  pageSize: REPORT_PAGE_SIZE,
  totalRows: 0,
  totalMinutes: 0,
  projectTotals: [],
  options: { projects: [], tasks: [], stages: [] },
};

// Fetches one page of a report. Params with null/empty values are left out of the query.
export function useReport(url: string, params: Record<string, string | number | null>) {
  const [data, setData] = useState<ReportResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const query = new URLSearchParams(
    Object.entries({ ...params, pageSize: REPORT_PAGE_SIZE })
      .filter(([, v]) => v !== null && String(v) !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();

  useEffect(() => {
    let stale = false; // ignore responses that arrive after a newer request started
    setLoading(true);
    fetch(`${url}?${query}`)
      .then((r) => r.json())
      .then((json) => {
        if (stale) return;
        if (Array.isArray(json?.rows)) setData(json);
        else {
          console.error("Report failed:", json);
          setData(EMPTY);
        }
      })
      .catch((err) => {
        if (!stale) {
          console.error("Failed to fetch report:", err);
          setData(EMPTY);
        }
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [url, query]);

  return { data, loading };
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hrs${m > 0 ? ` ${m} mins` : ""}`;
}
