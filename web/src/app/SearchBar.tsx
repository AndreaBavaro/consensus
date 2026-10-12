import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { RANGE_LABEL, RANGE_PRESETS, shortDate, today, ymd, type RangeKey } from './format';
import { RedditMark, XMark } from './icons';
import type { V3Source } from './api';
import { useMedia } from './useMedia';

export interface SearchInput {
  q: string;
  range: RangeKey;
  since?: string;
  until?: string;
  sources: V3Source[];
}

export function searchHref(s: SearchInput): string {
  const p = new URLSearchParams({ q: s.q.trim() });
  if (s.range !== 'any') p.set('range', s.range);
  if (s.range === 'custom') {
    if (s.since) p.set('since', s.since);
    if (s.until) p.set('until', s.until);
  }
  if (s.sources.length === 1) p.set('src', s.sources[0]!);
  return `/search?${p}`;
}

export function parseSearch(p: URLSearchParams): SearchInput {
  const range = (p.get('range') as RangeKey) || 'any';
  const src = p.get('src');
  return {
    q: p.get('q') ?? '',
    range: range in RANGE_LABEL ? range : 'any',
    since: p.get('since') ?? undefined,
    until: p.get('until') ?? undefined,
    sources: src === 'reddit' || src === 'x' ? [src] : ['reddit', 'x'],
  };
}

function Toggle({ on, onChange, label, locked, children }: { on: boolean; onChange: (v: boolean) => void; label: string; locked?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={locked || undefined}
      className={`src-toggle ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}
      onClick={() => !locked && onChange(!on)}
      data-tip={locked ? 'At least one source' : `${on ? 'Hide' : 'Include'} ${label}`}
    >
      {children}
      <span className="switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k);
    return () => (document.removeEventListener('pointerdown', h), document.removeEventListener('keydown', k));
  }, [open, close]);
  return ref;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Month grid. First click sets the start, second click sets the end (swapped if earlier). */
function RangeCalendar({ from, to, onPick }: { from: string; to: string; onPick: (from: string, to: string) => void }) {
  const max = today();
  const anchor = new Date(`${to || from || max}T12:00:00`);
  const [view, setView] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [hover, setHover] = useState('');
  const y = view.getFullYear();
  const m = view.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(y, m, i + 1)))];
  const nextDisabled = ymd(new Date(y, m + 1, 1)) > max;
  // While picking the end date, preview the span under the pointer.
  const end = to || (from && hover ? hover : '');
  const lo = from && end ? (from < end ? from : end) : from;
  const hi = from && end ? (from < end ? end : from) : from;
  const pick = (d: string) => {
    if (!from || to) onPick(d, '');
    else onPick(d < from ? d : from, d < from ? from : d);
  };
  return (
    <div className="cal" onPointerLeave={() => setHover('')}>
      <div className="cal-head">
        <button type="button" className="icon-btn small" aria-label="Previous month" onClick={() => setView(new Date(y, m - 1, 1))}>
          <ChevronLeft size={16} />
        </button>
        <span className="cal-title">{view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="icon-btn small" aria-label="Next month" disabled={nextDisabled} onClick={() => setView(new Date(y, m + 1, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((w, i) => (
          <span key={`w${i}`} className="cal-dow" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              type="button"
              key={d}
              disabled={d > max}
              aria-label={shortDate(d)}
              aria-pressed={d === lo || d === hi}
              className={`cal-day ${d === lo || d === hi ? 'edge' : ''} ${lo && hi && d > lo && d < hi ? 'in' : ''} ${d === max ? 'today' : ''}`}
              onClick={() => pick(d)}
              onPointerEnter={() => setHover(d)}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

function RangeOptions({ value, since, until, onChange }: { value: RangeKey; since?: string; until?: string; onChange: (r: RangeKey, since?: string, until?: string) => void }) {
  const [from, setFrom] = useState(value === 'custom' ? since ?? '' : '');
  const [to, setTo] = useState(value === 'custom' ? until ?? '' : '');
  const [showCal, setShowCal] = useState(value === 'custom');
  return (
    <div className="range-opts">
      <div className="range-chips" role="radiogroup" aria-label="Date range">
        {RANGE_PRESETS.map((k) => (
          <button type="button" key={k} role="radio" aria-checked={value === k && !showCal} className={`range-chip ${value === k && !showCal ? 'on' : ''}`} onClick={() => onChange(k)}>
            {RANGE_LABEL[k]}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={showCal} className={`range-chip ${showCal ? 'on' : ''}`} onClick={() => setShowCal((s) => !s)}>
          <CalendarDays size={13} />
          Custom
        </button>
      </div>
      {showCal && (
        <div className="custom-range">
          <RangeCalendar
            from={from}
            to={to}
            onPick={(a, b) => {
              setFrom(a);
              setTo(b);
            }}
          />
          <div className="cal-foot">
            <span className="cal-sel">{from ? `${shortDate(from)} – ${to ? shortDate(to) : 'pick end'}` : 'Pick a start date'}</span>
            <button type="button" className="btn primary small" disabled={!from} onClick={() => onChange('custom', from, to || undefined)}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const rangeLabel = (value: RangeKey, since?: string, until?: string) =>
  value === 'custom' && since ? `${shortDate(since)} – ${until ? shortDate(until) : 'now'}` : RANGE_LABEL[value];

export function RangeMenu({ value, since, until, onChange }: { value: RangeKey; since?: string; until?: string; onChange: (r: RangeKey, since?: string, until?: string) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="chip-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-tip={open ? undefined : 'Date range'}>
        <CalendarDays size={15} />
        <span className="chip-label">{rangeLabel(value, since, until)}</span>
        <ChevronDown size={14} className="chev" />
      </button>
      {open && (
        <div className="menu range-menu" role="menu">
          <RangeOptions
            value={value}
            since={since}
            until={until}
            onChange={(r, a, b) => {
              onChange(r, a, b);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Phones: date range and sources behind one button so the search field keeps its width. */
function FiltersMenu({ s, change }: { s: SearchInput; change: (patch: Partial<SearchInput>) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const custom = s.range !== 'any' || s.sources.length < 2;
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={`chip-btn filters-btn ${custom ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Filters">
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="menu right filters-menu" role="menu">
          <span className="menu-label">Sources</span>
          <SourceToggles sources={s.sources} onChange={(sources) => change({ sources })} />
          <div className="menu-sep" />
          <span className="menu-label">Date</span>
          <RangeOptions
            value={s.range}
            since={s.since}
            until={s.until}
            onChange={(range, since, until) => {
              change({ range, since, until });
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function SourceToggles({ sources, onChange }: { sources: V3Source[]; onChange: (s: V3Source[]) => void }) {
  const set = (src: V3Source, on: boolean) => {
    const next = on ? [...new Set([...sources, src])] : sources.filter((s) => s !== src);
    if (next.length) onChange((['reddit', 'x'] as V3Source[]).filter((s) => next.includes(s)));
  };
  return (
    <div className="src-toggles">
      <Toggle on={sources.includes('reddit')} locked={sources.length === 1 && sources[0] === 'reddit'} onChange={(v) => set('reddit', v)} label="Reddit">
        <RedditMark size={17} />
        <span className="src-name">Reddit</span>
      </Toggle>
      <Toggle on={sources.includes('x')} locked={sources.length === 1 && sources[0] === 'x'} onChange={(v) => set('x', v)} label="X">
        <XMark size={14} />
      </Toggle>
    </div>
  );
}

export function SearchBar({ initial, onSubmit, variant, autoFocus }: { initial: SearchInput; onSubmit: (s: SearchInput) => void; variant: 'hero' | 'header'; autoFocus?: boolean }) {
  const [s, setS] = useState<SearchInput>(initial);
  const narrow = useMedia('(max-width: 600px)');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setS(initial), [initial.q, initial.range, initial.since, initial.until, initial.sources.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = (e?: FormEvent, next = s) => {
    e?.preventDefault();
    if (next.q.trim()) onSubmit({ ...next, q: next.q.trim() });
    else inputRef.current?.focus();
  };
  // In the header, changing a filter re-runs the current question at once.
  const change = (patch: Partial<SearchInput>) => {
    const next = { ...s, ...patch };
    setS(next);
    if (variant === 'header' && next.q.trim()) submit(undefined, next);
  };

  return (
    <form className={`searchbar ${variant}`} onSubmit={submit} role="search">
      <label className="search-field">
        <Search size={variant === 'hero' ? 20 : 16} className="search-icon" />
        <input
          ref={inputRef}
          value={s.q}
          onChange={(e) => setS({ ...s, q: e.target.value })}
          placeholder={variant === 'hero' ? (narrow ? 'Ask what people think' : 'Ask what people think about anything') : 'Ask another question'}
          aria-label="Question"
          maxLength={300}
          enterKeyHint="search"
        />
        {variant === 'hero' && (
          <button className="go-btn" type="submit" aria-label="Search" data-tip="Search" disabled={!s.q.trim()}>
            <ArrowRight size={20} />
          </button>
        )}
      </label>
      <div className="search-filters">
        {variant === 'header' && narrow ? (
          <FiltersMenu s={s} change={change} />
        ) : (
          <>
            <RangeMenu value={s.range} since={s.since} until={s.until} onChange={(range, since, until) => change({ range, since, until })} />
            <SourceToggles sources={s.sources} onChange={(sources) => change({ sources })} />
          </>
        )}
      </div>
    </form>
  );
}
