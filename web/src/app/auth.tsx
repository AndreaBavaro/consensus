import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { History, Loader2, LogOut, Settings2, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  authErrorMessage,
  authReady,
  deleteHistory,
  fetchHistory,
  fetchMe,
  onAuth,
  signInWithGoogle,
  signOut,
  type ConsensusUser,
  type HistoryEntry,
} from '../lib/consensusAuth';
import { timeAgo } from './format';
import { ThemeSwatches } from './theme';

interface AuthCtx {
  user: ConsensusUser | null;
  loading: boolean;
  freeLeft: number | null;
  refreshMe: () => void;
  /** True while the Google popup is open. */
  signingIn: boolean;
  /** Last sign-in error (empty when none). */
  authError: string;
  /** Opens the Google popup; resolves true once signed in (cookie synced), false if closed or failed. */
  requireSignIn: () => Promise<boolean>;
}
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ConsensusUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const inFlight = useRef<Promise<boolean> | null>(null);

  const refreshMe = useCallback(() => {
    fetchMe()
      .then((m) => setFreeLeft(m.user ? null : m.free_searches_left))
      .catch(() => {});
  }, []);

  useEffect(
    () =>
      onAuth((u) => {
        setUser(u);
        setLoading(false);
        refreshMe();
      }),
    [refreshMe],
  );

  // Same as Straitly: Google is the only sign-in. Must be called from a click so the popup isn't blocked.
  const requireSignIn = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setSigningIn(true);
    setAuthError('');
    const p = signInWithGoogle()
      .then(() => authReady())
      .then(() => true)
      .catch((e) => {
        const code = (e as { code?: string })?.code ?? '';
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setAuthError(authErrorMessage(e));
        return false;
      })
      .finally(() => {
        setSigningIn(false);
        inFlight.current = null;
      });
    inFlight.current = p;
    return p;
  }, []);

  return <Ctx.Provider value={{ user, loading, freeLeft, refreshMe, signingIn, authError, requireSignIn }}>{children}</Ctx.Provider>;
}

export function GoogleMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** "Continue with Google" button. Runs onDone after a successful sign-in. */
export function GoogleButton({ onDone, label = 'Continue with Google', className = 'btn google-btn' }: { onDone?: () => void; label?: string; className?: string }) {
  const { requireSignIn, signingIn } = useAuth();
  return (
    <button className={className} disabled={signingIn} onClick={() => void requireSignIn().then((ok) => ok && onDone?.())}>
      {signingIn ? <Loader2 className="spin" size={17} /> : <GoogleMark />} {label}
    </button>
  );
}

function RecentSearches({ onPick }: { onPick: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchHistory()
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="dock-section">
      <span className="menu-label">
        <History size={13} /> Recent searches
      </span>
      <div className="history">
        {history === null ? (
          <p className="history-empty" aria-busy="true">
             
          </p>
        ) : history.length === 0 ? (
          <p className="history-empty">Nothing yet.</p>
        ) : (
          history.slice(0, 15).map((h) => (
            <div className="history-item" key={h.id}>
              <Link to={`/search?id=${encodeURIComponent(h.id)}&q=${encodeURIComponent(h.query)}`} onClick={onPick}>
                <span>{h.query}</span>
                <small>{timeAgo(h.at)}</small>
              </Link>
              <button
                className="icon-btn small"
                aria-label={`Remove ${h.query}`}
                data-tip="Remove"
                onClick={() => {
                  setHistory((l) => (l ?? []).filter((x) => x.id !== h.id));
                  void deleteHistory(h.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Account, theme and recent searches: a round button at the right end of the top bar with a dropdown panel. */
export function AccountDock() {
  const { user, loading, requireSignIn, signingIn, authError } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('pointerdown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);

  const initial = user ? (user.name || user.email || '?').trim()[0]!.toUpperCase() : '';
  return (
    <div className={`dock ${open ? 'open' : ''}`} ref={ref}>
      {open && (
        <div className="dock-panel" role="dialog" aria-label={user ? 'Account' : 'Settings'}>
          <div className="dock-head">
            {user ? (
              <div className="account-id">
                <strong>{user.name || 'Signed in'}</strong>
                <span>{user.email}</span>
              </div>
            ) : (
              <strong className="dock-title">Settings</strong>
            )}
            <button className="icon-btn small" onClick={() => setOpen(false)} aria-label="Close">
              <X size={15} />
            </button>
          </div>
          {user && <RecentSearches onPick={() => setOpen(false)} />}
          <div className="dock-section">
            <span className="menu-label">Theme</span>
            <ThemeSwatches />
          </div>
          <div className="dock-section dock-foot">
            {user ? (
              <button
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
              >
                <LogOut size={15} /> Sign out
              </button>
            ) : (
              <>
                <button className="btn google-btn wide" disabled={signingIn} onClick={() => void requireSignIn().then((ok) => ok && setOpen(false))}>
                  {signingIn ? <Loader2 className="spin" size={17} /> : <GoogleMark />} Sign in with Google
                </button>
                {authError && (
                  <p className="form-error" role="alert">
                    {authError}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <button className={`dock-btn ${loading ? 'sk' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={user ? 'Account and settings' : 'Settings'} aria-expanded={open} data-tip={open ? undefined : user ? 'Account' : 'Settings'}>
        {loading ? null : user ? user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span> : <Settings2 size={19} />}
      </button>
    </div>
  );
}
