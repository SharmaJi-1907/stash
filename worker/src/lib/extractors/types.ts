/**
 * What every tier returns. Spec: 03-ARCHITECTURE.md §4.2
 */
import type { EnrichmentState } from '../../../../shared/types';

export interface Extracted {
  title?: string;
  description?: string;
  image?: string;
  price?: { amount: number; currency: string };
  siteName?: string;
  /** Which rung of the ladder produced this, for logging and for tests. */
  tier: 'scrape' | 'jsonld' | 'opengraph' | 'twitter' | 'oembed' | 'bare';
  /** rich when a price came with it, partial otherwise. */
  quality: Extract<EnrichmentState, 'rich' | 'partial'>;
}
