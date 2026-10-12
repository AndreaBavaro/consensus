import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun, Sunset } from 'lucide-react';

export type Theme = 'day' | 'sunset' | 'night';
const THEMES: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: 'day', label: 'Sunshine', Icon: Sun },
  { id: 'sunset', label: 'Golden hour', Icon: Sunset },
  { id: 'night', label: 'Midnight', Icon: Moon },
];
const META_COLOR: Record<Theme, string> = { day: '#FBF7EE', sunset: '#FFF0E4', night: '#100E14' };

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'day', setTheme: () => {} });

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('cs_theme');
    if (t === 'day' || t === 'sunset' || t === 'night') return t;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
    try {
      localStorage.setItem('cs_theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Day / Sunset / Night as color swatches (used in the dock panel). */
export function ThemeSwatches() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="swatches" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} aria-label={label} data-tip={label} className={`swatch swatch-${id} ${theme === id ? 'on' : ''}`} onClick={() => setTheme(id)}>
          <span className="swatch-chip" aria-hidden="true">
            <Icon size={14} strokeWidth={2.2} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? 'on' : ''} onClick={() => setTheme(id)} data-tip={label} aria-label={label}>
          <Icon size={15} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
