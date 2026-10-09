// Asks before removing a stage that employees have already logged time against.
// The server keeps those timesheet entries; they just lose their stage.
export function confirmStageRemoval(
  taskName: string,
  stage: string,
  bucket: { loggedMinutes?: number; loggedBy?: string[] } | undefined
): boolean {
  const minutes = bucket?.loggedMinutes || 0;
  if (minutes <= 0) return true;

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = m ? `${h}h ${m}m` : `${h} hour${h === 1 ? "" : "s"}`;
  const people = bucket?.loggedBy || [];
  const by = people.length
    ? ` by ${people.length} employee${people.length === 1 ? "" : "s"} (${people.join(", ")})`
    : "";

  return confirm(
    `⚠️ Remove stage "${stage}" from "${taskName}"?\n\n` +
      `${hours} logged against this stage${by}.\n\n` +
      `These hours will stay in timesheets and reports, but without a stage.\n\n` +
      `The stage's dates, priority, expected hours, assignees and acceptance criteria will be deleted, ` +
      `and its comments and attachments will no longer be visible.`
  );
}
