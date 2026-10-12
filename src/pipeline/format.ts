import type { Comment } from "../lib/types.ts";

const SEPARATOR = "─".repeat(50);

function formatTimestamp(epoch: number | null): string | null {
  if (!epoch) return null;
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatCommentsForPrompt(comments: Comment[], withTimestamp = false): string {
  return comments
    .map((c, i) => {
      const ts = withTimestamp ? `\nTimestamp: ${formatTimestamp(c.created_utc)}` : "";
      return `\n ================================ Comment index : [${i}] \nComment Content: ${c.content}${ts}\n${SEPARATOR}  ====================================`;
    })
    .join("\n\n");
}

export function relativeTime(epoch: number): string {
  const diffMs = Date.now() - epoch * 1000;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) {
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours === 0) {
      const minutes = Math.floor(diffMs / 60_000);
      if (minutes === 0) return "just now";
      return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
    }
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "a week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
