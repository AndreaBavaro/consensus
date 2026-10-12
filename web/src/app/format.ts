import type { Intent, Post } from './api';

export const OPTION_COLORS = ['#2F6BFF', '#FF4FA0', '#FFC31F', '#18B27A', '#FF7A30', '#8B5CF6', '#14B8C4', '#C2410C'];
export const OTHER_COLOR = '#A8A29E';

export function optionColor(id: string | null | undefined): string {
  if (!id || id === 'other') return OTHER_COLOR;
  const n = parseInt(id.replace(/\D/g, ''), 10) || 0;
  return OPTION_COLORS[n % OPTION_COLORS.length]!;
}

export const INTENT_ORDER: Intent[] = ['switching', 'looking', 'frustrated', 'just_bought'];
export const INTENT_META: Record<Intent, { label: string; color: string }> = {
  switching: { label: 'Switching', color: '#FFC31F' },
  looking: { label: 'Looking', color: '#2F6BFF' },
  frustrated: { label: 'Frustrated', color: '#FF4FA0' },
  just_bought: { label: 'Just bought', color: '#18B27A' },
};

export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

export function compact(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export const num = (n: number) => n.toLocaleString('en-US');

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86_400 * 14) return `${Math.round(s / 86_400)}d ago`;
  if (s < 86_400 * 60) return `${Math.round(s / (86_400 * 7))}w ago`;
  if (s < 86_400 * 365) return `${Math.round(s / (86_400 * 30))}mo ago`;
  return `${Math.round(s / (86_400 * 365))}y ago`;
}

const QUESTION_START = /^(is|are|do|does|did|should|would|could|can|will|what|which|who|why|how|where|when|was|were|has|have)\b/i;

/** "is hubspot worth it" -> "Is hubspot worth it?" */
export function headline(q: string): string {
  const t = q.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const cased = t[0]!.toUpperCase() + t.slice(1);
  return /[?!.]$/.test(cased) || !QUESTION_START.test(cased) ? cased : `${cased}?`;
}

export const authorLabel = (p: Post) => (p.source === 'reddit' ? `u/${p.author.handle}` : p.author.name || `@${p.author.handle}`);

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'consensus';

export type RangeKey = 'any' | '24h' | 'week' | 'month' | '3m' | 'year' | 'custom';
export const RANGE_LABEL: Record<RangeKey, string> = {
  any: 'All time',
  '24h': 'Past 24 hours',
  week: 'Past week',
  month: 'Past month',
  '3m': 'Past 3 months',
  year: 'Past year',
  custom: 'Custom range',
};
/** Preset chips shown in the date picker, in display order. */
export const RANGE_PRESETS: RangeKey[] = ['week', 'month', '3m', 'year', 'any'];

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function sinceFor(range: RangeKey): string | undefined {
  const d = new Date();
  if (range === '24h') d.setDate(d.getDate() - 1);
  else if (range === 'week') d.setDate(d.getDate() - 7);
  else if (range === 'month') d.setMonth(d.getMonth() - 1);
  else if (range === '3m') d.setMonth(d.getMonth() - 3);
  else if (range === 'year') d.setFullYear(d.getFullYear() - 1);
  else return undefined;
  return ymd(d);
}
export const today = () => ymd(new Date());

export function shortDate(s: string): string {
  return new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
