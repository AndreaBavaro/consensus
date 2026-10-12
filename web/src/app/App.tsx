import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Copy, Download, Link2, MessageCircle, Share, X as Close } from 'lucide-react';
import { faLinkedin, faXTwitter } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { apiMode, type SearchParams } from './api';
import { AccountDock, AuthProvider } from './auth';
import { download, headline, num, optionColor, slug, sinceFor, toCsv } from './format';
import { LogoMark } from './icons';
import { FeaturedFeed } from './Featured';
import { Results } from './Results';
import { SponsorStrip } from './Sponsor';
import { parseSearch, SearchBar, searchHref, type SearchInput } from './SearchBar';
import { ThemeProvider } from './theme';
import { useSearch, type SearchState } from './useSearch';
import './app.css';

function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Consensus home">
      <LogoMark className="wordmark-logo" size={24} />
      <span className="wordmark-full">Consensus</span>
    </Link>
  );
}

function MockBadge() {
  if (apiMode() !== 'mock') return null;
  return (
    <span className="mock-badge" data-tip="Recorded demo data. Add ?mock=0 to go live.">
      Demo data
    </span>
  );
}

function Landing() {
  const nav = useNavigate();
  const initial = useMemo<SearchInput>(() => ({ q: '', range: 'any', sources: ['reddit', 'x'] }), []);
  return (
    <div className="landing">
      <header className="topbar landing-top">
        <span />
        <span className="top-actions">
          <MockBadge />
          <AccountDock />
        </span>
      </header>
      <main className="landing-main">
        <div className="landing-hero">
          <h1 className="landing-mark">
            <LogoMark className="landing-logo" size={58} />
            Consensus
          </h1>
          <SearchBar variant="hero" initial={initial} onSubmit={(s) => nav(searchHref(s))} autoFocus />
          <div className="landing-art" aria-hidden="true" />
        </div>
        <FeaturedFeed />
      </main>
    </div>
  );
}

function exportCsv(state: SearchState) {
  const titles = Object.fromEntries((state.poll?.options ?? []).map((o) => [o.id, o.title]));
  const rows = [['answer', 'source', 'author', 'community', 'text', 'score', 'replies', 'intent', 'url', 'created_at']];
  for (const p of Object.values(state.posts))
    rows.push([p.option ? titles[p.option] ?? p.option : '', p.source, p.author.handle, p.community ?? '', p.text, String(p.score), String(p.replies ?? 0), p.intent ?? '', p.url, p.created_at ?? '']);
  download(`${slug(state.meta?.query ?? 'consensus')}.csv`, toCsv(rows));
}

function SharePanel({ id, state, onClose }: { id: string; state: SearchState; onClose: () => void }) {
  const url = `${location.origin}/search?id=${encodeURIComponent(id)}${state.meta?.query ? `&q=${encodeURIComponent(state.meta.query)}` : ''}`;
  const title = headline(state.meta?.query ?? '');
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const down = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
      clearTimeout(t.current);
    };
  }, [onClose]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked; the field is still selectable */
    }
    setCopied(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setCopied(false), 1600);
  };
  const text = `What people think: ${title}`;
  const opts = (state.poll?.options ?? []).filter((o) => o.count > 0);
  return (
    <div className="share-pop" role="dialog" aria-label="Share this poll" ref={ref}>
      <div className="share-head">
        <strong>Share this poll</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close" data-tip="Close">
          <Close size={15} />
        </button>
      </div>
      <div className="share-link">
        <Link2 size={14} className="share-link-ic" />
        <input readOnly value={url.replace(/^https?:\/\//, '')} onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
        <button className="btn primary share-copy" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <div className="share-row">
        <span className="muted">Anyone with the link can see it</span>
        <span className="share-nets">
          <a className="icon-btn" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X" data-tip="Post on X">
            <FontAwesomeIcon icon={faXTwitter} style={{ width: 15, height: 15 }} />
          </a>
          <a className="icon-btn" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn" data-tip="LinkedIn">
            <FontAwesomeIcon icon={faLinkedin} style={{ width: 16, height: 16, color: '#0A66C2' }} />
          </a>
          <a className="icon-btn" href={`sms:&body=${encodeURIComponent(`${text} ${url}`)}`} aria-label="Send as a text message" data-tip="Message">
            <MessageCircle size={16} style={{ color: '#34C759' }} />
          </a>
        </span>
      </div>
      <div className="share-card" aria-hidden="true">
        <span className="share-card-brand">
          <LogoMark size={14} /> Consensus
        </span>
        <span className="share-card-title">{title}</span>
        <span className="share-card-bar">
          {opts.map((o) => (
            <span key={o.id} style={{ width: `${o.percent}%`, background: optionColor(o.is_other ? 'other' : o.id) }} />
          ))}
        </span>
        <span className="share-card-foot">{num(state.poll?.total_opinions ?? 0)} opinions · useconsensus.io</span>
      </div>
    </div>
  );
}

function ShareButton({ id, state }: { id: string | undefined; state: SearchState }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="share-wrap">
      <button className={`chip-btn share-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} disabled={!id} aria-haspopup="dialog" aria-expanded={open}>
        <Share size={14} />
        <span>Share</span>
      </button>
      {open && id && <SharePanel id={id} state={state} onClose={close} />}
    </div>
  );
}

function SearchPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const input = parseSearch(sp);
  const id = sp.get('id') ?? undefined;
  const params = useMemo<SearchParams | null>(() => {
    if (id) return { id, sources: ['reddit', 'x'] };
    if (!input.q.trim()) return null;
    const since = input.range === 'custom' ? input.since : sinceFor(input.range);
    return { query: input.q.trim(), since, until: input.range === 'custom' ? input.until : undefined, sources: input.sources };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, input.q, input.range, input.since, input.until, input.sources.join()]);
  const { state, retry } = useSearch(params);

  useEffect(() => {
    if (!params) nav('/', { replace: true });
  }, [params, nav]);

  // A saved id that is gone (failed or never cached) falls back to a fresh run of the same question.
  useEffect(() => {
    if (id && state.phase === 'error' && state.error?.code === 'not_found' && input.q.trim()) nav(searchHref(input), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state.phase, state.error?.code, input.q]);

  const q = (id && input.q.trim()) || state.meta?.query || input.q;
  useEffect(() => {
    document.title = q ? `${headline(q)} · Consensus` : 'Consensus';
    return () => {
      document.title = 'Consensus';
    };
  }, [q]);

  // Shared links open with the saved question in the bar.
  const barInitial = useMemo<SearchInput>(() => {
    if (!id || !state.meta) return input;
    const m = state.meta;
    return { q: m.query, range: m.since ? 'custom' : 'any', since: m.since ?? undefined, until: m.until ?? undefined, sources: m.sources };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state.meta, input.q, input.range, input.since, input.until, input.sources.join()]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <Wordmark />
          <SearchBar variant="header" initial={barInitial} onSubmit={(s) => nav(searchHref(s))} />
          <span className="top-actions">
            <MockBadge />
            <AccountDock />
          </span>
        </div>
      </header>
      <main>
        {params && (
          <Results
            key={JSON.stringify(params)}
            state={state}
            query={q}
            retry={retry}
            tools={
              <>
                <ShareButton id={state.done ? state.meta?.id : undefined} state={state} />
                <button className="icon-btn tool" onClick={() => exportCsv(state)} disabled={!state.done} data-tip="Download CSV" aria-label="Export CSV">
                  <Download size={16} />
                </button>
              </>
            }
            onWiden={input.range !== 'any' && !id ? () => nav(searchHref({ ...input, range: 'any' })) : undefined}
          />
        )}
      </main>
    </div>
  );
}

function ScrollTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);
  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <SponsorStrip />
          <ScrollTop />
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
