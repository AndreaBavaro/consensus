import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { num, optionColor } from './format';
import { prefetchSaved } from './api';

export interface FeaturedPoll {
  id: string;
  query?: string;
  category: string;
  title: string;
  total: number;
  by_source: { reddit: number; x: number };
  logo?: string;
  options: { id: string; title: string; percent: number; count: number; is_other: boolean; logo?: string }[];
}

const FIRST = 6;

// Fetched once per page load, so coming back to the landing page renders the list at once.
let cache: FeaturedPoll[] | null = null;
let pending: Promise<FeaturedPoll[]> | null = null;
function loadFeatured(): Promise<FeaturedPoll[]> {
  pending ??= fetch('/featured.json')
    .then((r) => (r.ok ? r.json() : { polls: [] }))
    .then((j) => (cache = (j.polls ?? []) as FeaturedPoll[]))
    .catch(() => (cache = []));
  return pending;
}

function useFeatured(): FeaturedPoll[] | null {
  const [polls, setPolls] = useState<FeaturedPoll[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    let live = true;
    loadFeatured().then((p) => live && setPolls(p));
    return () => {
      live = false;
    };
  }, []);
  return polls;
}

/** One poll per category first, so the first screen shows range rather than six AI questions. */
function spread(polls: FeaturedPoll[]): FeaturedPoll[] {
  const seen = new Set<string>();
  const first: FeaturedPoll[] = [];
  const rest: FeaturedPoll[] = [];
  for (const p of polls) (seen.has(p.category) ? rest : (seen.add(p.category), first)).push(p);
  return [...first, ...rest];
}

// q carries the clean title: shown as the heading and used for a live re-run if the saved result is gone.
const href = (p: FeaturedPoll) => `/search?id=${encodeURIComponent(p.id)}&q=${encodeURIComponent(p.title)}`;
const colorOf = (o: { id: string; is_other: boolean }) => optionColor(o.is_other ? 'other' : o.id);
// A second click on a card just after the first would push the same search onto history again.
let lastOpen = 0;
const once = (e: React.MouseEvent) => {
  if (Date.now() - lastOpen < 1000) e.preventDefault();
  else lastOpen = Date.now();
};

const pct = (v: number) => (v < 1 ? '<1' : String(Math.round(v)));

function Row({ p }: { p: FeaturedPoll }) {
  const lead = p.options.find((o) => !o.is_other) ?? p.options[0]!;
  return (
    <li>
      <Link to={href(p)} className="ex" onClick={once} onPointerEnter={() => prefetchSaved(p.id)} onTouchStart={() => prefetchSaved(p.id)} onFocus={() => prefetchSaved(p.id)}>
        <span className="ex-title">{p.title}</span>
        <span className="ex-bar" aria-hidden="true">
          {p.options
            .filter((o) => o.percent > 0)
            .map((o) => (
              <span key={o.id} style={{ flexGrow: o.percent, background: colorOf(o) }} />
            ))}
        </span>
        <span className="ex-meta">
          <span className="ex-lead" style={{ ['--c' as string]: colorOf(lead) }}>
            <b>{pct(lead.percent)}%</b>
            <span>{lead.title}</span>
          </span>
          <span className="ex-n">{num(p.total)} opinions</span>
        </span>
      </Link>
    </li>
  );
}

export function FeaturedFeed() {
  const polls = useFeatured();
  const [all, setAll] = useState(false);
  if (polls && !polls.length) return null;
  const list = polls ? spread(polls) : [];
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <section className="examples" aria-label="Recent polls">
      <div className="examples-in">
        <h2 className="examples-h">Recent polls</h2>
        {/* Reserved height while the list loads, so nothing below it moves. */}
        <ul className={`ex-list ${polls ? '' : 'loading'}`}>
          {shown.map((p) => (
            <Row key={p.id} p={p} />
          ))}
        </ul>
        {list.length > FIRST && !all && (
          <button type="button" className="btn ex-more" onClick={() => setAll(true)}>
            Show all {list.length} <ChevronDown size={15} />
          </button>
        )}
      </div>
    </section>
  );
}
