/**
 * Routing, such as it is.
 *
 * Three screens and no nested routes, so a router library would be bytes on the
 * critical path buying nothing. The bundle budget is 200 KB gzipped
 * (02-TRD.md §7) and this is forty lines.
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'shelf' }
  | { name: 'capture'; shared?: { url?: string; text?: string; title?: string } }
  | { name: 'item'; id: string }
  | { name: 'settings' };

export function routeFrom(url: URL): Route {
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/share') {
    // A share that arrived while the service worker was not yet in control
    // reaches the network as a GET with query parameters. Reading them here
    // means that first share is not silently lost.
    return {
      name: 'capture',
      shared: {
        url: url.searchParams.get('url') ?? undefined,
        text: url.searchParams.get('text') ?? undefined,
        title: url.searchParams.get('title') ?? undefined,
      },
    };
  }
  if (path === '/add') return { name: 'capture' };
  if (path === '/settings') return { name: 'settings' };

  const item = path.match(/^\/item\/(.+)$/);
  if (item) return { name: 'item', id: item[1]! };

  return { name: 'shelf' };
}

export function navigate(path: string): void {
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFrom(new URL(location.href)));

  useEffect(() => {
    const onChange = () => setRoute(routeFrom(new URL(location.href)));
    addEventListener('popstate', onChange);
    return () => removeEventListener('popstate', onChange);
  }, []);

  return route;
}
