import { AndroidBasePage, AndroidFlowHooks, WdBrowser, WdElement, adbSwipe, adbTap, getScreenSize } from './AndroidBasePage';
import { navigateToPPVTile } from '../../utils/scheduleNavigator';
import { sendTvKeyevent, TV_KEYCODES } from '../../utils/androidTvControls';
import { parsePPVDate } from '../../utils/eventLoader';
import { normalizeAndroidTitle } from '../../utils/androidTitleNormalizer';

type ScheduleBounds = { x1: number; y1: number; x2: number; y2: number };
type ScheduleTile = ScheduleBounds & { label: string };

export class AndroidSchedulePage extends AndroidBasePage {
  private fireTvExitDialogDismissed = false;

  private async tapElementCenter(el: WdElement, label: string): Promise<boolean> {
    try {
      const rect = await el.getRect();
      adbTap(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
      await this.driver.pause(1500);
      console.log(`  ${label} tapped by center coordinates`);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForSchedulePage(timeoutMs = 8000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.dismissFireTvExitDialogIfPresent()) continue;
      if (await this.isSchedulePageVisible()) return true;
      await this.driver.pause(500);
    }

    return false;
  }

  private async dismissFireTvExitDialogIfPresent(): Promise<boolean> {
    if (!this.isFireTv()) return false;
    if (this.fireTvExitDialogDismissed) return false;

    const source = await this.driver.getPageSource().catch(() => '');
    if (!/Would you like to close DAZN\?|Close DAZN|Keep watching/.test(source)) {
      return false;
    }

    console.log('↩️ Dismissing Fire TV close-app popup with one Back before selecting Schedule...');
    sendTvKeyevent(TV_KEYCODES.BACK);
    this.fireTvExitDialogDismissed = true;
    await this.driver.pause(1500);
    return true;
  }

  private async isSchedulePageVisible(): Promise<boolean> {
    try {
      const source = await this.driver.getPageSource();
      const screen = getScreenSize();
      const hasBlockingOverlay = /Would you like to close DAZN\?|Close DAZN|Keep watching/.test(source);
      const isBoxingHome = /text="Introducing Ultimate"|text="Upcoming Fights"|text="The Locker Room"/.test(source);
      let hasScheduleHeading = false;
      let hasDateRail = false;
      let hasScheduleFilter = false;

      for (const match of source.matchAll(/<[^>]+>/g)) {
        const node = match[0];
        const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
        if (!label) continue;

        const bounds = this.getXmlBounds(node);
        if (!bounds) continue;

        const text = this.normalizeScheduleText(label);
        const isUpperContent = bounds.y1 <= Math.round(screen.height * 0.45);
        const isFilterRow = bounds.y1 >= Math.round(screen.height * 0.06) && bounds.y2 <= Math.round(screen.height * 0.36);

        if (text === 'schedule' && bounds.y1 <= Math.round(screen.height * 0.35)) hasScheduleHeading = true;
        if (isUpperContent && /^(previous|today|tomorrow|mon|tue|wed|thu|fri|sat|sun)$/.test(text)) hasDateRail = true;
        if (isFilterRow && /all sports?/.test(text)) hasScheduleFilter = true;
      }

      if (!hasBlockingOverlay && hasScheduleHeading && hasScheduleFilter && (hasDateRail || !this.isFireTv()) && !isBoxingHome) {
        console.log('✅ Schedule page assertion passed: Schedule heading + filter strip visible');
        return true;
      }
    } catch {}

    return false;
  }

  private isFireTv(): boolean {
    return String(process.env.TV_TARGET || '').toLowerCase().trim() === 'firetv';
  }

  private isAndroidTv(): boolean {
    return String(process.env.TV_TARGET || '').toLowerCase().trim() === 'androidtv';
  }

  private async getFocusedLabel(): Promise<string> {
    try {
      const focused = await this.driver.$('//*[@focused="true"]');
      if (await focused.isDisplayed({ timeout: 400 }).catch(() => false)) {
        const text = String(await focused.getText().catch(() => '')).trim();
        const desc = String(await focused.getAttribute('contentDescription').catch(() => '')).trim();
        return (text || desc || '').trim();
      }
    } catch {}

    return '';
  }

  private async pressScheduleKeyForFireTv(keyCode: number): Promise<void> {
    sendTvKeyevent(keyCode);
  }

  private normalizeScheduleText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private decodeXmlAttribute(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private getXmlAttribute(node: string, attribute: string): string {
    const match = node.match(new RegExp(`${attribute}="([^"]*)"`));
    return match ? this.decodeXmlAttribute(match[1]) : '';
  }

  private getXmlBounds(node: string): ScheduleBounds | null {
    const match = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!match) return null;

    return {
      x1: Number(match[1]),
      y1: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
    };
  }

  private async isFireTvPpvPaywallVisible(ppvName = this.ppvName): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const lowerSource = source.toLowerCase();
    const hasPpvName = this.normalizeScheduleText(source).includes(this.normalizeScheduleText(ppvName));
    const hasTvPurchaseMessage = lowerSource.includes('my account') && lowerSource.includes('purchase this event');
    const hasPaywallCloseButton = /text="Close"/.test(source);

    return hasPpvName && hasTvPurchaseMessage && hasPaywallCloseButton;
  }

  private async isTvStillOnScheduleSurface(ppvName = this.ppvName): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const hasScheduleChrome = /text="Schedule"|content-desc="Schedule"|text="Previous"|text="Boxing"|text="Chess"/.test(source);
    const hasScheduleContent =
      this.normalizeScheduleText(source).includes(this.normalizeScheduleText(ppvName)) ||
      /text="Sat"|text="Sun"|text="Mon"|text="Tue"|text="Wed"|text="Thu"|text="Fri"|text="Aug"|text="Sep"|text="Oct"/.test(source);

    return hasScheduleChrome && hasScheduleContent;
  }

  private isTvLocationUnavailableDialogVisible(source: string): boolean {
    const lowerSource = source.toLowerCase();
    return lowerSource.includes('current location') || lowerSource.includes('not available to you');
  }

  private getVisibleTvScheduleTiles(source: string): ScheduleTile[] {
    const screen = getScreenSize();
    const tiles: ScheduleTile[] = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!label || !label.includes(' vs. ')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isVisibleTile =
        bounds.x1 >= Math.round(screen.width * 0.08) &&
        bounds.y1 >= Math.round(screen.height * 0.22) &&
        bounds.x2 > bounds.x1 &&
        bounds.y2 > bounds.y1 &&
        (bounds.x2 - bounds.x1) >= Math.round(screen.width * 0.12) &&
        (bounds.y2 - bounds.y1) >= Math.round(screen.height * 0.12);

      if (isVisibleTile) {
        tiles.push({ label, ...bounds });
      }
    }

    return tiles.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  }

  private getFocusedTvScheduleTile(source: string, tiles: ScheduleTile[]): ScheduleTile | undefined {
    const screen = getScreenSize();

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      if (!/focused="true"/.test(node)) continue;

      const focusedBounds = this.getXmlBounds(node);
      if (!focusedBounds) continue;
      if ((focusedBounds.x2 - focusedBounds.x1) > Math.round(screen.width * 0.75)) continue;
      if ((focusedBounds.y2 - focusedBounds.y1) > Math.round(screen.height * 0.75)) continue;

      const focusedCenterX = Math.round((focusedBounds.x1 + focusedBounds.x2) / 2);
      const focusedCenterY = Math.round((focusedBounds.y1 + focusedBounds.y2) / 2);
      const focusedTile = tiles.find(tile =>
        focusedCenterX >= tile.x1 &&
        focusedCenterX <= tile.x2 &&
        focusedCenterY >= tile.y1 &&
        focusedCenterY <= tile.y2
      );

      if (focusedTile) return focusedTile;
    }

    return undefined;
  }

  private getGridIndex(value: number, centers: number[]): number {
    return centers.findIndex(center => Math.abs(center - value) <= 120);
  }

  private async moveTvFocusToScheduleTile(fromTile: ScheduleTile, targetTile: ScheduleTile, tiles: ScheduleTile[]): Promise<void> {
    const uniqueCenters = (values: number[]) => values
      .sort((a, b) => a - b)
      .reduce<number[]>((centers, value) => {
        if (!centers.some(center => Math.abs(center - value) <= 120)) centers.push(value);
        return centers;
      }, []);
    const centerX = (tile: ScheduleBounds) => Math.round((tile.x1 + tile.x2) / 2);
    const centerY = (tile: ScheduleBounds) => Math.round((tile.y1 + tile.y2) / 2);
    const columns = uniqueCenters(tiles.map(centerX));
    const rows = uniqueCenters(tiles.map(centerY));
    const fromColumn = this.getGridIndex(centerX(fromTile), columns);
    const targetColumn = this.getGridIndex(centerX(targetTile), columns);
    const fromRow = this.getGridIndex(centerY(fromTile), rows);
    const targetRow = this.getGridIndex(centerY(targetTile), rows);

    if (fromColumn < 0 || targetColumn < 0 || fromRow < 0 || targetRow < 0) {
      throw new Error(`TV Schedule debug: could not map visible tile grid from "${fromTile.label}" to "${targetTile.label}".`);
    }

    console.log(`  TV moving focus from "${fromTile.label}" to "${targetTile.label}" by remote keys.`);

    for (let step = 0; step < Math.abs(targetRow - fromRow); step++) {
      sendTvKeyevent(targetRow > fromRow ? TV_KEYCODES.DPAD_DOWN : TV_KEYCODES.DPAD_UP);
      await this.driver.pause(700);
    }

    for (let step = 0; step < Math.abs(targetColumn - fromColumn); step++) {
      sendTvKeyevent(targetColumn > fromColumn ? TV_KEYCODES.DPAD_RIGHT : TV_KEYCODES.DPAD_LEFT);
      await this.driver.pause(700);
    }
  }

  private async tapExactVisiblePpvTileForFireTv(ppvName = this.ppvName): Promise<void> {
    console.log(`Fire TV Schedule debug: clicking exact visible PPV tile: ${ppvName}`);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_before_exact_tile_click.png').catch(() => {});

    const source = await this.driver.getPageSource().catch(() => '');
    const target = this.normalizeScheduleText(ppvName);
    const candidates: Array<{ label: string; x1: number; y1: number; x2: number; y2: number }> = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const text = this.getXmlAttribute(node, 'text');
      const desc = this.getXmlAttribute(node, 'content-desc');
      const label = text || desc;
      if (this.normalizeScheduleText(label) !== target) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;
      candidates.push({ label, ...bounds });
    }

    const tile = candidates
      .filter(candidate => candidate.x2 > candidate.x1 && candidate.y2 > candidate.y1)
      .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)[0];

    if (!tile) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_exact_tile_not_visible.png').catch(() => {});
      throw new Error(`Fire TV Schedule debug: exact PPV tile not visible on the checked date: ${ppvName}`);
    }

    const tapX = Math.round((tile.x1 + tile.x2) / 2);
    const tapY = Math.round((tile.y1 + tile.y2) / 2);
    console.log(`✅ Fire TV Schedule debug: exact tile found: "${tile.label}" at [${tile.x1},${tile.y1}][${tile.x2},${tile.y2}]`);
    adbTap(tapX, tapY);

    const firstOpenDeadline = Date.now() + 2500;
    while (Date.now() < firstOpenDeadline) {
      await this.driver.pause(500);
      if (await this.isFireTvPpvPaywallVisible(ppvName)) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened paywall: ${ppvName}`);
        return;
      }

      if (!await this.isSchedulePageVisible()) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened: ${ppvName}`);
        return;
      }
    }

    console.log('  Exact PPV tile selected but paywall not open yet. Pressing Center once to activate it...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_CENTER);

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await this.driver.pause(500);
      if (await this.isFireTvPpvPaywallVisible(ppvName)) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened paywall: ${ppvName}`);
        return;
      }

      if (!await this.isSchedulePageVisible()) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened: ${ppvName}`);
        return;
      }
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_exact_tile_click_no_navigation.png').catch(() => {});
    throw new Error(`Fire TV Schedule debug: tapped exact PPV tile but Schedule page is still visible: ${ppvName}`);
  }

  private async isBoxingHighlightedForFireTv(): Promise<boolean> {
    const selectors = [
      'android=new UiSelector().text("Boxing").selected(true)',
      'android=new UiSelector().textContains("Boxing").selected(true)',
      'android=new UiSelector().text("Boxing").focused(true)',
      'android=new UiSelector().textContains("Boxing").focused(true)',
    ];

    for (const selector of selectors) {
      const visible = await this.driver
        .$(selector)
        .isDisplayed({ timeout: 500 })
        .catch(() => false);
      if (visible) return true;
    }

    try {
      const boxingEl = await this.driver.$('android=new UiSelector().textContains("Boxing")');
      if (!await boxingEl.isDisplayed({ timeout: 500 }).catch(() => false)) return false;
      const selected = String(await boxingEl.getAttribute('selected').catch(() => '')).toLowerCase();
      const focused = String(await boxingEl.getAttribute('focused').catch(() => '')).toLowerCase();
      return selected === 'true' || focused === 'true';
    } catch {
      return false;
    }
  }

  private async getVisibleBoxingFilterBoundsForFireTv(): Promise<{ x1: number; y1: number; x2: number; y2: number } | null> {
    const source = await this.driver.getPageSource().catch(() => '');
    const screen = getScreenSize();

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!this.normalizeScheduleText(label).includes('boxing')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isFilterRow =
        bounds.y1 >= Math.round(screen.height * 0.10) &&
        bounds.y2 <= Math.round(screen.height * 0.36);

      if (isFilterRow) return bounds;
    }

    return null;
  }

  private async isFocusedFilterOnBoxingForFireTv(): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const screen = getScreenSize();
    const boxingBounds = await this.getVisibleBoxingFilterBoundsForFireTv();
    if (!boxingBounds) return false;

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      if (!/focused="true"/.test(node)) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isFilterRow =
        bounds.y1 >= Math.round(screen.height * 0.10) &&
        bounds.y2 <= Math.round(screen.height * 0.36);

      if (!isFilterRow) continue;

      const focusX = Math.round((bounds.x1 + bounds.x2) / 2);
      const focusY = Math.round((bounds.y1 + bounds.y2) / 2);
      if (
        focusX >= boxingBounds.x1 &&
        focusX <= boxingBounds.x2 &&
        focusY >= boxingBounds.y1 &&
        focusY <= boxingBounds.y2
      ) {
        return true;
      }
    }

    return false;
  }

  private getConfiguredPpvDate(eventConfig?: any): string | undefined {
    const region = String(process.env.DAZN_REGION || '').toUpperCase().trim();
    return eventConfig?.regions?.[region]?.PPV_DATE || eventConfig?.global?.PPV_DATE;
  }

  private isConfiguredPpvDateVisibleInSource(source: string, ppvDate: string): boolean {
    const parsedDate = parsePPVDate(ppvDate);
    const targetDay = String(parsedDate.day);
    const targetMonth = parsedDate.month.toLowerCase();
    const targetMonthShort = targetMonth.slice(0, 3);
    const stripOrdinals = (value: string) => value.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
    const monthDayPattern = new RegExp(`\\b${targetMonthShort}[a-z]*\\s+${targetDay}\\b`, 'i');
    const dayMonthPattern = new RegExp(`\\b${targetDay}\\s+${targetMonthShort}[a-z]*\\b`, 'i');
    const screen = getScreenSize();

    const dateNodes: Array<ScheduleBounds & { text: string }> = [];
    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      if (!/displayed="true"/.test(node)) continue;

      const text = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!text) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;
      if (bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1) continue;
      if (bounds.y2 < Math.round(screen.height * 0.16) || bounds.y1 > Math.round(screen.height * 0.95)) continue;

      dateNodes.push({ text: stripOrdinals(this.normalizeScheduleText(text)), ...bounds });
    }

    if (dateNodes.some(node => monthDayPattern.test(node.text) || dayMonthPattern.test(node.text))) {
      return true;
    }

    const dayNodes = dateNodes.filter(node => node.text === targetDay);
    const monthNodes = dateNodes.filter(node => node.text === targetMonthShort || node.text === targetMonth);

    return dayNodes.some(dayNode => monthNodes.some(monthNode => {
      const sameDateColumn = Math.abs(((dayNode.x1 + dayNode.x2) / 2) - ((monthNode.x1 + monthNode.x2) / 2)) <= 80;
      const closeDateStack = Math.abs(((dayNode.y1 + dayNode.y2) / 2) - ((monthNode.y1 + monthNode.y2) / 2)) <= 120;
      return sameDateColumn && closeDateStack;
    }));
  }

  private async moveDownAndAssertPpvDateForFireTv(eventConfig?: any): Promise<void> {
    console.log('Fire TV Schedule debug: moving Down from Boxing to check PPV date first...');
    sendTvKeyevent(TV_KEYCODES.DPAD_DOWN);
    await this.driver.pause(1200);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_after_boxing_down.png').catch(() => {});

    const ppvDate = this.getConfiguredPpvDate(eventConfig);
    if (!ppvDate) {
      console.warn('Fire TV Schedule debug: PPV_DATE not configured, skipping date assertion.');
      return;
    }

    const parsedDate = parsePPVDate(ppvDate);
    const targetDay = String(parsedDate.day);
    const targetMonth = parsedDate.month.toLowerCase();
    const targetMonthShort = targetMonth.slice(0, 3);
    const monthDayPattern = new RegExp(`\\b${targetMonthShort}[a-z]*\\s+${targetDay}\\b`, 'i');
    const dayMonthPattern = new RegExp(`\\b${targetDay}\\s+${targetMonthShort}[a-z]*\\b`, 'i');
    const deadline = Date.now() + 6000;

    while (Date.now() < deadline) {
      const source = await this.driver.getPageSource().catch(() => '');
      const visibleTexts = Array.from(source.matchAll(/(?:text|content-desc)="([^"]+)"/g), match => match[1].trim());
      const dateVisible = visibleTexts.some(text => {
        const lower = text.toLowerCase().replace(/\s+/g, ' ').trim();
        return lower === targetDay ||
          lower.includes(`${targetDay} ${targetMonthShort}`) ||
          lower.includes(`${targetMonthShort} ${targetDay}`) ||
          lower.includes(`${targetDay} ${targetMonth}`) ||
          lower.includes(`${targetMonth} ${targetDay}`) ||
          monthDayPattern.test(lower) ||
          dayMonthPattern.test(lower);
      });

      if (dateVisible) {
        console.log(`✅ Fire TV Schedule debug: PPV date visible before tile search: ${ppvDate}`);
        return;
      }

      await this.driver.pause(500);
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_ppv_date_not_visible.png').catch(() => {});
    throw new Error(`Fire TV Schedule debug: PPV date not visible after pressing Down from Boxing: ${ppvDate}`);
  }

  private async moveDownAndAssertPpvDateForAndroidTv(eventConfig?: any): Promise<void> {
    console.log('Android TV Schedule debug: moving Down to check PPV date before tile search...');
    await this.driver.saveScreenshot('./test-results/androidtv_schedule_after_boxing_down.png').catch(() => {});

    const ppvDate = this.getConfiguredPpvDate(eventConfig);
    if (!ppvDate) {
      console.warn('Android TV Schedule debug: PPV_DATE not configured, skipping date assertion.');
      return;
    }

    const maxAttempts = Math.max(1, Number(process.env.ANDROIDTV_SCHEDULE_DATE_DOWN_PRESSES || '25'));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const sourceBeforeDown = await this.driver.getPageSource().catch(() => '');
      if (this.isConfiguredPpvDateVisibleInSource(sourceBeforeDown, ppvDate)) {
        console.log(`✅ Android TV Schedule debug: PPV date "${ppvDate}" found before DOWN press ${attempt + 1}.`);
        await this.driver.saveScreenshot('./test-results/androidtv_schedule_ppv_date_found.png').catch(() => {});
        return;
      }

      sendTvKeyevent(TV_KEYCODES.DPAD_DOWN);
      await this.driver.pause(1200);

      const pageSource = await this.driver.getPageSource().catch(() => '');
      if (this.isConfiguredPpvDateVisibleInSource(pageSource, ppvDate)) {
        console.log(`✅ Android TV Schedule debug: PPV date "${ppvDate}" found after ${attempt + 1} DOWN press(es).`);
        await this.driver.saveScreenshot('./test-results/androidtv_schedule_ppv_date_found.png').catch(() => {});
        return;
      }

      console.log(`Android TV Schedule debug: DOWN press ${attempt + 1}: PPV date not visible yet.`);
    }

    await this.driver.saveScreenshot('./test-results/androidtv_schedule_ppv_date_not_visible.png').catch(() => {});
    throw new Error(`Android TV Schedule debug: PPV date not visible after ${maxAttempts} DOWN press(es): ${ppvDate}`);
  }

  private async tapExactVisiblePpvTileForAndroidTv(ppvName = this.ppvName): Promise<void> {
    console.log(`Android TV Schedule debug: clicking exact visible PPV tile: ${ppvName}`);
    await this.driver.saveScreenshot('./test-results/androidtv_schedule_before_exact_tile_click.png').catch(() => {});

    const source = await this.driver.getPageSource().catch(() => '');
    const target = this.normalizeScheduleText(ppvName);
    const tiles = this.getVisibleTvScheduleTiles(source);
    const tile = tiles
      .filter(candidate => this.normalizeScheduleText(candidate.label) === target)
      .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)[0];

    if (!tile) {
      await this.driver.saveScreenshot('./test-results/androidtv_schedule_exact_tile_not_visible.png').catch(() => {});
      throw new Error(`Android TV Schedule debug: exact PPV tile not visible on the checked date: ${ppvName}`);
    }

    console.log(`✅ Android TV Schedule debug: exact tile found: "${tile.label}" at [${tile.x1},${tile.y1}][${tile.x2},${tile.y2}]`);
    const focusedTile = this.getFocusedTvScheduleTile(source, tiles) || tiles[0];
    await this.moveTvFocusToScheduleTile(focusedTile, tile, tiles);
    await this.driver.saveScreenshot('./test-results/androidtv_schedule_before_target_center.png').catch(() => {});

    const sourceBeforeCenter = await this.driver.getPageSource().catch(() => '');
    if (this.isTvLocationUnavailableDialogVisible(sourceBeforeCenter)) {
      await this.driver.saveScreenshot('./test-results/androidtv_schedule_location_unavailable_before_center.png').catch(() => {});
      throw new Error(`Android TV Schedule debug: location unavailable dialog appeared before opening target PPV tile: ${ppvName}`);
    }

    console.log('  Pressing Center on the exact Android TV PPV tile...');
    sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await this.driver.pause(500);

      const currentSource = await this.driver.getPageSource().catch(() => '');
      if (this.isTvLocationUnavailableDialogVisible(currentSource)) {
        await this.driver.saveScreenshot('./test-results/androidtv_schedule_location_unavailable_after_center.png').catch(() => {});
        throw new Error(`Android TV Schedule debug: opening "${ppvName}" showed the location unavailable dialog.`);
      }

      if (await this.isFireTvPpvPaywallVisible(ppvName)) {
        console.log(`✅ Android TV Schedule debug: exact PPV tile opened paywall: ${ppvName}`);
        return;
      }

      if (!await this.isTvStillOnScheduleSurface(ppvName)) {
        console.log(`✅ Android TV Schedule debug: exact PPV tile opened: ${ppvName}`);
        return;
      }
    }

    await this.driver.saveScreenshot('./test-results/androidtv_schedule_exact_tile_click_no_navigation.png').catch(() => {});
    throw new Error(`Android TV Schedule debug: tapped exact PPV tile but Schedule page is still visible: ${ppvName}`);
  }

  private async tapScheduleFromFireTvLeftNav(): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const screen = getScreenSize();
    const candidates: Array<{ label: string; x1: number; y1: number; x2: number; y2: number }> = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!this.normalizeScheduleText(label).includes('schedule')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isLeftNavLabel =
        bounds.x1 <= Math.round(screen.width * 0.18) &&
        bounds.x2 <= Math.round(screen.width * 0.24) &&
        bounds.y1 >= Math.round(screen.height * 0.40) &&
        bounds.y2 <= Math.round(screen.height * 0.78);

      if (isLeftNavLabel) {
        candidates.push({ label, ...bounds });
      }
    }

    for (const candidate of candidates.sort((a, b) => a.y1 - b.y1)) {
      const tapX = Math.min(Math.round(screen.width * 0.13), Math.max(candidate.x2 + 40, candidate.x1));
      const tapY = Math.round((candidate.y1 + candidate.y2) / 2);
      console.log(`  Fire TV left nav Schedule candidate: "${candidate.label}" at [${candidate.x1},${candidate.y1}][${candidate.x2},${candidate.y2}], tapping row (${tapX}, ${tapY})`);
      adbTap(tapX, tapY);
      await this.driver.pause(3000);
      if (await this.waitForSchedulePage(45000)) {
        console.log('Schedule selected from Fire TV left navigation via Schedule row bounds');
        await this.driver.saveScreenshot('./test-results/after_schedule_click.png').catch(() => {});
        return true;
      }
    }

    return false;
  }

  private async focusAndClickBoxingForFireTv(): Promise<void> {
    console.log('Fire TV Schedule flow: highlighting Boxing filter...');
    await this.driver.pause(1200);

    console.log('  Moving Up once to place focus on the Schedule filter row...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_UP);
    await this.driver.pause(900);

    let focusedLabel = '';
    let boxingFocused = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      focusedLabel = (await this.getFocusedLabel()).toLowerCase();
      boxingFocused =
        focusedLabel.includes('boxing') ||
        await this.isBoxingHighlightedForFireTv() ||
        await this.isFocusedFilterOnBoxingForFireTv();

      if (boxingFocused) break;

      console.log(`  Boxing not focused yet. Current focus: ${focusedLabel || 'unknown'}. Moving Right (${attempt + 1}/5)...`);
      await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_RIGHT);
      await this.driver.pause(700);
    }

    focusedLabel = (await this.getFocusedLabel()).toLowerCase();
    boxingFocused =
      boxingFocused ||
      focusedLabel.includes('boxing') ||
      await this.isBoxingHighlightedForFireTv() ||
      await this.isFocusedFilterOnBoxingForFireTv();

    if (!boxingFocused) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_not_highlighted.png').catch(() => {});
      console.warn(`⚠️ Boxing focus metadata did not update after moving Right. Continuing to PPV date check. Focused label was "${focusedLabel || 'unknown'}".`);
      return;
    }

    console.log('✅ Boxing focused in Schedule filter row. Clicking Boxing...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_CENTER);
    await this.driver.pause(1500);

    const boxingSelected = await this.isBoxingHighlightedForFireTv();

    if (!boxingSelected) {
      const focusedAfterClick = (await this.getFocusedLabel()).toLowerCase();
      if (!focusedAfterClick.includes('boxing')) {
        console.warn(`⚠️ Boxing click did not update Fire TV focus metadata. Continuing to PPV date check. Focused label: "${focusedAfterClick || 'unknown'}".`);
      }
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_selected.png').catch(() => {});
    console.log('✅ Boxing clicked on Schedule page');
  }

  private async focusAndClickBoxingForAndroidTv(): Promise<void> {
    console.log('Android TV Schedule flow: highlighting Boxing filter...');
    await this.waitForSchedulePage(30000);
    await this.driver.pause(1200);

    console.log('  Moving Up once to place focus on the Schedule filter row...');
    sendTvKeyevent(TV_KEYCODES.DPAD_UP);
    await this.driver.pause(900);

    let focusedLabel = '';
    let boxingFocused = false;
    const rightPresses = Math.max(1, Number(process.env.ANDROIDTV_BOXING_RIGHT_PRESSES || '5'));
    for (let attempt = 0; attempt < rightPresses; attempt++) {
      focusedLabel = (await this.getFocusedLabel()).toLowerCase();
      boxingFocused =
        focusedLabel.includes('boxing') ||
        await this.isBoxingHighlightedForFireTv() ||
        await this.isFocusedFilterOnBoxingForFireTv();

      if (boxingFocused) break;

      console.log(`  Boxing not focused yet. Current focus: ${focusedLabel || 'unknown'}. Moving Right (${attempt + 1}/${rightPresses})...`);
      sendTvKeyevent(TV_KEYCODES.DPAD_RIGHT);
      await this.driver.pause(700);
    }

    focusedLabel = (await this.getFocusedLabel()).toLowerCase();
    boxingFocused =
      boxingFocused ||
      focusedLabel.includes('boxing') ||
      await this.isBoxingHighlightedForFireTv() ||
      await this.isFocusedFilterOnBoxingForFireTv();

    if (!boxingFocused) {
      await this.driver.saveScreenshot('./test-results/androidtv_schedule_boxing_not_highlighted.png').catch(() => {});
      console.warn(`Android TV Boxing focus metadata did not update after moving Right. Continuing to PPV date check. Focused label was "${focusedLabel || 'unknown'}".`);
      return;
    }

    console.log('Android TV Boxing focused in Schedule filter row. Clicking Boxing...');
    sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);
    await this.driver.pause(1500);

    const boxingSelected = await this.isBoxingHighlightedForFireTv();
    if (!boxingSelected) {
      const focusedAfterClick = (await this.getFocusedLabel()).toLowerCase();
      if (!focusedAfterClick.includes('boxing')) {
        console.warn(`Android TV Boxing click did not update focus metadata. Continuing to PPV date check. Focused label: "${focusedAfterClick || 'unknown'}".`);
      }
    }

    await this.driver.saveScreenshot('./test-results/androidtv_schedule_boxing_selected.png').catch(() => {});
    console.log('✅ Android TV Boxing clicked on Schedule page');
  }

  private async navigateFireTvLeftNavToSchedule(): Promise<boolean> {
    console.log('Fire TV Schedule flow: opening left navigation and selecting Schedule...');
    this.fireTvExitDialogDismissed = false;

    sendTvKeyevent(TV_KEYCODES.DPAD_LEFT);
    await this.driver.pause(1200);

    if (await this.tapScheduleFromFireTvLeftNav()) {
      return true;
    }

    await this.driver.saveScreenshot('./test-results/firetv_left_nav_schedule_not_ready.png').catch(() => {});
    console.log('  Fire TV left navigation Schedule selection did not complete.');
    return false;
  }

  private async navigateAndroidTvLeftNavToSchedule(): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    if (!/Schedule|Press ‘back’ to go to main menu|All sports|Live TV/.test(source)) return false;

    const screen = getScreenSize();
    const candidates: ScheduleTile[] = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!this.normalizeScheduleText(label).includes('schedule')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isLeftNavLabel =
        bounds.x1 <= Math.round(screen.width * 0.22) &&
        bounds.x2 <= Math.round(screen.width * 0.32) &&
        bounds.y1 >= Math.round(screen.height * 0.30) &&
        bounds.y2 <= Math.round(screen.height * 0.86);

      if (isLeftNavLabel) {
        candidates.push({ label, ...bounds });
      }
    }

    for (const candidate of candidates.sort((a, b) => a.y1 - b.y1)) {
      const tapX = Math.min(Math.round(screen.width * 0.16), Math.max(candidate.x2 + 40, candidate.x1));
      const tapY = Math.round((candidate.y1 + candidate.y2) / 2);
      console.log(`  Android TV left nav Schedule candidate: "${candidate.label}" at [${candidate.x1},${candidate.y1}][${candidate.x2},${candidate.y2}], tapping row (${tapX}, ${tapY})`);
      adbTap(tapX, tapY);
      await this.driver.pause(3000);
      if (await this.waitForSchedulePage(30000)) {
        console.log('Schedule selected from Android TV left navigation via Schedule row bounds');
        await this.driver.saveScreenshot('./test-results/after_schedule_click.png').catch(() => {});
        return true;
      }
    }

    const scheduleSelectors = [
      'android=new UiSelector().textContains("Schedule")',
      'android=new UiSelector().descriptionContains("Schedule")',
      '//android.widget.TextView[contains(@text,"Schedule")]',
      '//*[contains(@content-desc,"Schedule")]',
    ];

    for (const selector of scheduleSelectors) {
      try {
        const scheduleEl = await this.driver.$(selector);
        if (!await scheduleEl.isDisplayed({ timeout: 1000 }).catch(() => false)) continue;

        console.log(`  Android TV left nav Schedule candidate found via ${selector}`);
        await scheduleEl.click().catch(() => undefined);
        await this.driver.pause(2500);
        if (await this.waitForSchedulePage(30000)) {
          console.log('Schedule selected from Android TV left navigation');
          await this.driver.saveScreenshot('./test-results/after_schedule_click.png').catch(() => {});
          return true;
        }

        if (await this.tapElementCenter(scheduleEl, 'Android TV left nav Schedule')) {
          if (await this.waitForSchedulePage(30000)) {
            console.log('Schedule selected from Android TV left navigation');
            await this.driver.saveScreenshot('./test-results/after_schedule_click.png').catch(() => {});
            return true;
          }
        }
      } catch {}
    }

    return false;
  }

  async navigate(): Promise<void> {
    console.log('Navigating to Schedule tab...');

    if (this.isFireTv()) {
      if (await this.navigateFireTvLeftNavToSchedule()) {
        return;
      }
      console.log('Could not navigate to Schedule tab from Fire TV left navigation');
      return;
    }

    if (this.isAndroidTv() && await this.navigateAndroidTvLeftNavToSchedule()) {
      return;
    }

    await this.driver.saveScreenshot('./test-results/before_schedule_click.png');

    console.log('  Looking for Schedule button by text/description...');
    const scheduleSelectors = [
      'android=new UiSelector().text("Schedule")',
      'android=new UiSelector().textMatches("(?i)^schedule$")',
      'android=new UiSelector().textContains("Schedule")',
      'android=new UiSelector().descriptionContains("Schedule")',
      '//android.widget.TextView[@text="Schedule"]',
      '//android.widget.TextView[contains(@text,"Schedule")]',
      '//*[@content-desc[contains(.,"Schedule")]]',
    ];

    for (const selector of scheduleSelectors) {
      try {
        const scheduleEl = await this.driver.$(selector);
        if (!await scheduleEl.isDisplayed({ timeout: 1000 }).catch(() => false)) continue;

        console.log(`  Found Schedule candidate: ${selector}`);
        await scheduleEl.click().catch(() => undefined);
        await this.driver.pause(2000);
        if (await this.waitForSchedulePage(this.isFireTv() ? 45000 : 5000)) {
          console.log('Schedule tab clicked successfully');
          await this.driver.saveScreenshot('./test-results/after_schedule_click.png');
          return;
        }

        if (await this.tapElementCenter(scheduleEl, 'Schedule')) {
          if (await this.waitForSchedulePage(this.isFireTv() ? 45000 : 5000)) {
            console.log('Schedule tab clicked successfully');
            await this.driver.saveScreenshot('./test-results/after_schedule_click.png');
            return;
          }
        }
      } catch {
        console.log(`  Schedule candidate not usable: ${selector}`);
      }
    }

    console.log('  Taking screenshot to see home page layout...');
    await this.driver.saveScreenshot('./test-results/home_page_before_schedule.png');

    if (this.isFireTv()) {
      console.log('Could not navigate to Schedule tab from Fire TV left navigation');
      return;
    }

    if (this.isAndroidTv()) {
      console.log('Could not navigate to Schedule tab from Android TV selectors. Skipping coordinate fallback to avoid tapping before the page is ready.');
      return;
    }

    const screenSize = getScreenSize();
    const bottomNavY = Math.round(screenSize.height * 0.92);
    const scheduleX = Math.round(screenSize.width * 0.70);
    console.log(`  Tapping Schedule at coordinates (${scheduleX}, ${bottomNavY})`);
    adbTap(scheduleX, bottomNavY);
    await this.driver.pause(3000);
    await this.driver.saveScreenshot('./test-results/after_schedule_click.png');

    if (await this.waitForSchedulePage(this.isFireTv() ? 45000 : 5000)) {
      console.log('Schedule tab clicked successfully');
      return;
    }

    console.log('Could not navigate to Schedule tab');
  }

  async scrollToPPVTile(ppvName = this.ppvName): Promise<WdElement | null> {
    console.log(`  Target PPV: ${ppvName}`);
    const normaliseTitle = (value: string) => normalizeAndroidTitle(value, ' ').replace(/\s+/g, ' ').trim();
    const expectedTitle = normaliseTitle(ppvName);
    console.log('  Step 1: Fast scroll to July...');

    for (let i = 0; i < 20; i++) {
      if (await this.isVisible('July', 300) || await this.isVisible('JUL', 300)) {
        console.log(`  Found July (step ${i + 1})`);
        break;
      }
      const screen = getScreenSize();
      adbSwipe(
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.75),
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.20),
      );
      await this.driver.pause(500);
    }

    await this.driver.pause(1000);
    console.log('  Step 2: Searching July for PPV...');

    for (let i = 0; i < 20; i++) {
      try {
        const textViews = await this.driver.$$('android=new UiSelector().className("android.widget.TextView")').catch(() => []);
        let ppvEl: WdElement | null = null;

        // Try exact match first
        for (const el of textViews) {
          const txt = await el.getText().catch(() => '');
          if (normaliseTitle(txt) === expectedTitle) {
            ppvEl = el;
            break;
          }
        }

        // Try contains check excluding ancillary keywords
        if (!ppvEl) {
          for (const el of textViews) {
            const txt = await el.getText().catch(() => '');
            const lower = normaliseTitle(txt);
            if (
              lower.includes(expectedTitle) &&
              !lower.includes('weigh') &&
              !lower.includes('press') &&
              !lower.includes('media') &&
              !lower.includes('workout') &&
              !lower.includes('undercard')
            ) {
              ppvEl = el;
              break;
            }
          }
        }

        if (ppvEl && await ppvEl.isDisplayed()) {
          console.log(`Found "${ppvName}" (step ${i + 1})`);
          const rect = await ppvEl.getRect();
          const screenH = getScreenSize().height;
          const bottomNavThreshold = screenH * 0.75;

          if (rect.y > bottomNavThreshold) {
            console.log(`  Tile at y=${rect.y}, scrolling to center...`);
            const screen = getScreenSize();
            adbSwipe(
              Math.round(screen.width / 2),
              Math.round(screenH * 0.75),
              Math.round(screen.width / 2),
              Math.round(screenH * 0.55),
            );
            await this.driver.pause(500);

            adbSwipe(
              Math.round(screen.width / 2),
              Math.round(screenH * 0.7),
              Math.round(screen.width / 2),
              Math.round(screenH * 0.3),
            );
            await this.driver.pause(1500);

            let centeredEl: WdElement | null = null;
            const updatedViews = await this.driver.$$('android=new UiSelector().className("android.widget.TextView")').catch(() => []);
            for (const el of updatedViews) {
              const txt = await el.getText().catch(() => '');
              if (normaliseTitle(txt) === expectedTitle) {
                centeredEl = el;
                break;
              }
            }
            if (!centeredEl) {
              for (const el of updatedViews) {
                const txt = await el.getText().catch(() => '');
                const lower = normaliseTitle(txt);
                if (
                  lower.includes(expectedTitle) &&
                  !lower.includes('weigh') &&
                  !lower.includes('press') &&
                  !lower.includes('media') &&
                  !lower.includes('workout') &&
                  !lower.includes('undercard')
                ) {
                  centeredEl = el;
                  break;
                }
              }
            }

            if (centeredEl && await centeredEl.isDisplayed()) {
              const newRect = await centeredEl.getRect();
              console.log(`  Tile centered at y=${newRect.y}`);
              return centeredEl;
            }
          }

          return ppvEl;
        }
      } catch {}

      if (await this.isVisible('August', 200) || await this.isVisible('AUG', 200)) {
        console.log('  Reached August - stopping');
        break;
      }

      const screen = getScreenSize();
      adbSwipe(
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.55),
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.45),
      );
      await this.driver.pause(800);
    }

    return null;
  }

  async clickSportFilterIfPresent(eventConfig?: any): Promise<void> {
    const configuredSport = typeof eventConfig === 'string'
      ? eventConfig
      : eventConfig?.SPORT || eventConfig?.global?.SPORT || process.env.SPORT || 'Boxing';
    const targetSport = String(configuredSport).trim() || 'Boxing';
    const targetFilterText = this.normalizeScheduleText(targetSport);

    console.log(`Finding ${targetSport} filter on Schedule page...`);
    const screen = getScreenSize();
    const minFilterY = Math.round(screen.height * 0.06);
    const maxFilterY = Math.round(screen.height * 0.34);

    const getCenterY = (bounds: ScheduleBounds): number => Math.round((bounds.y1 + bounds.y2) / 2);
    const getCenterX = (bounds: ScheduleBounds): number => Math.round((bounds.x1 + bounds.x2) / 2);
    const readVisibleFilterChips = async (railY?: number): Promise<Array<{ label: string; bounds: ScheduleBounds }>> => {
      const source = await this.driver.getPageSource().catch(() => '');
      const chips: Array<{ label: string; bounds: ScheduleBounds }> = [];
      const seen = new Set<string>();

      for (const match of source.matchAll(/<[^>]+>/g)) {
        const node = match[0];
        const label = (this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc')).trim();
        if (!label) continue;

        const bounds = this.getXmlBounds(node);
        if (!bounds) continue;
        if (bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1) continue;
        if (bounds.x2 <= 0 || bounds.x1 >= screen.width) continue;

        const centerY = getCenterY(bounds);
        if (centerY < minFilterY || centerY > maxFilterY) continue;
        if (railY && Math.abs(centerY - railY) > Math.round(screen.height * 0.08)) continue;

        const text = this.normalizeScheduleText(label);
        if (!text || text === 'schedule') continue;

        const key = `${text}:${bounds.x1}:${bounds.y1}:${bounds.x2}:${bounds.y2}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chips.push({ label, bounds });
      }

      return chips.sort((a, b) => a.bounds.x1 - b.bounds.x1);
    };

    const findTargetFilter = (chips: Array<{ label: string; bounds: ScheduleBounds }>) =>
      chips.find(chip => this.normalizeScheduleText(chip.label) === targetFilterText);

    const describeFilters = (chips: Array<{ label: string; bounds: ScheduleBounds }>): string =>
      chips.length ? chips.map(chip => `"${chip.label}"`).join(', ') : 'none';

    const tapFilter = async (filter: { label: string; bounds: ScheduleBounds }): Promise<void> => {
      adbTap(getCenterX(filter.bounds), getCenterY(filter.bounds));
      await this.driver.pause(1200);
      console.log(`${targetSport} filter clicked successfully`);
    };

    let visibleFilters = await readVisibleFilterChips();
    const railAnchor = visibleFilters.find(chip => /all sports?/.test(this.normalizeScheduleText(chip.label))) || visibleFilters[0];
    const railY = railAnchor
      ? getCenterY(railAnchor.bounds)
      : Math.round(screen.height * 0.16);
    visibleFilters = await readVisibleFilterChips(railY);
    console.log(`  Visible Schedule filters: ${describeFilters(visibleFilters)}`);
    const visibleSportFilter = findTargetFilter(visibleFilters);
    if (visibleSportFilter) {
      await tapFilter(visibleSportFilter);
      return;
    }

    console.log(`  ${targetSport} filter not immediately visible - swiping Schedule filter strip slowly...`);
    const startX = Math.round(screen.width * 0.72);
    const endX = Math.round(screen.width * 0.42);
    const maxSwipes = 12;

    for (let i = 0; i < maxSwipes; i++) {
      console.log(`  Swiping filter strip one step (attempt ${i + 1}/${maxSwipes})...`);
      try {
        await this.driver.performActions([{
          type: 'pointer', id: 'schedule-filter-strip',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: startX, y: railY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: 800, x: endX, y: railY },
            { type: 'pointerUp', button: 0 },
          ],
        }]);
        await this.driver.releaseActions();
      } catch {
        adbSwipe(startX, railY, endX, railY);
      }
      await this.driver.pause(700);

      visibleFilters = await readVisibleFilterChips(railY);
      console.log(`  Visible Schedule filters after swipe ${i + 1}: ${describeFilters(visibleFilters)}`);
      const sportFilter = findTargetFilter(visibleFilters);
      if (sportFilter) {
        await tapFilter(sportFilter);
        return;
      }
    }

    await this.driver.saveScreenshot('./test-results/android_schedule_sport_filter_not_found.png').catch(() => {});
    throw new Error(`${targetSport} filter not found on Schedule page. See android_schedule_sport_filter_not_found.png`);
  }

  async openPPVPaywall(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Navigating to Schedule page...');
    await this.navigate();
    await this.driver.pause(3000);

    let onSchedule = await this.waitForSchedulePage(this.isFireTv() ? 45000 : 8000);
    if (!onSchedule) {
      await this.driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
      throw new Error('Schedule page assertion failed after clicking Schedule. Expected Schedule title plus filter strip content.');
    }

    console.log('On Schedule page');
    await this.driver.pause(2000);
    const isFireTv = (process.env.TV_TARGET || '').toLowerCase().trim() === 'firetv';
    const isAndroidTv = (process.env.TV_TARGET || '').toLowerCase().trim() === 'androidtv';
    if (isFireTv) {
      await this.focusAndClickBoxingForFireTv();
    } else if (isAndroidTv) {
      await this.focusAndClickBoxingForAndroidTv();
    } else {
      await this.clickSportFilterIfPresent(eventConfig);
    }
    await this.driver.pause(3000);

    console.log(`Navigating to ${this.ppvName} using ${isFireTv || isAndroidTv ? 'TV schedule controls' : 'schedule navigator'}...`);
    try {
      if (isFireTv) {
        await this.moveDownAndAssertPpvDateForFireTv(eventConfig);
        await this.runSurfaceValidation(hooks, 'PPV Tile');
        await this.tapExactVisiblePpvTileForFireTv(this.ppvName);
      } else if (isAndroidTv) {
        await this.moveDownAndAssertPpvDateForAndroidTv(eventConfig);
        await this.runSurfaceValidation(hooks, 'PPV Tile');
        await this.tapExactVisiblePpvTileForAndroidTv(this.ppvName);
      } else if (eventConfig) {
        await navigateToPPVTile(this.driver, eventConfig, hooks);
      } else {
        const ppvTile = await this.scrollToPPVTile(this.ppvName);
        if (ppvTile) {
          await this.runSurfaceValidation(hooks, 'PPV Tile');
          await ppvTile.click();
          console.log(`Clicked ${this.ppvName} tile`);
        }
      }
      hooks.recordAvailability?.(true, undefined, 'Schedule');
    } catch (e: any) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_schedule_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Schedule');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found on Schedule`);
      throw e;
    }

    await this.driver.pause(2000);

    const cleanUserState = String(process.env.USER_STATE || '').toLowerCase().trim().replace('-', '_');
    const isUltimateUser = ['active_ultimate_upfront', 'active_ultimate_apm'].includes(cleanUserState);

    if (isUltimateUser) {
      console.log('✨ [Ultimate Active User] Schedule tile clicked. Checking for PIN Protection screen...');
      await this.handlePinProtectionIfPresent();
      console.log('✨ [Ultimate Active User] Navigated to fixture page. Ending schedule flow (no paywall expected).');
      return true;
    }

    console.log('  On paywall screen - will capture URL via Copy button');
    await this.runPaywallValidation(hooks);
    return true;
  }

  async debugFireTvBoxingAndPpvTile(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<void> {
    if (await this.isFireTvPpvPaywallVisible(this.ppvName)) {
      console.log(`✅ Fire TV Schedule debug: PPV paywall already open for ${this.ppvName}`);
      return;
    }

    console.log('Fire TV Schedule debug: verifying current Schedule page...');
    let onSchedule = await this.waitForSchedulePage(8000);
    if (!onSchedule) {
      console.log('Fire TV Schedule debug: not on Schedule page yet, navigating to Schedule first...');
      await this.navigate();
      onSchedule = await this.waitForSchedulePage(45000);
      if (!onSchedule) {
        await this.driver.saveScreenshot('./test-results/firetv_schedule_debug_not_on_schedule.png').catch(() => {});
        throw new Error('Fire TV Schedule debug could not navigate to the Schedule page.');
      }
    }

    if (String(process.env.SKIP_BOXING || '').toLowerCase().trim() === 'true') {
      console.log('Fire TV Schedule debug: Boxing already selected, skipping Boxing filter selection.');
    } else {
      console.log('Fire TV Schedule debug: selecting Boxing from the Schedule filter row.');
      await this.focusAndClickBoxingForFireTv();
    }

    await this.moveDownAndAssertPpvDateForFireTv(eventConfig);

    console.log(`Fire TV Schedule debug: PPV date checked. Clicking exact visible tile for ${this.ppvName}...`);
    await this.tapExactVisiblePpvTileForFireTv(this.ppvName);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_debug_after_tile_click.png').catch(() => {});
  }
}

export async function navigateToSchedule(driver: WdBrowser): Promise<void> {
  return new AndroidSchedulePage(driver).navigate();
}

export async function scrollScheduleToPPVTile(driver: WdBrowser, ppvName: string): Promise<WdElement | null> {
  return new AndroidSchedulePage(driver, ppvName).scrollToPPVTile(ppvName);
}

export async function openSchedulePPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidSchedulePage(driver, ppvName).openPPVPaywall(eventConfig, hooks);
}

export async function debugFireTvScheduleBoxingAndPpvTile(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<void> {
  return new AndroidSchedulePage(driver, ppvName).debugFireTvBoxingAndPpvTile(eventConfig, hooks);
}
