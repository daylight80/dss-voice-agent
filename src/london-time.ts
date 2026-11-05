const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** Calendar date and 24-hour clock in Europe/London (GMT or BST). */
export function formatLondonDateTime(date: Date): { date: string; time: string } {
  const parts = londonParts.formatToParts(date);
  const hour = part(parts, "hour").padStart(2, "0");
  const minute = part(parts, "minute").padStart(2, "0");
  return {
    date: `${part(parts, "weekday")} ${part(parts, "day")} ${part(parts, "month")} ${part(parts, "year")}`,
    time: `${hour}:${minute}`,
  };
}

/** Day month year in Europe/London, e.g. "5 November 2026". */
export function formatLondonDay(date: Date): string {
  const parts = londonParts.formatToParts(date);
  return `${part(parts, "day")} ${part(parts, "month")} ${part(parts, "year")}`;
}

export function durationSeconds(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 1000);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts: string[] = [];
  if (hours) parts.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (minutes) parts.push(minutes === 1 ? "1 minute" : `${minutes} minutes`);
  if (seconds || parts.length === 0) parts.push(seconds === 1 ? "1 second" : `${seconds} seconds`);
  return parts.join(" ");
}
