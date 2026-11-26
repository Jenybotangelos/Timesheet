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

type ReportParams = Record<string, string | number | null>;

// Query string for a report request. Params with null/empty values are left out.
function reportQuery(params: ReportParams): string {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== null && String(v) !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();
}

// Largest page the server will return (it caps pageSize at 200)
const EXPORT_PAGE_SIZE = 200;

// Fetches every row matching the filters by walking through all pages (used for exports)
export async function fetchAllReportRows(url: string, params: ReportParams): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}?${reportQuery({ ...params, page, pageSize: EXPORT_PAGE_SIZE })}`);
    const json = await res.json();
    if (!res.ok || !Array.isArray(json?.rows)) {
      throw new Error(json?.error || `Report request failed (${res.status})`);
    }
    all.push(...json.rows);
    if (json.rows.length === 0 || all.length >= json.totalRows) return all;
  }
}

// Fetches one page of a report. Params with null/empty values are left out of the query.
export function useReport(url: string, params: ReportParams) {
  const [data, setData] = useState<ReportResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const query = reportQuery({ ...params, pageSize: REPORT_PAGE_SIZE });

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
