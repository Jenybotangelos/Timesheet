// "Showing 51–100 of 721 rows" with Prev / Next controls under a report table
export default function Pagination({
  page,
  pageSize,
  totalRows,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}) {
  if (totalRows === 0) return null;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalRows);
  const button =
    "px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-30 disabled:hover:bg-white/10";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
      <span className="text-white/50 text-xs sm:text-sm">
        Showing {first}–{last} of {totalRows} rows
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={button} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ← Prev
        </button>
        <span className="text-white/70 text-xs sm:text-sm whitespace-nowrap">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className={button}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
