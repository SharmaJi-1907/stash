# Read before touching manifest.webmanifest

`share_target` is the highest-risk assumption in the system (`01-PRD.md` R3) and is
verified alone as **P2 task 1**, before anything is built on top of it.

Three failure modes, all of which present identically — the PWA installs fine and simply
never appears in the Android share sheet:

1. **`action` must be an absolute URL.** A relative path installs cleanly and silently
   never registers. Most common cause. Update the host below to the real `*.pages.dev`
   subdomain once it exists — the value currently in the manifest is the placeholder from
   `02-TRD.md` §3.1.
2. **Android caches the manifest aggressively.** After any `share_target` change the PWA
   must be **fully uninstalled and reinstalled**. Reloading does nothing.
3. **`method` must be POST with `multipart/form-data`.** GET cannot receive files, which
   the screenshot capture path (`01-PRD.md` F4.3) requires. The POST is handled by the
   service worker, not by the server.

Also: Android often puts the URL inside `text` rather than `url`, depending on the sharing
app. Extract a URL from whichever field contains one.

Spec: `02-TRD.md` §3.1 · `06-AGENT-BUILD-GUIDE.md` §4.4 · `07-RESEARCH.md` §3.3
