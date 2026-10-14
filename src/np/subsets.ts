/** Research-profile poll extras: the first-hand North American subset and per-option recency. */
import type { PostTags } from "../v3/types.ts";

const RECENT_MS = 730 * 86_400_000; // 24 months
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export function researchStats(posts: { option: string | null; tags?: PostTags; created_at: string | null }[], optionIds: string[], nowMs: number) {
  const opinions = posts.filter((p) => p.option);
  const na = opinions.filter((p) => p.tags?.firsthand === "S" && (p.tags.origin === "CA" || p.tags.origin === "US"));
  const recent_share: Record<string, number> = {};
  for (const id of optionIds) {
    const mine = opinions.filter((p) => p.option === id);
    const fresh = mine.filter((p) => p.created_at && nowMs - Date.parse(p.created_at) <= RECENT_MS).length;
    recent_share[id] = mine.length ? Math.round((fresh / mine.length) * 1000) / 1000 : 0;
  }
  return {
    subsets: {
      first_hand_na: {
        total: na.length,
        options: optionIds.map((id) => {
          const count = na.filter((p) => p.option === id).length;
          return { id, count, percent: pct(count, na.length) };
        }),
      },
    },
    recent_share,
  };
}
