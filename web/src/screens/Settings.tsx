/**
 * Settings.
 *
 * Spec: 01-PRD.md F12 · 02-TRD.md §8 · 04-DESIGN-SYSTEM.md §8 · 05-ROADMAP.md P2 task 17
 *
 * Three things live here and nothing else: where the server is, which theme,
 * and getting your data out.
 *
 * Saving the address and token also tests them. A token typed with a missing
 * character is otherwise indistinguishable from a working one until saves
 * quietly stop arriving — and because a save succeeds locally either way,
 * nothing on the shelf would ever look wrong.
 */

import { useEffect, useState } from 'react';
import { api, loadSettings, saveSettings, NotConfigured } from '../api/client';
import { flushOutbox } from '../sync/outbox';
import { applyTheme, resolvedTheme, storedTheme, type Theme } from '../theme';
import { db } from '../db/db';
import { pendingCount } from '../db/local';
import './Settings.css';

type Check =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'connected'; items: number }
  | { kind: 'refused'; message: string };

export function Settings() {
  const initial = loadSettings();
  const [apiBase, setApiBase] = useState(initial.apiBase);
  const [deviceToken, setDeviceToken] = useState(initial.deviceToken);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [waiting, setWaiting] = useState(0);

  useEffect(() => { void pendingCount().then(setWaiting); }, [check]);

  async function saveAndTest() {
    saveSettings({ apiBase, deviceToken });
    setCheck({ kind: 'testing' });

    try {
      // The smallest possible read. It proves the address resolves and the token
      // is accepted without creating anything.
      const { items } = await api.ping();
      setCheck({ kind: 'connected', items: items.length });

      // Anything that piled up while the app had nowhere to send it can go now.
      void flushOutbox().then(() => void pendingCount().then(setWaiting));
    } catch (error) {
      setCheck({
        kind: 'refused',
        message: error instanceof NotConfigured
          ? 'Both the address and the token are needed.'
          : (error as Error).message,
      });
    }
  }

  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  /**
   * Export.
   *
   * Read from the local replica rather than the server, so it works offline and
   * so it exports what you can actually see. 01-PRD.md principle 4 is "yours,
   * offline, exportable — no lock-in, including no lock-in to Stash".
   */
  async function exportJson() {
    const [items, outbox] = await Promise.all([db.items.toArray(), db.outbox.toArray()]);
    const blob = new Blob([JSON.stringify({
      exportedAt: Date.now(),
      version: 1,
      items: items.map(({ pending, ...item }) => item),
      // Included so an export taken offline does not silently omit changes that
      // have not reached the server yet.
      unsynced: outbox.length,
    }, null, 2)], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stash-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="settings">
      <section className="settings__section">
        <h2 className="settings__h">Server</h2>
        <p className="settings__note">
          These stay on this device. Nothing is built into the app.
        </p>

        <label className="settings__field">
          <span className="settings__label">API address</span>
          <input
            type="url" inputMode="url" spellCheck={false} autoComplete="off"
            placeholder="https://stash-api.<you>.workers.dev/v1"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
          />
          <span className="settings__hint">Ends with /v1.</span>
        </label>

        <label className="settings__field">
          <span className="settings__label">Device token</span>
          <input
            type="password" autoComplete="off" spellCheck={false}
            value={deviceToken}
            onChange={(e) => setDeviceToken(e.target.value)}
          />
        </label>

        <button type="button" className="settings__button" onClick={() => void saveAndTest()}>
          {check.kind === 'testing' ? 'Testing…' : 'Save and test'}
        </button>

        {check.kind === 'connected' ? (
          <p className="settings__result settings__result--ok">
            Connected. {check.items > 0 ? 'Your shelf has items on the server.' : 'The server shelf is empty.'}
          </p>
        ) : null}
        {check.kind === 'refused' ? (
          // Errors say what happened and what to do. They do not apologise and
          // they do not blame (§8.2).
          <p className="settings__result settings__result--bad">{check.message}</p>
        ) : null}

        {waiting > 0 ? (
          <p className="settings__note">
            {waiting} change{waiting === 1 ? '' : 's'} waiting to reach the server.
          </p>
        ) : null}
      </section>

      <section className="settings__section">
        <h2 className="settings__h">Theme</h2>
        <div className="settings__choices" role="group" aria-label="Theme">
          {(['system', 'dark', 'light'] as Theme[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`settings__choice${theme === option ? ' is-on' : ''}`}
              aria-pressed={theme === option}
              onClick={() => chooseTheme(option)}
            >
              {option === 'system' ? `Auto · ${resolvedTheme('system')}` : option}
            </button>
          ))}
        </div>
      </section>

      <section className="settings__section">
        <h2 className="settings__h">Your data</h2>
        <p className="settings__note">
          Everything on this device, as JSON. The database is plain SQLite on the
          server and can be dumped directly.
        </p>
        <button type="button" className="settings__button settings__button--quiet"
                onClick={() => void exportJson()}>
          Export
        </button>
      </section>
    </div>
  );
}
