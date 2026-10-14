import type { V3Event } from "../src/v3/types.ts";

/**
 * Parses a complete server-sent-events body (the `/api/v3/search` stream) into events.
 * Handles `event:` + `data:` pairs separated by blank lines and skips `: ping` comments.
 */
export function parseSse(text: string): V3Event[] {
  const events: V3Event[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!event || !data.length) continue;
    try {
      events.push({ event: event as V3Event["event"], data: JSON.parse(data.join("\n")) });
    } catch {
      // A malformed frame should not sink the whole result.
    }
  }
  return events;
}
