/**
 * Where a share lands, and where a pasted URL goes.
 *
 * Spec: 04-DESIGN-SYSTEM.md §7.3 · 01-PRD.md F1, F4 · 05-ROADMAP.md P2 task 8
 *
 * ── The Save button is enabled from the first frame ─────────────────────────
 *
 * It never waits for anything. Pressing it while the title still reads
 * "Reading the page…" saves the item and lets the metadata land afterwards.
 * 04-DESIGN-SYSTEM.md §7.3 calls this the single most important behaviour in the
 * product, and 01-PRD.md principle 1 is why: an item saved with a bad title is
 * infinitely better than an item not saved.
 *
 * The screen is also forgiving about what it is given. Android puts the URL in
 * `text` rather than `url` depending on the sharing app — measured on this
 * user's phone, sharing from YouTube, `url` was empty every time — so the URL is
 * taken from whichever field carries one.
 */

import { useEffect, useRef, useState } from 'react';
import { saveLocal } from '../db/local';
import { flushOutbox } from '../sync/outbox';
import { clearShare, takePendingShares } from '../shareInbox';
import type { ItemSource } from '../../../shared/types';
import './Capture.css';

/**
 * Trim punctuation a sentence left attached to a URL.
 *
 * "see (https://example.com/p) here" must not yield a URL ending in ")".
 * But a closing bracket can genuinely belong to one — Wikipedia articles are
 * full of them — so it is only dropped when the URL has no opening bracket to
 * match it. Sentence punctuation is dropped unconditionally: no real URL ends
 * in a comma or an exclamation mark.
 */
function trimSentence(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last && ',.;:!?'.includes(last)) { out = out.slice(0, -1); continue; }
    if (last === ')' && !out.includes('(')) { out = out.slice(0, -1); continue; }
    if (last === ']' && !out.includes('[')) { out = out.slice(0, -1); continue; }
    return out;
  }
}

/** The first http(s) URL in a piece of text, wherever it happens to sit. */
export function urlIn(...candidates: (string | null | undefined)[]): string {
  for (const value of candidates) {
    if (!value) continue;
    const trimmed = value.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) return trimSentence(trimmed);
    const found = trimmed.match(/https?:\/\/[^\s<>"']+/i);
    if (found) return trimSentence(found[0]);
  }
  return '';
}

/** What a share can leave behind for this screen to pick up. */
export interface SharedPayload {
  url?: string;
  text?: string;
  title?: string;
}

export interface CaptureProps {
  shared?: SharedPayload;
  source?: ItemSource;
  onDone?: (itemId: string) => void;
}

type State =
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'saved'; duplicate: boolean }
  | { kind: 'refused'; message: string };

export function Capture({ shared, source = 'share', onDone }: CaptureProps) {
  const [url, setUrl] = useState(() => urlIn(shared?.url, shared?.text));
  const [title, setTitle] = useState(shared?.title?.trim() ?? '');
  const [note, setNote] = useState('');
  const [state, setState] = useState<State>({ kind: 'editing' });
  const [inboxAt, setInboxAt] = useState<number | null>(null);

  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // A share intercepted by the service worker is not in the URL — it is in the
    // inbox the worker wrote it to. Reading it here is what turns the Android
    // share sheet into an item.
    let cancelled = false;
    void takePendingShares().then((waiting) => {
      const newest = waiting[0];
      if (cancelled || !newest) return;
      const found = urlIn(newest.url, newest.text);
      if (found) setUrl(found);
      if (newest.title?.trim()) setTitle((current) => current || newest.title!.trim());
      setInboxAt(newest.receivedAt);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // The note is prompted at capture but always skippable (01-PRD.md F8.1).
    // Focusing it puts the cursor where the only thing worth typing goes, while
    // Save stays one tap away.
    if (url) noteRef.current?.focus();
    // Only on the first URL the screen learns about, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(url)]);

  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();

  async function save() {
    setState({ kind: 'saving' });
    try {
      const manual = !url.trim();
      const { item, duplicate } = await saveLocal({
        url: url.trim() || undefined,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        source: manual ? 'manual' : source,
        manual: manual || undefined,
      });

      // The save is done. Pushing happens after, and its failure is not the
      // user's problem — 03-ARCHITECTURE.md §8.
      void flushOutbox();
      if (inboxAt !== null) void clearShare(inboxAt);

      setState({ kind: 'saved', duplicate });
      onDone?.(item.id);
    } catch (error) {
      setState({ kind: 'refused', message: (error as Error).message });
    }
  }

  if (state.kind === 'saved') {
    return (
      <div className="capture capture--done">
        <p className="capture__done">{state.duplicate ? 'Already on your shelf' : 'Saved'}</p>
        <a className="capture__back" href="/">Back to the shelf</a>
      </div>
    );
  }

  return (
    <div className="capture">
      <div className="capture__preview">
        <div className="capture__thumb" aria-hidden="true" />
        <div className="capture__about">
          {/* Nothing here is known yet for a plain share, and saying so is
              better than an empty space that looks like a bug. */}
          <p className="capture__status">{title || (url ? 'Reading the page…' : 'Nothing shared yet')}</p>
          {host ? <p className="capture__host">{host}</p> : null}
        </div>
      </div>

      {!url && !shared ? (
        <label className="capture__field">
          <span className="capture__label">Paste a link</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      ) : null}

      {!url.trim() ? (
        <label className="capture__field">
          <span className="capture__label">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is it?"
          />
        </label>
      ) : null}

      <label className="capture__field">
        <span className="capture__label">Add a note</span>
        <textarea
          ref={noteRef}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save(); }}
        />
      </label>

      {/* Enabled from the first frame. Never disabled while saving either —
          a save takes a few milliseconds, and a button that flickers disabled
          reads as hesitation the product does not have. */}
      <button type="button" className="capture__save" onClick={() => void save()}>
        {state.kind === 'saving' ? 'Saving…' : 'Save'}
      </button>

      {state.kind === 'refused' ? (
        <p className="capture__refused">{state.message}</p>
      ) : null}
    </div>
  );
}
