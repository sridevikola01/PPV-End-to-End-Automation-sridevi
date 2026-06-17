import { Page } from '@playwright/test';

/**
 * Represents a tile found in the rails API response that matches an entitlement filter.
 */
export interface RailTileMatch {
  railIndex: number;
  railTitle: string;
  railId: string;
  tileIndex: number;
  tileTitle: string;
  tileId: string;
  entitlementIds: string[];
  imageUrl?: string;
}

/**
 * Result from intercepting the rails API.
 */
export interface RailsInterceptResult {
  allRails: any[];
  matchingTiles: RailTileMatch[];
  rawResponse?: any;
}

/**
 * Intercepts the DAZN rails/page API response and extracts tile information
 * filtered by entitlement IDs.
 *
 * Usage:
 *   const interceptor = new RailsInterceptor(page);
 *   await interceptor.startListening();
 *   await page.goto('https://stag.dazn.com/en-GB/home');
 *   const result = await interceptor.waitForRailsResponse();
 *   const tiles = interceptor.findTilesByEntitlement(['base_dazn_content']);
 */
export class RailsInterceptor {
  private page: Page;
  private railsResponse: any = null;
  private responsePromise: Promise<any> | null = null;
  private allRails: any[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Start listening for rails API responses BEFORE navigation.
   * Call this before page.goto().
   */
  async startListening(): Promise<void> {
    this.railsResponse = null;
    this.allRails = [];

    // DAZN rails API patterns — covers multiple known endpoint formats
    const railsUrlPatterns = [
      '**/rails**',
      '**/page**',
      '**/cms/routes**',
      '**/content/**',
      '**/epg/**',
    ];

    this.responsePromise = this.page.waitForResponse(
      (response) => {
        const url = response.url();
        const isRailsEndpoint =
          (url.includes('/rails') ||
            url.includes('/page') && url.includes('rail') ||
            url.includes('/cms/') ||
            url.includes('content') && url.includes('rail')) &&
          response.status() === 200 &&
          response.headers()['content-type']?.includes('application/json');
        return isRailsEndpoint;
      },
      { timeout: 30000 }
    ).catch(() => null);
  }

  /**
   * Wait for the rails API response after navigation.
   * Returns the parsed JSON response.
   */
  async waitForRailsResponse(timeoutMs = 30000): Promise<any> {
    if (this.responsePromise) {
      const response = await this.responsePromise;
      if (response) {
        try {
          this.railsResponse = await response.json();
          this.allRails = this.extractRails(this.railsResponse);
          console.log(`✅ [RailsInterceptor] Captured rails response with ${this.allRails.length} rails`);
          return this.railsResponse;
        } catch (e: any) {
          console.warn(`⚠️ [RailsInterceptor] Failed to parse rails response: ${e.message}`);
        }
      }
    }
    return null;
  }

  /**
   * Capture rails responses during page load. Optionally stop early once
   * tiles matching `targetEntitlements` are found — avoids unnecessary
   * full-page scrolling.
   *
   * Behaviour:
   *  1. Navigate and wait for initial networkidle.
   *  2. Check if already-loaded rails contain a matching tile → return immediately.
   *  3. Scroll incrementally (scrollStep px per step, up to maxScrollSteps).
   *     After each step, re-check for matching tiles and stop as soon as found.
   *  4. If no target provided, scrolls all the way and returns everything.
   */
  async captureAllRailsResponses(
    navigationFn: () => Promise<void>,
    timeoutMs = 30000,
    scrollCount = 20,
    targetEntitlements?: string[],
  ): Promise<RailsInterceptResult> {
    const responses: any[] = [];
    this.allRails = [];

    const handler = async (response: any) => {
      const url = response.url();
      const urlLower = url.toLowerCase();
      const contentType = response.headers()['content-type'] || '';

      const isRailsEndpoint =
        response.status() === 200 &&
        contentType.includes('application/json') &&
        (urlLower.includes('/rail') ||
          urlLower.includes('rail-router') ||
          urlLower.includes('/page') ||
          urlLower.includes('/cms/') ||
          (urlLower.includes('content') && !url.includes('.js') && !url.includes('.css')));

      if (isRailsEndpoint) {
        try {
          const json = await response.json();
          if (this.hasTileData(json)) {
            responses.push(json);
            const rails = this.extractRails(json);
            this.allRails.push(...rails);
            console.log(`📡 [RailsInterceptor] Captured tiles from: ${url.substring(0, 120)} (${rails.length} rail(s), ${this.countTiles(rails)} tiles)`);
          }
        } catch {
          // Skip non-parseable responses
        }
      }
    };

    this.page.on('response', handler);

    // Execute the navigation
    await navigationFn();

    // Wait for initial page load — use short timeout to avoid blocking on slow resources
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(300);

    // ── Early exit: check if initial rails already contain a matching tile ──
    if (targetEntitlements && targetEntitlements.length > 0) {
      const earlyMatches = this.findTilesByEntitlement(targetEntitlements);
      if (earlyMatches.length > 0) {
        console.log(`✅ [RailsInterceptor] Found ${earlyMatches.length} matching tile(s) in initial page load — skipping scroll`);
        this.page.off('response', handler);
        console.log(`✅ [RailsInterceptor] Total captured: ${responses.length} responses, ${this.allRails.length} rails`);
        return { allRails: this.allRails, matchingTiles: earlyMatches, rawResponse: responses };
      }
    }

    // ── Scroll incrementally, stopping as soon as a match is found ──────────
    console.log(`📜 [RailsInterceptor] Scrolling to load more rails (max ${scrollCount} steps)...`);
    for (let i = 0; i < scrollCount; i++) {
      await this.page.evaluate(() => window.scrollBy(0, 800));
      await this.page.waitForTimeout(400);

      if (targetEntitlements && targetEntitlements.length > 0) {
        const matches = this.findTilesByEntitlement(targetEntitlements);
        if (matches.length > 0) {
          console.log(`✅ [RailsInterceptor] Found ${matches.length} matching tile(s) after ${i + 1} scroll step(s) — stopping early`);
          // Wait briefly for any in-flight responses to settle
          await this.page.waitForTimeout(500);
          this.page.off('response', handler);
          console.log(`✅ [RailsInterceptor] Total captured: ${responses.length} responses, ${this.allRails.length} rails`);
          return { allRails: this.allRails, matchingTiles: matches, rawResponse: responses };
        }
      }
    }

    // No early exit — wait for network to settle then return everything
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(1000);

    this.page.off('response', handler);

    console.log(`✅ [RailsInterceptor] Total captured: ${responses.length} responses, ${this.allRails.length} rails`);

    return {
      allRails: this.allRails,
      matchingTiles: targetEntitlements ? this.findTilesByEntitlement(targetEntitlements) : [],
      rawResponse: responses,
    };
  }

  /**
   * Find tiles that match the given entitlement IDs.
   *
   * @param targetEntitlements - Array of entitlement IDs to look for (e.g., ['base_dazn_content'])
   * @param matchAll - If true, tile must have ALL specified entitlements. If false, any match counts.
   * @returns Array of matching tile info with rail/tile positions
   */
  findTilesByEntitlement(targetEntitlements: string[], matchAll = false): RailTileMatch[] {
    const matches: RailTileMatch[] = [];
    const targetSet = new Set(targetEntitlements.map(e => e.toLowerCase().trim()));

    for (let railIdx = 0; railIdx < this.allRails.length; railIdx++) {
      const rail = this.allRails[railIdx];
      const railTitle = rail.Title || rail.title || rail.Name || rail.name || `Rail ${railIdx}`;
      const railId = rail.Id || rail.id || rail.RailId || '';
      const tiles = rail.Tiles || rail.tiles || rail.Items || rail.items || rail.Contents || rail.contents || [];

      // Skip "Free to Watch" rails — these tiles don't require a subscription/entitlement
      // and clicking them won't trigger a PPV/signup flow.
      const railTitleLower = railTitle.toLowerCase();
      if (
        railTitleLower.includes('free to watch') ||
        railTitleLower.includes('free to air') ||
        railTitleLower.includes('watch for free') ||
        railTitleLower.includes('freeview')
      ) {
        console.log(`⏭️  [RailsInterceptor] Skipping "Free to Watch" rail: "${railTitle}"`);
        continue;
      }

      for (let tileIdx = 0; tileIdx < tiles.length; tileIdx++) {
        const tile = tiles[tileIdx];
        const tileEntitlements = this.extractEntitlementIds(tile);

        if (tileEntitlements.length === 0) continue;

        const tileEntitlementSet = new Set(tileEntitlements.map((e: string) => e.toLowerCase().trim()));

        let isMatch = false;
        if (matchAll) {
          isMatch = [...targetSet].every(t => tileEntitlementSet.has(t));
        } else {
          isMatch = [...targetSet].some(t => tileEntitlementSet.has(t));
        }

        if (isMatch) {
          matches.push({
            railIndex: railIdx,
            railTitle,
            railId,
            tileIndex: tileIdx,
            tileTitle: tile.Title || tile.title || tile.Name || tile.name || tile.Label || '',
            tileId: tile.Id || tile.id || tile.ContentId || tile.contentId || '',
            entitlementIds: tileEntitlements,
            imageUrl: tile.Image || tile.image || tile.ImageUrl || tile.imageUrl || tile.Thumbnail || '',
          });
        }
      }
    }

    console.log(`🔍 [RailsInterceptor] Found ${matches.length} tiles matching entitlements: [${targetEntitlements.join(', ')}]`);
    if (matches.length > 0) {
      matches.forEach((m, i) => {
        console.log(`  ${i + 1}. Rail "${m.railTitle}" (idx=${m.railIndex}), Tile "${m.tileTitle}" (idx=${m.tileIndex}), Entitlements: [${m.entitlementIds.join(', ')}]`);
      });
    }

    return matches;
  }

  /**
   * Find the first tile that does NOT have the specified entitlement IDs.
   * Useful for finding PPV tiles (tiles that require purchase beyond base content).
   *
   * @param excludeEntitlements - Entitlements that indicate "free/base" content
   * @returns Tiles that require additional entitlement (e.g., PPV content)
   */
  findTilesExcludingEntitlement(excludeEntitlements: string[]): RailTileMatch[] {
    const matches: RailTileMatch[] = [];
    const excludeSet = new Set(excludeEntitlements.map(e => e.toLowerCase().trim()));

    for (let railIdx = 0; railIdx < this.allRails.length; railIdx++) {
      const rail = this.allRails[railIdx];
      const railTitle = rail.Title || rail.title || rail.Name || rail.name || `Rail ${railIdx}`;
      const railId = rail.Id || rail.id || rail.RailId || '';
      const tiles = rail.Tiles || rail.tiles || rail.Items || rail.items || rail.Contents || rail.contents || [];

      for (let tileIdx = 0; tileIdx < tiles.length; tileIdx++) {
        const tile = tiles[tileIdx];
        const tileEntitlements = this.extractEntitlementIds(tile);

        if (tileEntitlements.length === 0) continue;

        const tileEntitlementSet = new Set(tileEntitlements.map((e: string) => e.toLowerCase().trim()));
        const hasExcluded = [...excludeSet].some(e => tileEntitlementSet.has(e));

        if (!hasExcluded) {
          matches.push({
            railIndex: railIdx,
            railTitle,
            railId,
            tileIndex: tileIdx,
            tileTitle: tile.Title || tile.title || tile.Name || tile.name || tile.Label || '',
            tileId: tile.Id || tile.id || tile.ContentId || tile.contentId || '',
            entitlementIds: tileEntitlements,
            imageUrl: tile.Image || tile.image || tile.ImageUrl || tile.imageUrl || tile.Thumbnail || '',
          });
        }
      }
    }

    console.log(`🔍 [RailsInterceptor] Found ${matches.length} tiles NOT matching entitlements: [${excludeEntitlements.join(', ')}]`);
    return matches;
  }

  /**
   * Get all rails data (after capture).
   */
  getAllRails(): any[] {
    return this.allRails;
  }

  /**
   * Get the raw response (after capture).
   */
  getRawResponse(): any {
    return this.railsResponse;
  }

  /**
   * Print a summary of all rails and their tiles with entitlements.
   * Useful for debugging.
   */
  printRailsSummary(): void {
    console.log('\n═══════════════════════════════════════════════');
    console.log('  RAILS SUMMARY');
    console.log('═══════════════════════════════════════════════');

    for (let railIdx = 0; railIdx < this.allRails.length; railIdx++) {
      const rail = this.allRails[railIdx];
      const railTitle = rail.Title || rail.title || rail.Name || rail.name || `Rail ${railIdx}`;
      const tiles = rail.Tiles || rail.tiles || rail.Items || rail.items || rail.Contents || rail.contents || [];

      console.log(`\n📋 Rail ${railIdx}: "${railTitle}" (${tiles.length} tiles)`);

      for (let tileIdx = 0; tileIdx < Math.min(tiles.length, 5); tileIdx++) {
        const tile = tiles[tileIdx];
        const tileTitle = tile.Title || tile.title || tile.Name || tile.name || 'Untitled';
        const entitlements = this.extractEntitlementIds(tile);
        console.log(`   ${tileIdx}. "${tileTitle}" → Entitlements: [${entitlements.join(', ') || 'none'}]`);
      }
      if (tiles.length > 5) {
        console.log(`   ... and ${tiles.length - 5} more tiles`);
      }
    }
    console.log('\n═══════════════════════════════════════════════\n');
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if a JSON response contains actual tile data (not just rail definitions).
   * A response with tile data has a Tiles/Items array with actual content objects.
   */
  private hasTileData(json: any): boolean {
    if (!json) return false;

    // Direct Tiles array with items
    const tilesArr = json.Tiles || json.tiles || json.Items || json.items;
    if (Array.isArray(tilesArr) && tilesArr.length > 0) {
      // Verify first item looks like a tile (has Title or Id, not just rail metadata)
      const first = tilesArr[0];
      if (first && (first.Title || first.title || first.Id || first.id)) {
        return true;
      }
    }

    // Array of rails each containing Tiles
    if (Array.isArray(json) && json.length > 0) {
      const first = json[0];
      const firstTiles = first?.Tiles || first?.tiles || first?.Items || first?.items;
      if (Array.isArray(firstTiles) && firstTiles.length > 0) {
        return true;
      }
    }

    // Nested in wrapper
    const nested = json.Rails || json.rails || json.Data?.Rails || json.data?.rails;
    if (Array.isArray(nested) && nested.length > 0) {
      const first = nested[0];
      const firstTiles = first?.Tiles || first?.tiles || first?.Items || first?.items;
      if (Array.isArray(firstTiles) && firstTiles.length > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Count total tiles across an array of rails.
   */
  private countTiles(rails: any[]): number {
    let count = 0;
    for (const rail of rails) {
      const tiles = rail.Tiles || rail.tiles || rail.Items || rail.items || rail.Contents || rail.contents || [];
      count += Array.isArray(tiles) ? tiles.length : 0;
    }
    return count;
  }

  /**
   * Check if a JSON response contains rails-like data.
   */
  private hasRailsData(json: any): boolean {
    if (!json) return false;

    // Direct rails array
    if (Array.isArray(json) && json.length > 0 && (json[0].Tiles || json[0].tiles || json[0].Items)) {
      return true;
    }

    // Nested in common wrapper properties
    const possibleRailArrays = [
      json.Rails, json.rails,
      json.Data?.Rails, json.data?.rails,
      json.Page?.Rails, json.page?.rails,
      json.Content?.Rails, json.content?.rails,
      json.Sections, json.sections,
      json.Components, json.components,
    ];

    for (const arr of possibleRailArrays) {
      if (Array.isArray(arr) && arr.length > 0) return true;
    }

    // Single rail object with tiles
    if (json.Tiles || json.tiles || json.Items || json.items) {
      return true;
    }

    return false;
  }

  /**
   * Extract rails array from various response structures.
   */
  private extractRails(json: any): any[] {
    if (!json) return [];

    // Direct rails array
    if (Array.isArray(json) && json.length > 0 && (json[0].Tiles || json[0].tiles || json[0].Items)) {
      return json;
    }

    // Nested in common wrapper properties
    const possibleRailArrays = [
      json.Rails, json.rails,
      json.Data?.Rails, json.data?.rails,
      json.Page?.Rails, json.page?.rails,
      json.Content?.Rails, json.content?.rails,
      json.Sections, json.sections,
      json.Components, json.components,
    ];

    for (const arr of possibleRailArrays) {
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }

    // Single rail object → wrap it
    if (json.Tiles || json.tiles || json.Items || json.items) {
      return [json];
    }

    // Deep search: recursively find any arrays that look like rails
    return this.deepFindRails(json);
  }

  /**
   * Deep search for rails-like arrays in the response object.
   */
  private deepFindRails(obj: any, depth = 0): any[] {
    if (depth > 4 || !obj || typeof obj !== 'object') return [];

    if (Array.isArray(obj)) {
      // Check if this array contains rail-like objects
      if (obj.length > 0 && (obj[0].Tiles || obj[0].tiles || obj[0].Items || obj[0].items)) {
        return obj;
      }
      // Search each element
      for (const item of obj) {
        const result = this.deepFindRails(item, depth + 1);
        if (result.length > 0) return result;
      }
    } else {
      // Search object properties
      for (const key of Object.keys(obj)) {
        const result = this.deepFindRails(obj[key], depth + 1);
        if (result.length > 0) return result;
      }
    }

    return [];
  }

  /**
   * Extract EntitlementIds from a tile object.
   * Handles various property naming conventions.
   */
  private extractEntitlementIds(tile: any): string[] {
    if (!tile) return [];

    // Direct EntitlementIds property
    const directProps = [
      tile.EntitlementIds,
      tile.entitlementIds,
      tile.Entitlements,
      tile.entitlements,
      tile.EntitlementSetIds,
      tile.entitlementSetIds,
    ];

    for (const prop of directProps) {
      if (Array.isArray(prop) && prop.length > 0) {
        return prop;
      }
      if (typeof prop === 'string' && prop.trim()) {
        return [prop];
      }
    }

    // Nested under common sub-objects
    const nestedObjects = [
      tile.Metadata,
      tile.metadata,
      tile.Properties,
      tile.properties,
      tile.Content,
      tile.content,
      tile.Data,
      tile.data,
    ];

    for (const nested of nestedObjects) {
      if (nested) {
        const nestedEntitlements = [
          nested.EntitlementIds,
          nested.entitlementIds,
          nested.Entitlements,
          nested.entitlements,
          nested.EntitlementSetIds,
          nested.entitlementSetIds,
        ];
        for (const prop of nestedEntitlements) {
          if (Array.isArray(prop) && prop.length > 0) {
            return prop;
          }
          if (typeof prop === 'string' && prop.trim()) {
            return [prop];
          }
        }
      }
    }

    return [];
  }
}

/**
 * Convenience function: Navigate to a page, intercept rails, and find tiles by entitlement.
 *
 * @param page - Playwright Page instance
 * @param url - URL to navigate to (e.g., 'https://stag.dazn.com/en-GB/home')
 * @param targetEntitlements - Entitlement IDs to search for (e.g., ['base_dazn_content'])
 * @param options - Additional options
 * @returns Matching tiles info
 *
 * @example
 * ```ts
 * const matches = await findTilesByEntitlementOnPage(page, baseUrl + '/home', ['base_dazn_content']);
 * if (matches.length > 0) {
 *   console.log(`Found tile "${matches[0].tileTitle}" in rail "${matches[0].railTitle}"`);
 *   // Now click the tile at position matches[0].railIndex, matches[0].tileIndex
 * }
 * ```
 */
export async function findTilesByEntitlementOnPage(
  page: Page,
  url: string,
  targetEntitlements: string[],
  options: { matchAll?: boolean; printSummary?: boolean; timeout?: number } = {}
): Promise<RailTileMatch[]> {
  const { matchAll = false, printSummary = false, timeout = 30000 } = options;

  const interceptor = new RailsInterceptor(page);

  const result = await interceptor.captureAllRailsResponses(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout }).catch(() => {});
  }, timeout);

  if (printSummary) {
    interceptor.printRailsSummary();
  }

  return interceptor.findTilesByEntitlement(targetEntitlements, matchAll);
}

/**
 * Click a tile on the page based on its position from the rails API response.
 *
 * @param page - Playwright Page instance
 * @param match - The RailTileMatch object from findTilesByEntitlement
 * @param railHeadingPattern - Optional regex pattern for the rail heading text (used to locate the rail on page)
 */
export async function clickTileByRailPosition(
  page: Page,
  match: RailTileMatch,
  railHeadingPattern?: RegExp
): Promise<void> {
  console.log(`🎯 [RailsInterceptor] Clicking tile "${match.tileTitle}" in rail "${match.railTitle}" (rail=${match.railIndex}, tile=${match.tileIndex})`);

  // Strategy 1: Find rail by its heading text
  if (railHeadingPattern || match.railTitle) {
    const pattern = railHeadingPattern || new RegExp(escapeRegex(match.railTitle), 'i');
    const railHeading = page.getByText(pattern).first();

    const headingVisible = await railHeading.isVisible({ timeout: 5000 }).catch(() => false);
    if (headingVisible) {
      console.log(`✅ [RailsInterceptor] Found rail heading: "${match.railTitle}"`);

      // Get the rail wrapper from the heading
      const railWrapper = railHeading.locator(
        'xpath=ancestor::section[1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"rail")][1]'
      );

      if (await railWrapper.count() > 0) {
        // Find tile by index within the rail
        const tiles = railWrapper.locator('a[class*="tile" i], div[class*="tile" i], a[href], div[class*="card" i]');
        const tileCount = await tiles.count();

        if (match.tileIndex < tileCount) {
          const targetTile = tiles.nth(match.tileIndex);
          await targetTile.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(300);
          await targetTile.click({ force: true });
          console.log(`✅ [RailsInterceptor] Clicked tile at index ${match.tileIndex} in rail "${match.railTitle}"`);
          return;
        }
      }
    }
  }

  // Strategy 2: Find tile by its title text on the page
  if (match.tileTitle) {
    const tileByText = page.locator(`a:has-text("${match.tileTitle}"), div:has-text("${match.tileTitle}")`).first();
    const tileVisible = await tileByText.isVisible({ timeout: 5000 }).catch(() => false);
    if (tileVisible) {
      await tileByText.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);
      await tileByText.click({ force: true });
      console.log(`✅ [RailsInterceptor] Clicked tile by title text: "${match.tileTitle}"`);
      return;
    }
  }

  // Strategy 3: Find tile by image alt text
  if (match.tileTitle) {
    const imgTile = page.locator(`img[alt*="${match.tileTitle}" i]`).first();
    const imgVisible = await imgTile.isVisible({ timeout: 3000 }).catch(() => false);
    if (imgVisible) {
      const tileLink = imgTile.locator('xpath=ancestor::a[1]');
      if (await tileLink.count() > 0) {
        await tileLink.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        await tileLink.click({ force: true });
        console.log(`✅ [RailsInterceptor] Clicked tile by image alt: "${match.tileTitle}"`);
        return;
      }
    }
  }

  throw new Error(`❌ [RailsInterceptor] Could not locate tile "${match.tileTitle}" on the page`);
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}