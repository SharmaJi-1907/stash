/**
 * Stash — shared contract.
 *
 * The single definition of what an Item, Category and Tag are, and of every API
 * request and response shape. Imported by the Worker, the web app and the extension.
 *
 * Spec: 02-TRD.md §4 (data model), §5 (API contract)
 * Rule: 06-AGENT-BUILD-GUIDE.md §1.10 — never redeclare an Item shape locally.
 *
 * Two conventions hold throughout this file:
 *
 *   Wire format is camelCase.  The D1 tables are snake_case (`created_at`); everything
 *   that crosses the network is camelCase (`createdAt`). The mapping between the two
 *   lives in worker/src/db/schema.ts and nowhere else.
 *
 *   Nullable means null, not undefined.  A field the server has not filled in yet is
 *   `null`. `undefined` is reserved for "this key was not sent at all", which is what
 *   makes PATCH bodies unambiguous.
 */

/** Epoch milliseconds. Every timestamp in the system. Spec: 02-TRD.md §4 */
export type Timestamp = number;

/** UUID v4, generated client-side so an offline client can create and render
 *  before it can push. Spec: 02-TRD.md §4.1 · 06-AGENT-BUILD-GUIDE.md §1.9 */
export type Id = string;

/** ISO 4217, e.g. "INR". */
export type CurrencyCode = string;

/**
 * Money is always an integer in minor units. ₹2,499.00 is 249900, currency "INR".
 * Never a float — floating-point currency is a bug waiting for a rainy day.
 * Spec: 02-TRD.md §4.1 · 06-AGENT-BUILD-GUIDE.md §1.7
 */
export type MinorUnits = number;

/* ────────────────────────────────────────────────────────────────────────────
   Enumerations
   Declared as const arrays so the same list can be used for runtime validation
   and for the type. Adding a value in one place adds it in both.
   ──────────────────────────────────────────────────────────────────────────── */

/** Where the item came in from. */
export const ITEM_SOURCES = ['extension', 'share', 'paste', 'manual'] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/** Lifecycle. `bought` and `dropped` leave the shelf but are retained and
 *  restorable. Spec: 01-PRD.md F7 */
export const ITEM_STATUSES = ['open', 'shortlist', 'bought', 'dropped'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * How good the metadata is.
 *   pending — enrichment has not run yet
 *   rich    — title, image and a price
 *   partial — usable, but something is missing
 *   manual  — the user typed it in
 *   failed  — nothing usable was extractable; the item still exists
 * Spec: 01-PRD.md F2.3 · 03-ARCHITECTURE.md §4.2
 */
export const ENRICHMENT_STATES = ['pending', 'rich', 'partial', 'manual', 'failed'] as const;
export type EnrichmentState = (typeof ENRICHMENT_STATES)[number];

/** 0 none, 1 maybe, 2 want. Spec: 02-TRD.md §4 */
export const ITEM_PRIORITIES = [0, 1, 2] as const;
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];

/** What a learned classifier rule matches on. Spec: 03-ARCHITECTURE.md §5 */
export const RULE_MATCH_TYPES = ['domain', 'keyword'] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

/* ────────────────────────────────────────────────────────────────────────────
   Core records
   ──────────────────────────────────────────────────────────────────────────── */

/** One thing on the shelf. Spec: 02-TRD.md §4 `items` */
export interface Item {
  id: Id;

  /** As the user gave it, tracking parameters and all. */
  url: string;
  /** Normalised. Spec: 03-ARCHITECTURE.md §4.1 */
  canonicalUrl: string;
  /** sha256 of canonicalUrl. Dedupe key. */
  urlHash: string;

  title: string | null;
  description: string | null;
  /** The user's own words. Spec: 01-PRD.md F8.1 */
  note: string | null;

  /** R2 object key. Present once the image has been copied into our own storage. */
  imageKey: string | null;
  /** The original remote URL. Fallback only — never hotlinked when imageKey exists.
   *  Spec: 03-ARCHITECTURE.md §4.5 */
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;

  priceAmount: MinorUnits | null;
  priceCurrency: CurrencyCode | null;

  /** Registrable domain, e.g. "amazon.in". */
  site: string | null;
  /** Human name, e.g. "Amazon". */
  siteName: string | null;

  source: ItemSource;
  categoryId: Id | null;
  /** Tag ids attached to this item. Flattened from the item_tags join table so a
   *  single sync payload carries the relation with the item it belongs to. */
  tagIds: Id[];

  status: ItemStatus;
  priority: ItemPriority;

  enrichment: EnrichmentState;
  enrichAttempts: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Last time the user answered "still want this?". Deliberately separate from
   *  updatedAt — editing a note must not reset the staleness clock.
   *  Spec: 02-TRD.md §4.1 · 04-DESIGN-SYSTEM.md §6 */
  reviewedAt: Timestamp | null;
  /** When status became bought or dropped. Feeds the decision-rate metric.
   *  Spec: 01-PRD.md §8 M2 */
  decidedAt: Timestamp | null;
  /** Soft-delete tombstone. Rows are never removed — sync needs tombstones to
   *  propagate deletions. Spec: 02-TRD.md §4.1 · 06-AGENT-BUILD-GUIDE.md §1.8 */
  deletedAt: Timestamp | null;
}

/** Spec: 02-TRD.md §4 `categories` · 01-PRD.md F3.1 */
export interface Category {
  id: Id;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  /** System categories cannot be deleted. `Other` is the one that matters. */
  isSystem: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt?: Timestamp | null;
}

/** Spec: 02-TRD.md §4 `tags` · 01-PRD.md F8.2 */
export interface Tag {
  id: Id;
  name: string;
  createdAt: Timestamp;
  deletedAt?: Timestamp | null;
}

/** Classifier memory, written when the user corrects a category.
 *  Spec: 03-ARCHITECTURE.md §5 */
export interface ClassifyRule {
  id: Id;
  matchType: RuleMatchType;
  matchValue: string;
  categoryId: Id;
  /** Incremented on repeat corrections. Higher weight wins. */
  weight: number;
  createdAt: Timestamp;
}

/** Written on every enrichment, never read by v1 UI. Reserved for v2 price
 *  tracking so that feature arrives with history. Spec: 01-PRD.md §5.3 */
export interface PriceSnapshot {
  id: Id;
  itemId: Id;
  amount: MinorUnits;
  currency: CurrencyCode;
  capturedAt: Timestamp;
}

/** Single-row settings blob. Spec: 02-TRD.md §4 `settings` */
export interface Setting {
  key: string;
  value: string;
  updatedAt: Timestamp;
}

/* ────────────────────────────────────────────────────────────────────────────
   Field limits
   Enforced at the edge before anything reaches the database.
   Spec: 02-TRD.md §6 "Input handling"
   ──────────────────────────────────────────────────────────────────────────── */

export const LIMITS = {
  titleLength: 500,
  noteLength: 2000,
  tagNameLength: 50,
  /** Multipart upload ceiling. Spec: 02-TRD.md §5.3 PAYLOAD_TOO_LARGE */
  uploadBytes: 5 * 1024 * 1024,
  /** Enrichment caps. Spec: 03-ARCHITECTURE.md §4.5, 02-TRD.md §6 */
  imageBytes: 2 * 1024 * 1024,
  enrichTimeoutMs: 8_000,
  maxRedirects: 3,
  maxEnrichAttempts: 3,
  /** Sync page size. Spec: 03-ARCHITECTURE.md §6.1 */
  syncPageSize: 500,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
   API — requests
   Base: /v1 · Authorization: Bearer <DEVICE_TOKEN>
   Spec: 02-TRD.md §5
   ──────────────────────────────────────────────────────────────────────────── */

/** Metadata the extension read straight off the live page. When present the
 *  server skips its own extraction ladder and the item arrives `rich`.
 *  Spec: 03-ARCHITECTURE.md §3, §4.2 Tier 0 */
export interface ScrapedMetadata {
  title?: string;
  description?: string;
  image?: string;
  priceAmount?: MinorUnits;
  priceCurrency?: CurrencyCode;
  siteName?: string;
}

/** POST /v1/items — requires `url`, or `manual: true` with a `title`.
 *  Spec: 02-TRD.md §5.1 */
export interface CreateItemRequest {
  /** Client-generated UUID v4. */
  id: Id;
  url?: string;
  /** True when there is no fetchable URL at all — a WhatsApp forward, an
   *  Instagram screenshot. Requires `title`. Spec: 01-PRD.md F4 */
  manual?: boolean;
  title?: string;
  note?: string;
  source: ItemSource;
  categoryId?: Id;
  priceAmount?: MinorUnits;
  priceCurrency?: CurrencyCode;
  /** R2 key returned by POST /v1/uploads/image, for the screenshot path. */
  imageKey?: string;
  scraped?: ScrapedMetadata;
  /** Client's own creation time, so an item queued offline keeps the moment it
   *  was actually saved rather than the moment it finally synced. */
  createdAt?: Timestamp;
}

/** PATCH /v1/items/:id — only the keys present are changed.
 *  `null` clears a field; omitted leaves it alone. */
export interface UpdateItemRequest {
  title?: string | null;
  note?: string | null;
  categoryId?: Id | null;
  tagIds?: Id[];
  status?: ItemStatus;
  priority?: ItemPriority;
  priceAmount?: MinorUnits | null;
  priceCurrency?: CurrencyCode | null;
}

/** GET /v1/items query string. Spec: 02-TRD.md §5 */
export interface ListItemsQuery {
  status?: ItemStatus;
  category?: Id;
  tag?: Id;
  /** Free text across title, note, tags and site. Spec: 01-PRD.md F6.1 */
  q?: string;
  since?: Timestamp;
  limit?: number;
  cursor?: string;
}

export interface CreateCategoryRequest {
  id: Id;
  name: string;
  icon?: string;
  sortOrder?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  icon?: string | null;
  sortOrder?: number;
}

/* ────────────────────────────────────────────────────────────────────────────
   API — responses
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * POST /v1/items. Returns immediately — it does not wait for enrichment.
 * `duplicate` is true when this canonical URL was already on the shelf, in which
 * case the existing item is returned with status 200 and no second row is made.
 * Spec: 02-TRD.md §5.1 · 01-PRD.md F1.5
 */
export interface CreateItemResponse {
  item: Item;
  duplicate: boolean;
}

export interface ListItemsResponse {
  items: Item[];
  /** Pass back as `cursor` to get the next page. Null when the list is complete. */
  nextCursor: string | null;
}

/** GET /v1/sync?since=<ms>. Spec: 02-TRD.md §5.2 · 03-ARCHITECTURE.md §6.1 */
export interface SyncResponse {
  /** The client stores this as its next `since`. */
  now: Timestamp;
  /** Includes tombstones — rows with a non-null deletedAt, which the client
   *  removes locally. */
  items: Item[];
  categories: Category[];
  tags: Tag[];
  /** True when the response was truncated at the page limit. The client calls
   *  again with `since` set to the highest updatedAt it received. */
  hasMore: boolean;
}

/** POST /v1/uploads/image. Spec: 02-TRD.md §5 */
export interface UploadImageResponse {
  key: string;
}

/** GET /v1/export. Spec: 01-PRD.md F12 */
export interface ExportResponse {
  exportedAt: Timestamp;
  version: 1;
  items: Item[];
  categories: Category[];
  tags: Tag[];
  classifyRules: ClassifyRule[];
  priceSnapshots: PriceSnapshot[];
  settings: Setting[];
}

/** GET /health — the one unauthenticated route. */
export interface HealthResponse {
  ok: true;
  time: Timestamp;
}

/* ────────────────────────────────────────────────────────────────────────────
   API — errors
   Spec: 02-TRD.md §5.3
   ──────────────────────────────────────────────────────────────────────────── */

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_URL',
  'NOT_FOUND',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

/**
 * Enrichment failure is deliberately absent from ERROR_CODES. It is not an API
 * error — it sets `enrichment: "failed"` on the item and the request succeeds.
 * The save is the contract; the metadata is best-effort.
 * Spec: 02-TRD.md §5.3 · 06-AGENT-BUILD-GUIDE.md §1.3
 */

/* ────────────────────────────────────────────────────────────────────────────
   Client-local shapes
   Not sent by the server. Shared because the web app and the extension both
   need them and must agree.
   ──────────────────────────────────────────────────────────────────────────── */

/** A mutation waiting to be pushed. Survives app restarts, retried with
 *  exponential backoff. Spec: 03-ARCHITECTURE.md §6.1, §7 */
export interface OutboxEntry {
  /** Local queue id, not the item id. */
  id: Id;
  kind: 'create' | 'update' | 'delete' | 'review';
  itemId: Id;
  /** The request body to send, shape depending on `kind`. */
  payload: unknown;
  attempts: number;
  /** Epoch ms before which this should not be retried. */
  nextAttemptAt: Timestamp;
  lastError: string | null;
  createdAt: Timestamp;
}

/**
 * The minimum of a Blob that this contract depends on.
 *
 * Declared structurally rather than using the built-in `Blob` on purpose: this
 * file is compiled by three different runtimes — the Worker, the browser and the
 * extension — and each supplies its own `Blob`. Naming one of them here would
 * force a DOM library into a package that must stay environment-free. A real
 * `Blob` from any of the three satisfies this shape.
 */
export interface BlobLike {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** What the Android share sheet handed the service worker. Android often puts
 *  the URL inside `text` rather than `url` — extract from whichever has one.
 *  Spec: 06-AGENT-BUILD-GUIDE.md §4.4 */
export interface SharedPayload {
  title: string;
  text: string;
  url: string;
  image: BlobLike | null;
  receivedAt: Timestamp;
}
