import { describe, it, expect } from 'vitest';
import { routeFrom } from '../src/router';

const at = (href: string) => routeFrom(new URL(href, 'https://stash.test'));

describe('which screen a URL means', () => {
  it('the root is the shelf', () => expect(at('/')).toEqual({ name: 'shelf' }));
  it('a trailing slash is the same place', () => expect(at('/settings/')).toEqual(at('/settings')));
  it('/add is capture with nothing shared', () =>
    expect(at('/add')).toEqual({ name: 'capture', shared: undefined }));
  it('/settings', () => expect(at('/settings')).toEqual({ name: 'settings' }));
  it('/item/<id>', () => expect(at('/item/abc-123')).toEqual({ name: 'item', id: 'abc-123' }));
  it('anything unrecognised falls back to the shelf rather than a dead end', () =>
    expect(at('/nonsense/here')).toEqual({ name: 'shelf' }));
});

describe('a share that reached the network', () => {
  /**
   * The service worker answers the share POST, but on the very first share —
   * before it has taken control — the request goes to the network as a GET with
   * query parameters. Reading them here means that first share is not lost,
   * which is the one a user judges the whole app by.
   */
  it('reads url, text and title off the query string', () => {
    const route = at('/share?url=https%3A%2F%2Fexample.com%2Fa&text=hello&title=A%20thing');
    expect(route).toEqual({
      name: 'capture',
      shared: { url: 'https://example.com/a', text: 'hello', title: 'A thing' },
    });
  });

  it('handles the shape Android actually sends, with the URL in text', () => {
    const route = at('/share?text=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ&title=Never%20Gonna');
    expect(route.name).toBe('capture');
    expect(route.name === 'capture' && route.shared?.url).toBeUndefined();
    expect(route.name === 'capture' && route.shared?.text).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('an empty share is still capture, not an error', () => {
    const route = at('/share');
    expect(route.name).toBe('capture');
  });
});
