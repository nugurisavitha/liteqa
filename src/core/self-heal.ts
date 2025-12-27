// ============================================================================
// LiteQA - Self-Healing Locator System
// ============================================================================

import { Page, Locator, ElementHandle } from 'playwright';
import * as stringSimilarity from 'string-similarity';
import * as fs from 'fs';
import * as path from 'path';
import { HealedSelector, SelectorCandidate, LiteQAConfig, DEFAULT_CONFIG } from './types';
import { logger } from '../utils/logger';

export class SelfHealingLocator {
  private config: LiteQAConfig;
  private healedSelectors: HealedSelector[] = [];

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Find an element with self-healing capability
   * Tries the original selector first, then attempts healing strategies
   */
  async findElement(page: Page, selector: string, timeout?: number): Promise<{
    locator: Locator;
    healed?: HealedSelector;
  }> {
    const elementTimeout = timeout ?? this.config.defaultTimeout;

    // Strategy 1: Try original selector first
    try {
      const locator = page.locator(selector);
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      return { locator };
    } catch {
      logger.debug(`Original selector failed: ${selector}`);
    }

    // If self-healing is disabled, throw error
    if (!this.config.selfHeal) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Strategy 2: Try stable selectors (data-testid, aria-label, role)
    const stableSelector = await this.tryStableSelectors(page, selector);
    if (stableSelector) {
      return stableSelector;
    }

    // Strategy 3: Try text similarity matching
    const textMatch = await this.tryTextSimilarity(page, selector);
    if (textMatch) {
      return textMatch;
    }

    // Strategy 4: Try role + name combination
    const roleMatch = await this.tryRoleNameMatch(page, selector);
    if (roleMatch) {
      return roleMatch;
    }

    // Strategy 5: Try CSS contains text
    const cssMatch = await this.tryCssContainsText(page, selector);
    if (cssMatch) {
      return cssMatch;
    }

    throw new Error(`Element not found and self-healing failed: ${selector}`);
  }

  /**
   * Try stable selectors (data-testid, aria-label, role)
   */
  private async tryStableSelectors(page: Page, originalSelector: string): Promise<{
    locator: Locator;
    healed: HealedSelector;
  } | null> {
    // Extract potential identifiers from the original selector
    const identifiers = this.extractIdentifiers(originalSelector);

    for (const id of identifiers) {
      // Try data-testid
      const testIdSelector = `[data-testid="${id}"]`;
      try {
        const locator = page.locator(testIdSelector);
        const count = await locator.count();
        if (count === 1) {
          const healed = this.createHealedSelector(
            originalSelector,
            testIdSelector,
            'data-testid-fuzzy',
            0.9
          );
          return { locator, healed };
        }
      } catch { /* continue */ }

      // Try aria-label
      const ariaSelector = `[aria-label="${id}"]`;
      try {
        const locator = page.locator(ariaSelector);
        const count = await locator.count();
        if (count === 1) {
          const healed = this.createHealedSelector(
            originalSelector,
            ariaSelector,
            'data-testid-fuzzy',
            0.85
          );
          return { locator, healed };
        }
      } catch { /* continue */ }
    }

    return null;
  }

  /**
   * Try text similarity matching
   */
  private async tryTextSimilarity(page: Page, originalSelector: string): Promise<{
    locator: Locator;
    healed: HealedSelector;
  } | null> {
    // Extract text hints from selector
    const textHints = this.extractTextHints(originalSelector);
    if (textHints.length === 0) return null;

    // Get all visible text elements
    const candidates = await this.getVisibleTextElements(page);

    for (const hint of textHints) {
      // Find best text match
      const matches = stringSimilarity.findBestMatch(
        hint.toLowerCase(),
        candidates.map(c => c.text.toLowerCase())
      );

      if (matches.bestMatch.rating >= this.config.selfHealThreshold) {
        const matchedCandidate = candidates[matches.bestMatchIndex];
        const selector = `text="${matchedCandidate.text}"`;

        try {
          const locator = page.locator(selector);
          const count = await locator.count();
          if (count >= 1) {
            const healed = this.createHealedSelector(
              originalSelector,
              selector,
              'text-similarity',
              matches.bestMatch.rating
            );
            return { locator: locator.first(), healed };
          }
        } catch { /* continue */ }
      }
    }

    return null;
  }

  /**
   * Try role + name combination
   */
  private async tryRoleNameMatch(page: Page, originalSelector: string): Promise<{
    locator: Locator;
    healed: HealedSelector;
  } | null> {
    const textHints = this.extractTextHints(originalSelector);
    const roles = ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem'];

    for (const hint of textHints) {
      for (const role of roles) {
        const roleSelector = `role=${role}[name="${hint}"]`;
        try {
          const locator = page.getByRole(role as any, { name: hint });
          const count = await locator.count();
          if (count === 1) {
            const healed = this.createHealedSelector(
              originalSelector,
              roleSelector,
              'role-name',
              0.8
            );
            return { locator, healed };
          }
        } catch { /* continue */ }

        // Try partial match
        try {
          const locator = page.getByRole(role as any, { name: new RegExp(hint, 'i') });
          const count = await locator.count();
          if (count === 1) {
            const healed = this.createHealedSelector(
              originalSelector,
              `role=${role}[name=/${hint}/i]`,
              'role-name',
              0.7
            );
            return { locator, healed };
          }
        } catch { /* continue */ }
      }
    }

    return null;
  }

  /**
   * Try CSS contains text
   */
  private async tryCssContainsText(page: Page, originalSelector: string): Promise<{
    locator: Locator;
    healed: HealedSelector;
  } | null> {
    const textHints = this.extractTextHints(originalSelector);
    const tagNames = ['button', 'a', 'input', 'span', 'div', 'label', 'p'];

    for (const hint of textHints) {
      for (const tag of tagNames) {
        const cssSelector = `${tag}:has-text("${hint}")`;
        try {
          const locator = page.locator(cssSelector);
          const count = await locator.count();
          if (count >= 1 && count <= 3) {
            const healed = this.createHealedSelector(
              originalSelector,
              cssSelector,
              'css-contains',
              0.65
            );
            return { locator: locator.first(), healed };
          }
        } catch { /* continue */ }
      }
    }

    return null;
  }

  /**
   * Extract potential identifiers from a selector
   */
  private extractIdentifiers(selector: string): string[] {
    const identifiers: string[] = [];

    // Extract ID
    const idMatch = selector.match(/#([\w-]+)/);
    if (idMatch) identifiers.push(idMatch[1]);

    // Extract class names
    const classMatches = selector.match(/\.([\w-]+)/g);
    if (classMatches) {
      identifiers.push(...classMatches.map(c => c.slice(1)));
    }

    // Extract attribute values
    const attrMatches = selector.match(/\[[\w-]+=['"]([\w-\s]+)['"]\]/g);
    if (attrMatches) {
      for (const attr of attrMatches) {
        const valueMatch = attr.match(/['"]([\w-\s]+)['"]/);
        if (valueMatch) identifiers.push(valueMatch[1]);
      }
    }

    // Extract text content hints
    const textMatches = selector.match(/text=["']([^"']+)["']/);
    if (textMatches) identifiers.push(textMatches[1]);

    return identifiers.filter(id => id.length > 2);
  }

  /**
   * Extract text hints from selector for fuzzy matching
   */
  private extractTextHints(selector: string): string[] {
    const hints: string[] = [];

    // Direct text selector
    const textMatch = selector.match(/text=["']([^"']+)["']/i);
    if (textMatch) hints.push(textMatch[1]);

    // :has-text() pseudo selector
    const hasTextMatch = selector.match(/:has-text\(["']([^"']+)["']\)/i);
    if (hasTextMatch) hints.push(hasTextMatch[1]);

    // Common button/link patterns in class names
    const classPatterns = selector.match(/\.(login|submit|cancel|save|delete|edit|add|search|next|prev|close|open|btn-\w+)/gi);
    if (classPatterns) {
      hints.push(...classPatterns.map(p => p.slice(1).replace(/-/g, ' ')));
    }

    // Extract from ID
    const idMatch = selector.match(/#([\w-]+)/);
    if (idMatch) {
      const words = idMatch[1].replace(/[-_]/g, ' ').split(' ');
      hints.push(...words.filter(w => w.length > 2));
    }

    return [...new Set(hints)];
  }

  /**
   * Get all visible text elements on page
   */
  private async getVisibleTextElements(page: Page): Promise<{ text: string; tag: string }[]> {
    return page.evaluate(() => {
      const elements: { text: string; tag: string }[] = [];
      const interactiveElements = document.querySelectorAll(
        'button, a, input, label, [role="button"], [role="link"], span, div'
      );

      for (const el of interactiveElements) {
        const text = (el as HTMLElement).innerText?.trim() ||
                     (el as HTMLInputElement).value?.trim() ||
                     el.getAttribute('aria-label') ||
                     el.getAttribute('title') || '';

        if (text && text.length > 0 && text.length < 100) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            elements.push({ text, tag: el.tagName.toLowerCase() });
          }
        }
      }

      return elements.slice(0, 100); // Limit to prevent performance issues
    });
  }

  /**
   * Create a healed selector record
   */
  private createHealedSelector(
    original: string,
    healed: string,
    strategy: HealedSelector['strategy'],
    confidence: number
  ): HealedSelector {
    const healedSelector: HealedSelector = {
      original,
      healed,
      strategy,
      confidence,
      suggestion: `Consider updating selector from "${original}" to "${healed}"`
    };

    this.healedSelectors.push(healedSelector);
    return healedSelector;
  }

  /**
   * Get all healed selectors from this session
   */
  getHealedSelectors(): HealedSelector[] {
    return this.healedSelectors;
  }

  /**
   * Save healed selectors to artifacts folder
   */
  async saveHealedSelectors(outputDir: string): Promise<void> {
    if (this.healedSelectors.length === 0) return;

    const outputPath = path.join(outputDir, 'healed-selectors.json');
    const content = JSON.stringify(this.healedSelectors, null, 2);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf-8');

    logger.info(`Saved ${this.healedSelectors.length} healed selector(s) to ${outputPath}`);
  }

  /**
   * Reset healed selectors
   */
  reset(): void {
    this.healedSelectors = [];
  }
}

/**
 * Selector priority strategies for Angular SSR apps
 *
 * Angular SSR apps have specific challenges:
 * 1. Server-rendered HTML may have different structure than hydrated version
 * 2. ngIf/ngFor directives may add/remove elements during hydration
 * 3. Component selectors may change between SSR and client render
 *
 * Best practices:
 * - Use data-testid attributes that persist across hydration
 * - Wait for Angular to complete hydration before interacting
 * - Use stable selectors (aria-label, role) over class names
 */
export const SELECTOR_PRIORITY = [
  'data-testid',
  'data-test',
  'data-cy',
  'aria-label',
  'role + name',
  'id (if stable)',
  'text content',
  'css selector (last resort)'
];
