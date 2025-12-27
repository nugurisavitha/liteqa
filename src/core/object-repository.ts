// ============================================================================
// LiteQA - Object Repository (Tosca-Style)
// ============================================================================
//
// Centralized element definitions with:
// - Logical names for elements
// - Multiple selector strategies per element
// - Properties and metadata
// - Inheritance and composition
// - Version tracking
//
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ElementProperty {
  name: string;
  value: string;
  type?: 'text' | 'attribute' | 'css' | 'computed';
}

export interface ElementSelector {
  strategy: 'css' | 'xpath' | 'text' | 'role' | 'testid' | 'accessibility' | 'image';
  value: string;
  priority?: number;
  conditions?: Record<string, string>;
}

export interface RepositoryElement {
  id: string;
  name: string;
  description?: string;
  type: 'button' | 'input' | 'link' | 'text' | 'image' | 'container' | 'dropdown' | 'checkbox' | 'radio' | 'table' | 'custom';
  selectors: ElementSelector[];
  properties?: ElementProperty[];
  parent?: string;
  children?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  lastUpdated?: string;
  confidence?: number;
}

export interface RepositoryPage {
  id: string;
  name: string;
  description?: string;
  url?: string;
  urlPattern?: string;
  elements: Record<string, RepositoryElement>;
  parent?: string;
  metadata?: Record<string, unknown>;
}

export interface ObjectRepositoryData {
  version: string;
  name: string;
  description?: string;
  pages: Record<string, RepositoryPage>;
  sharedElements?: Record<string, RepositoryElement>;
  metadata?: {
    created: string;
    lastModified: string;
    author?: string;
  };
}

// ============================================================================
// Object Repository Class
// ============================================================================

export class ObjectRepository {
  private data: ObjectRepositoryData;
  private filePath: string;
  private isDirty = false;

  constructor(filePath?: string) {
    this.filePath = filePath || 'object-repository.yaml';
    this.data = this.createEmpty();

    if (filePath && fs.existsSync(filePath)) {
      this.load(filePath);
    }
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * Add or update a page
   */
  addPage(page: Omit<RepositoryPage, 'elements'> & { elements?: Record<string, RepositoryElement> }): void {
    this.data.pages[page.id] = {
      ...page,
      elements: page.elements || {},
    };
    this.isDirty = true;
    this.updateMetadata();
  }

  /**
   * Get a page by ID
   */
  getPage(pageId: string): RepositoryPage | undefined {
    return this.data.pages[pageId];
  }

  /**
   * Add or update an element in a page
   */
  addElement(pageId: string, element: RepositoryElement): void {
    if (!this.data.pages[pageId]) {
      throw new Error(`Page not found: ${pageId}`);
    }

    element.lastUpdated = new Date().toISOString();
    this.data.pages[pageId].elements[element.id] = element;
    this.isDirty = true;
    this.updateMetadata();
  }

  /**
   * Get an element by page ID and element ID
   */
  getElement(pageId: string, elementId: string): RepositoryElement | undefined {
    const page = this.data.pages[pageId];
    if (!page) return undefined;
    return page.elements[elementId];
  }

  /**
   * Get element by logical name (searches all pages)
   */
  findElementByName(name: string): { page: RepositoryPage; element: RepositoryElement } | undefined {
    for (const page of Object.values(this.data.pages)) {
      for (const element of Object.values(page.elements)) {
        if (element.name === name || element.id === name) {
          return { page, element };
        }
      }
    }

    // Check shared elements
    if (this.data.sharedElements) {
      const element = Object.values(this.data.sharedElements).find(
        e => e.name === name || e.id === name
      );
      if (element) {
        return { page: { id: 'shared', name: 'Shared', elements: {} }, element };
      }
    }

    return undefined;
  }

  /**
   * Add a shared element (available across all pages)
   */
  addSharedElement(element: RepositoryElement): void {
    if (!this.data.sharedElements) {
      this.data.sharedElements = {};
    }
    element.lastUpdated = new Date().toISOString();
    this.data.sharedElements[element.id] = element;
    this.isDirty = true;
    this.updateMetadata();
  }

  /**
   * Remove an element
   */
  removeElement(pageId: string, elementId: string): boolean {
    const page = this.data.pages[pageId];
    if (!page || !page.elements[elementId]) return false;

    delete page.elements[elementId];
    this.isDirty = true;
    this.updateMetadata();
    return true;
  }

  /**
   * Remove a page
   */
  removePage(pageId: string): boolean {
    if (!this.data.pages[pageId]) return false;

    delete this.data.pages[pageId];
    this.isDirty = true;
    this.updateMetadata();
    return true;
  }

  // ============================================================================
  // Selector Resolution
  // ============================================================================

  /**
   * Get the best selector for an element
   */
  getBestSelector(pageId: string, elementId: string): string | undefined {
    const element = this.getElement(pageId, elementId);
    if (!element) return undefined;

    // Sort by priority (lower = higher priority)
    const sortedSelectors = [...element.selectors].sort(
      (a, b) => (a.priority || 99) - (b.priority || 99)
    );

    if (sortedSelectors.length === 0) return undefined;

    const best = sortedSelectors[0];
    return this.formatSelector(best);
  }

  /**
   * Get all selectors for an element (for self-healing)
   */
  getAllSelectors(pageId: string, elementId: string): string[] {
    const element = this.getElement(pageId, elementId);
    if (!element) return [];

    return element.selectors
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .map(s => this.formatSelector(s));
  }

  /**
   * Format selector based on strategy
   */
  private formatSelector(selector: ElementSelector): string {
    switch (selector.strategy) {
      case 'css':
        return selector.value;
      case 'xpath':
        return `xpath=${selector.value}`;
      case 'text':
        return `text="${selector.value}"`;
      case 'role':
        return `role=${selector.value}`;
      case 'testid':
        return `[data-testid="${selector.value}"]`;
      case 'accessibility':
        return `[aria-label="${selector.value}"]`;
      case 'image':
        return `image=${selector.value}`;
      default:
        return selector.value;
    }
  }

  /**
   * Resolve a logical element reference to a selector
   * Supports: ${PageName.ElementName} or ${ElementName}
   */
  resolveReference(reference: string): string | undefined {
    // Format: ${PageName.ElementName} or ${ElementName}
    const match = reference.match(/^\$\{(?:(\w+)\.)?(\w+)\}$/);
    if (!match) return undefined;

    const [, pageHint, elementName] = match;

    if (pageHint) {
      // Look in specific page
      const page = Object.values(this.data.pages).find(
        p => p.name === pageHint || p.id === pageHint
      );
      if (page) {
        const element = Object.values(page.elements).find(
          e => e.name === elementName || e.id === elementName
        );
        if (element) {
          return this.formatSelector(element.selectors[0]);
        }
      }
    } else {
      // Search all pages
      const result = this.findElementByName(elementName);
      if (result) {
        return this.formatSelector(result.element.selectors[0]);
      }
    }

    return undefined;
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * Load repository from file
   */
  load(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    this.data = yaml.load(content) as ObjectRepositoryData;
    this.filePath = filePath;
    this.isDirty = false;
    logger.debug(`Loaded object repository: ${filePath}`);
  }

  /**
   * Save repository to file
   */
  save(filePath?: string): void {
    const targetPath = filePath || this.filePath;
    const content = yaml.dump(this.data, { indent: 2, lineWidth: 120 });
    fs.writeFileSync(targetPath, content, 'utf-8');
    this.filePath = targetPath;
    this.isDirty = false;
    logger.info(`Saved object repository: ${targetPath}`);
  }

  /**
   * Export to different format
   */
  export(format: 'yaml' | 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.data, null, 2);
    }
    return yaml.dump(this.data, { indent: 2 });
  }

  /**
   * Merge another repository into this one
   */
  merge(other: ObjectRepositoryData, overwrite = false): void {
    for (const [pageId, page] of Object.entries(other.pages)) {
      if (!this.data.pages[pageId] || overwrite) {
        this.data.pages[pageId] = page;
      } else {
        // Merge elements
        for (const [elemId, element] of Object.entries(page.elements)) {
          if (!this.data.pages[pageId].elements[elemId] || overwrite) {
            this.data.pages[pageId].elements[elemId] = element;
          }
        }
      }
    }
    this.isDirty = true;
    this.updateMetadata();
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Create empty repository
   */
  private createEmpty(): ObjectRepositoryData {
    return {
      version: '1.0',
      name: 'LiteQA Object Repository',
      pages: {},
      metadata: {
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
    };
  }

  /**
   * Update metadata timestamp
   */
  private updateMetadata(): void {
    if (this.data.metadata) {
      this.data.metadata.lastModified = new Date().toISOString();
    }
  }

  /**
   * Get statistics
   */
  getStats(): { pages: number; elements: number; sharedElements: number } {
    let elements = 0;
    for (const page of Object.values(this.data.pages)) {
      elements += Object.keys(page.elements).length;
    }
    return {
      pages: Object.keys(this.data.pages).length,
      elements,
      sharedElements: Object.keys(this.data.sharedElements || {}).length,
    };
  }

  /**
   * Search elements by tag
   */
  findByTag(tag: string): RepositoryElement[] {
    const results: RepositoryElement[] = [];
    for (const page of Object.values(this.data.pages)) {
      for (const element of Object.values(page.elements)) {
        if (element.tags?.includes(tag)) {
          results.push(element);
        }
      }
    }
    return results;
  }

  /**
   * Validate repository integrity
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [pageId, page] of Object.entries(this.data.pages)) {
      if (!page.name) {
        errors.push(`Page ${pageId} missing name`);
      }

      for (const [elemId, element] of Object.entries(page.elements)) {
        if (!element.name) {
          errors.push(`Element ${pageId}.${elemId} missing name`);
        }
        if (!element.selectors || element.selectors.length === 0) {
          errors.push(`Element ${pageId}.${elemId} has no selectors`);
        }
        if (element.parent && !page.elements[element.parent]) {
          errors.push(`Element ${pageId}.${elemId} references missing parent: ${element.parent}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get all data
   */
  getData(): ObjectRepositoryData {
    return this.data;
  }

  /**
   * Check if repository has unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.isDirty;
  }
}

// ============================================================================
// Repository Element Builder (Fluent API)
// ============================================================================

export class ElementBuilder {
  private element: Partial<RepositoryElement> = {
    selectors: [],
    properties: [],
    tags: [],
  };

  id(id: string): this {
    this.element.id = id;
    return this;
  }

  name(name: string): this {
    this.element.name = name;
    return this;
  }

  description(description: string): this {
    this.element.description = description;
    return this;
  }

  type(type: RepositoryElement['type']): this {
    this.element.type = type;
    return this;
  }

  css(selector: string, priority = 1): this {
    this.element.selectors!.push({ strategy: 'css', value: selector, priority });
    return this;
  }

  xpath(selector: string, priority = 2): this {
    this.element.selectors!.push({ strategy: 'xpath', value: selector, priority });
    return this;
  }

  testId(id: string, priority = 0): this {
    this.element.selectors!.push({ strategy: 'testid', value: id, priority });
    return this;
  }

  text(text: string, priority = 3): this {
    this.element.selectors!.push({ strategy: 'text', value: text, priority });
    return this;
  }

  role(role: string, priority = 1): this {
    this.element.selectors!.push({ strategy: 'role', value: role, priority });
    return this;
  }

  accessibility(label: string, priority = 1): this {
    this.element.selectors!.push({ strategy: 'accessibility', value: label, priority });
    return this;
  }

  property(name: string, value: string, type?: ElementProperty['type']): this {
    this.element.properties!.push({ name, value, type });
    return this;
  }

  tag(...tags: string[]): this {
    this.element.tags!.push(...tags);
    return this;
  }

  parent(parentId: string): this {
    this.element.parent = parentId;
    return this;
  }

  build(): RepositoryElement {
    if (!this.element.id || !this.element.name || !this.element.type) {
      throw new Error('Element must have id, name, and type');
    }
    if (!this.element.selectors || this.element.selectors.length === 0) {
      throw new Error('Element must have at least one selector');
    }
    return this.element as RepositoryElement;
  }
}

/**
 * Factory function for creating elements
 */
export function element(): ElementBuilder {
  return new ElementBuilder();
}
