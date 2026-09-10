/**
 * The app shell.
 *
 * Screens land here as they are built. The token proof stays reachable at
 * /tokens — it is not a screen anyone uses, but it is the fastest way to see
 * every token rendered side by side when one of them looks wrong.
 */

import { useEffect, useState } from 'react';
import { applyTheme, resolvedTheme, storedTheme, type Theme } from './theme';
import { useRoute, navigate, routeFrom } from './router';
import { Capture } from './screens/Capture';
import { Shelf } from './screens/Shelf';
import { Settings } from './screens/Settings';
import { ItemDetail } from './screens/ItemDetail';
import { TokenProof } from './components/TokenProof';
import { startOutbox } from './sync/outbox';
import { startSync } from './sync/pull';

function Placeholder({ what }: { what: string }) {
  return (
    <div className="empty">
      <strong>{what} is not built yet.</strong>
      <span>It lands later in P2.</span>
      <a href="/" style={{ color: 'var(--signal)' }}>Back</a>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    // Push what is queued and pull what changed: on open, on focus, when the
    // network returns, and every five minutes while the app is in front.
    // Spec: 03-ARCHITECTURE.md §6.2
    const stopOutbox = startOutbox();
    const stopSync = startSync();
    return () => { stopOutbox(); stopSync(); };
  }, []);

  const cycle = () => {
    const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    setTheme(next);
    applyTheme(next);
  };

  const showTokens = location.pathname.replace(/\/+$/, '') === '/tokens';

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Stash</a>
        </h1>
        <nav className="topbar__nav">
          <a className="icon-button" href="/add">Add</a>
          <a className="icon-button" href="/settings" aria-label="Settings">Settings</a>
          <button type="button" className="icon-button" onClick={cycle}
                  aria-label={`Theme: ${theme}. Change it.`}>
            {theme === 'system' ? `auto · ${resolvedTheme(theme)}` : theme}
          </button>
        </nav>
      </header>

      <main className="main">
        {showTokens ? <TokenProof />
          : route.name === 'capture'
            ? <Capture shared={route.shared} onDone={() => { /* stays on the done state */ }} />
          : route.name === 'item' ? <ItemDetail id={route.id} />
          : route.name === 'settings' ? <Settings />
          : <Shelf onOpen={(id) => navigate(`/item/${id}`)} />}
      </main>
    </div>
  );
}

export { routeFrom, navigate };
