// ============================================================================
// LiteQA - AI Test Generator (Appvance-Style)
// ============================================================================
//
// Automatically generates tests by:
// - Crawling web applications
// - Analyzing page structure
// - Identifying testable elements
// - Generating test flows
// - Learning application patterns
//
// No paid API keys required - uses heuristics by default
// Optional: Plug in LLM for enhanced generation
//
// ============================================================================

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { logger } from '../utils/logger';
import { Flow, Step } from '../core/types';

// ============================================================================
// Types
// ============================================================================

export interface CrawlConfig {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  timeout?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  authentication?: {
    type: 'basic' | 'form' | 'cookie';
    credentials?: Record<string, string>;
  };
  waitForSelector?: string;
  viewport?: { width: number; height: number };
  headless?: boolean;
}

export interface PageElement {
  selector: string;
  type: 'button' | 'link' | 'input' | 'form' | 'text' | 'image' | 'other';
  text?: string;
  name?: string;
  id?: string;
  testId?: string;
  ariaLabel?: string;
  href?: string;
  inputType?: string;
  placeholder?: string;
  required?: boolean;
  visible: boolean;
  interactable: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface PageInfo {
  url: string;
  title: string;
  elements: PageElement[];
  forms: FormInfo[];
  links: LinkInfo[];
  screenshots?: string;
  timestamp: string;
  depth: number;
}

export interface FormInfo {
  selector: string;
  action?: string;
  method?: string;
  inputs: PageElement[];
  submitButton?: PageElement;
}

export interface LinkInfo {
  href: string;
  text: string;
  selector: string;
  internal: boolean;
}

export interface AppBlueprint {
  name: string;
  baseUrl: string;
  pages: PageInfo[];
  flows: DetectedFlow[];
  generatedAt: string;
  stats: {
    pagesScanned: number;
    elementsFound: number;
    formsFound: number;
    linksFound: number;
  };
}

export interface DetectedFlow {
  name: string;
  type: 'navigation' | 'form' | 'crud' | 'authentication' | 'search';
  steps: Step[];
  confidence: number;
}

export interface GeneratedTest {
  name: string;
  description: string;
  flow: Flow;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
}

// ============================================================================
// AI Test Generator
// ============================================================================

export class AITestGenerator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private visitedUrls: Set<string> = new Set();
  private pages: PageInfo[] = [];
  private config: CrawlConfig;

  constructor(config: CrawlConfig) {
    this.config = {
      maxPages: 50,
      maxDepth: 3,
      timeout: 30000,
      headless: true,
      viewport: { width: 1280, height: 720 },
      ...config,
    };
  }

  // ============================================================================
  // Main Entry Points
  // ============================================================================

  /**
   * Crawl application and generate blueprint
   */
  async crawl(): Promise<AppBlueprint> {
    logger.info(`Starting crawl of ${this.config.startUrl}`);

    try {
      await this.initBrowser();
      await this.crawlPage(this.config.startUrl, 0);
      await this.cleanup();

      const blueprint = this.generateBlueprint();
      logger.success(`Crawl complete: ${blueprint.stats.pagesScanned} pages, ${blueprint.stats.elementsFound} elements`);

      return blueprint;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Generate tests from blueprint
   */
  generateTests(blueprint: AppBlueprint): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    // Generate smoke test
    tests.push(this.generateSmokeTest(blueprint));

    // Generate form tests
    for (const page of blueprint.pages) {
      for (const form of page.forms) {
        tests.push(...this.generateFormTests(page, form));
      }
    }

    // Generate navigation tests
    tests.push(this.generateNavigationTest(blueprint));

    // Generate link validation test
    tests.push(this.generateLinkValidationTest(blueprint));

    // Generate detected flow tests
    for (const flow of blueprint.flows) {
      tests.push(this.generateFlowTest(flow));
    }

    logger.success(`Generated ${tests.length} test(s)`);
    return tests;
  }

  /**
   * One-shot: Crawl and generate tests
   */
  async autoGenerate(): Promise<{ blueprint: AppBlueprint; tests: GeneratedTest[] }> {
    const blueprint = await this.crawl();
    const tests = this.generateTests(blueprint);
    return { blueprint, tests };
  }

  // ============================================================================
  // Crawling Logic
  // ============================================================================

  private async initBrowser(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
    });
    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
    });
  }

  private async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.context = null;
  }

  private async crawlPage(url: string, depth: number): Promise<void> {
    // Check limits
    if (this.visitedUrls.has(url)) return;
    if (this.visitedUrls.size >= this.config.maxPages!) return;
    if (depth > this.config.maxDepth!) return;

    // Check patterns
    if (!this.shouldCrawl(url)) return;

    this.visitedUrls.add(url);
    logger.debug(`Crawling [${depth}]: ${url}`);

    const page = await this.context!.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.config.timeout,
      });

      // Wait for custom selector if specified
      if (this.config.waitForSelector) {
        await page.waitForSelector(this.config.waitForSelector, { timeout: 5000 }).catch(() => {});
      }

      // Extract page info
      const pageInfo = await this.extractPageInfo(page, url, depth);
      this.pages.push(pageInfo);

      // Find and crawl internal links
      const internalLinks = pageInfo.links.filter(link => link.internal);
      for (const link of internalLinks) {
        await this.crawlPage(link.href, depth + 1);
      }
    } catch (error) {
      logger.warn(`Failed to crawl ${url}: ${(error as Error).message}`);
    } finally {
      await page.close();
    }
  }

  private shouldCrawl(url: string): boolean {
    const baseHost = new URL(this.config.startUrl).host;

    try {
      const urlHost = new URL(url).host;
      if (urlHost !== baseHost) return false;
    } catch {
      return false;
    }

    // Check exclude patterns
    if (this.config.excludePatterns) {
      for (const pattern of this.config.excludePatterns) {
        if (new RegExp(pattern).test(url)) return false;
      }
    }

    // Check include patterns
    if (this.config.includePatterns && this.config.includePatterns.length > 0) {
      for (const pattern of this.config.includePatterns) {
        if (new RegExp(pattern).test(url)) return true;
      }
      return false;
    }

    return true;
  }

  // ============================================================================
  // Page Analysis
  // ============================================================================

  private async extractPageInfo(page: Page, url: string, depth: number): Promise<PageInfo> {
    const title = await page.title();

    // Extract all elements
    const elements = await this.extractElements(page);

    // Extract forms
    const forms = await this.extractForms(page);

    // Extract links
    const links = await this.extractLinks(page, url);

    return {
      url,
      title,
      elements,
      forms,
      links,
      timestamp: new Date().toISOString(),
      depth,
    };
  }

  private async extractElements(page: Page): Promise<PageElement[]> {
    return page.evaluate(() => {
      const elements: PageElement[] = [];
      const interactiveSelectors = [
        'button', 'a', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="textbox"]',
        '[onclick]', '[ng-click]', '[click]',
      ];

      const allElements = document.querySelectorAll(interactiveSelectors.join(', '));

      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);

        // Skip hidden elements
        if (rect.width === 0 || rect.height === 0) continue;
        if (styles.display === 'none' || styles.visibility === 'hidden') continue;

        const tagName = el.tagName.toLowerCase();
        let type: PageElement['type'] = 'other';

        if (tagName === 'button' || el.getAttribute('role') === 'button') type = 'button';
        else if (tagName === 'a') type = 'link';
        else if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') type = 'input';
        else if (tagName === 'img') type = 'image';

        // Generate best selector
        let selector = '';
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
        const id = el.getAttribute('id');
        const ariaLabel = el.getAttribute('aria-label');

        if (testId) {
          selector = `[data-testid="${testId}"]`;
        } else if (id && !id.match(/^\d|^ng-|^mat-/)) {
          selector = `#${id}`;
        } else if (ariaLabel) {
          selector = `[aria-label="${ariaLabel}"]`;
        } else {
          // Generate CSS selector
          selector = tagName;
          const classes = Array.from(el.classList).filter(c => !c.match(/^ng-|^mat-|^cdk-/)).slice(0, 2);
          if (classes.length) selector += '.' + classes.join('.');
        }

        elements.push({
          selector,
          type,
          text: (el as HTMLElement).innerText?.trim().slice(0, 100),
          name: el.getAttribute('name') || undefined,
          id: id || undefined,
          testId: testId || undefined,
          ariaLabel: ariaLabel || undefined,
          href: (el as HTMLAnchorElement).href || undefined,
          inputType: (el as HTMLInputElement).type || undefined,
          placeholder: (el as HTMLInputElement).placeholder || undefined,
          required: (el as HTMLInputElement).required || false,
          visible: true,
          interactable: !el.hasAttribute('disabled'),
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      }

      return elements;
    });
  }

  private async extractForms(page: Page): Promise<FormInfo[]> {
    return page.evaluate(() => {
      const forms: FormInfo[] = [];

      document.querySelectorAll('form').forEach((form, index) => {
        const inputs: any[] = [];
        let submitButton: any = undefined;

        // Get all inputs
        form.querySelectorAll('input, select, textarea').forEach(input => {
          const inputEl = input as HTMLInputElement;
          if (inputEl.type === 'hidden') return;

          inputs.push({
            selector: inputEl.name ? `[name="${inputEl.name}"]` : `form:nth-of-type(${index + 1}) input`,
            type: 'input',
            name: inputEl.name,
            inputType: inputEl.type,
            placeholder: inputEl.placeholder,
            required: inputEl.required,
            visible: true,
            interactable: !inputEl.disabled,
            bounds: inputEl.getBoundingClientRect(),
          });
        });

        // Find submit button
        const submit = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submit) {
          submitButton = {
            selector: submit.getAttribute('id') ? `#${submit.getAttribute('id')}` : 'button[type="submit"]',
            type: 'button',
            text: (submit as HTMLElement).innerText || (submit as HTMLInputElement).value,
            visible: true,
            interactable: true,
            bounds: submit.getBoundingClientRect(),
          };
        }

        forms.push({
          selector: form.id ? `#${form.id}` : `form:nth-of-type(${index + 1})`,
          action: form.action,
          method: form.method,
          inputs,
          submitButton,
        });
      });

      return forms;
    });
  }

  private async extractLinks(page: Page, currentUrl: string): Promise<LinkInfo[]> {
    const baseHost = new URL(this.config.startUrl).host;

    return page.evaluate((baseHost) => {
      const links: LinkInfo[] = [];

      document.querySelectorAll('a[href]').forEach(a => {
        const anchor = a as HTMLAnchorElement;
        const href = anchor.href;

        if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

        let internal = false;
        try {
          internal = new URL(href).host === baseHost;
        } catch {
          internal = href.startsWith('/');
        }

        links.push({
          href,
          text: anchor.innerText?.trim().slice(0, 100) || '',
          selector: anchor.id ? `#${anchor.id}` : `a[href="${anchor.getAttribute('href')}"]`,
          internal,
        });
      });

      return links;
    }, baseHost);
  }

  // ============================================================================
  // Blueprint Generation
  // ============================================================================

  private generateBlueprint(): AppBlueprint {
    const detectedFlows = this.detectFlows();

    let elementsCount = 0;
    let formsCount = 0;
    let linksCount = 0;

    for (const page of this.pages) {
      elementsCount += page.elements.length;
      formsCount += page.forms.length;
      linksCount += page.links.length;
    }

    return {
      name: `Blueprint - ${new URL(this.config.startUrl).host}`,
      baseUrl: this.config.startUrl,
      pages: this.pages,
      flows: detectedFlows,
      generatedAt: new Date().toISOString(),
      stats: {
        pagesScanned: this.pages.length,
        elementsFound: elementsCount,
        formsFound: formsCount,
        linksFound: linksCount,
      },
    };
  }

  private detectFlows(): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Detect login flow
    const loginPage = this.pages.find(p =>
      p.url.includes('login') ||
      p.url.includes('signin') ||
      p.forms.some(f => f.inputs.some(i => i.inputType === 'password'))
    );

    if (loginPage) {
      const loginForm = loginPage.forms.find(f =>
        f.inputs.some(i => i.inputType === 'password')
      );

      if (loginForm) {
        flows.push({
          name: 'Login Flow',
          type: 'authentication',
          confidence: 0.9,
          steps: this.generateLoginSteps(loginPage, loginForm),
        });
      }
    }

    // Detect search flow
    const searchForm = this.findSearchForm();
    if (searchForm) {
      flows.push({
        name: 'Search Flow',
        type: 'search',
        confidence: 0.8,
        steps: this.generateSearchSteps(searchForm.page, searchForm.form),
      });
    }

    // Detect CRUD flows
    const crudFlows = this.detectCrudFlows();
    flows.push(...crudFlows);

    return flows;
  }

  private generateLoginSteps(page: PageInfo, form: FormInfo): Step[] {
    const steps: Step[] = [];

    steps.push({
      action: 'goto',
      url: page.url,
      description: 'Navigate to login page',
    } as Step);

    // Find username/email field
    const usernameInput = form.inputs.find(i =>
      i.inputType === 'email' ||
      i.inputType === 'text' ||
      i.name?.includes('user') ||
      i.name?.includes('email')
    );

    if (usernameInput) {
      steps.push({
        action: 'fill',
        selector: usernameInput.selector,
        value: '${username}',
        description: 'Enter username',
      } as Step);
    }

    // Find password field
    const passwordInput = form.inputs.find(i => i.inputType === 'password');
    if (passwordInput) {
      steps.push({
        action: 'fill',
        selector: passwordInput.selector,
        value: '${password}',
        description: 'Enter password',
      } as Step);
    }

    // Submit
    if (form.submitButton) {
      steps.push({
        action: 'click',
        selector: form.submitButton.selector,
        description: 'Click login button',
      } as Step);
    }

    steps.push({
      action: 'waitForLoadState',
      state: 'networkidle',
      description: 'Wait for login to complete',
    } as Step);

    return steps;
  }

  private findSearchForm(): { page: PageInfo; form: FormInfo } | undefined {
    for (const page of this.pages) {
      const searchForm = page.forms.find(f =>
        f.action?.includes('search') ||
        f.inputs.some(i =>
          i.name?.includes('search') ||
          i.name?.includes('query') ||
          i.placeholder?.toLowerCase().includes('search')
        )
      );
      if (searchForm) {
        return { page, form: searchForm };
      }
    }
    return undefined;
  }

  private generateSearchSteps(page: PageInfo, form: FormInfo): Step[] {
    const steps: Step[] = [];

    steps.push({
      action: 'goto',
      url: page.url,
      description: 'Navigate to search page',
    } as Step);

    const searchInput = form.inputs.find(i =>
      i.name?.includes('search') ||
      i.name?.includes('query') ||
      i.placeholder?.toLowerCase().includes('search')
    );

    if (searchInput) {
      steps.push({
        action: 'fill',
        selector: searchInput.selector,
        value: '${searchTerm}',
        description: 'Enter search term',
      } as Step);
    }

    if (form.submitButton) {
      steps.push({
        action: 'click',
        selector: form.submitButton.selector,
        description: 'Submit search',
      } as Step);
    } else {
      steps.push({
        action: 'press',
        key: 'Enter',
        description: 'Press Enter to search',
      } as Step);
    }

    steps.push({
      action: 'waitForLoadState',
      state: 'networkidle',
      description: 'Wait for search results',
    } as Step);

    return steps;
  }

  private detectCrudFlows(): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Look for pages with create/add forms
    for (const page of this.pages) {
      if (page.url.includes('new') || page.url.includes('create') || page.url.includes('add')) {
        const form = page.forms[0];
        if (form && form.inputs.length > 0) {
          flows.push({
            name: `Create ${this.extractEntityName(page.url)}`,
            type: 'crud',
            confidence: 0.7,
            steps: this.generateCreateSteps(page, form),
          });
        }
      }
    }

    return flows;
  }

  private extractEntityName(url: string): string {
    const parts = url.split('/').filter(p => p && !['new', 'create', 'add', 'edit'].includes(p));
    return parts[parts.length - 1] || 'Item';
  }

  private generateCreateSteps(page: PageInfo, form: FormInfo): Step[] {
    const steps: Step[] = [];

    steps.push({
      action: 'goto',
      url: page.url,
      description: `Navigate to create page`,
    } as Step);

    for (const input of form.inputs) {
      if (input.inputType === 'hidden') continue;

      const varName = input.name || `field${form.inputs.indexOf(input)}`;

      steps.push({
        action: 'fill',
        selector: input.selector,
        value: `\${${varName}}`,
        description: `Fill ${input.name || 'field'}`,
      } as Step);
    }

    if (form.submitButton) {
      steps.push({
        action: 'click',
        selector: form.submitButton.selector,
        description: 'Submit form',
      } as Step);
    }

    return steps;
  }

  // ============================================================================
  // Test Generation
  // ============================================================================

  private generateSmokeTest(blueprint: AppBlueprint): GeneratedTest {
    const steps: Step[] = [];

    steps.push({
      action: 'goto',
      url: blueprint.baseUrl,
      waitUntil: 'networkidle',
      description: 'Navigate to homepage',
    } as Step);

    steps.push({
      action: 'waitForLoadState',
      state: 'networkidle',
      description: 'Wait for page load',
    } as Step);

    // Take screenshot
    steps.push({
      action: 'screenshot',
      name: 'homepage',
      fullPage: true,
      description: 'Capture homepage',
    } as Step);

    // Verify page title
    if (blueprint.pages[0]) {
      steps.push({
        action: 'expectVisible',
        selector: 'body',
        description: 'Verify page loads',
      } as Step);
    }

    return {
      name: 'Smoke Test',
      description: 'Basic smoke test to verify application loads',
      priority: 'high',
      tags: ['smoke', 'generated'],
      flow: {
        name: 'Smoke Test',
        description: 'Auto-generated smoke test',
        runner: 'web',
        steps,
      },
    };
  }

  private generateFormTests(page: PageInfo, form: FormInfo): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    // Positive test - valid submission
    tests.push({
      name: `Form Submission - ${page.title || page.url}`,
      description: `Test form submission on ${page.url}`,
      priority: 'medium',
      tags: ['form', 'generated'],
      flow: {
        name: `Form Test - ${page.title}`,
        runner: 'web',
        steps: [
          { action: 'goto', url: page.url, description: 'Navigate to form' } as Step,
          ...form.inputs.map(input => ({
            action: 'fill',
            selector: input.selector,
            value: this.generateTestValue(input),
            description: `Fill ${input.name || 'field'}`,
          } as Step)),
          ...(form.submitButton ? [{
            action: 'click',
            selector: form.submitButton.selector,
            description: 'Submit form',
          } as Step] : []),
        ],
      },
    });

    // Validation test - required fields
    const requiredInputs = form.inputs.filter(i => i.required);
    if (requiredInputs.length > 0) {
      tests.push({
        name: `Form Validation - ${page.title || page.url}`,
        description: `Test form validation on ${page.url}`,
        priority: 'medium',
        tags: ['form', 'validation', 'generated'],
        flow: {
          name: `Form Validation - ${page.title}`,
          runner: 'web',
          steps: [
            { action: 'goto', url: page.url, description: 'Navigate to form' } as Step,
            // Try to submit without filling required fields
            ...(form.submitButton ? [{
              action: 'click',
              selector: form.submitButton.selector,
              description: 'Submit empty form',
            } as Step] : []),
            // Should show validation errors
            { action: 'wait', duration: 1000, description: 'Wait for validation' } as Step,
          ],
        },
      });
    }

    return tests;
  }

  private generateTestValue(input: PageElement): string {
    switch (input.inputType) {
      case 'email':
        return 'test@example.com';
      case 'password':
        return 'TestPassword123!';
      case 'number':
        return '42';
      case 'tel':
        return '555-555-5555';
      case 'url':
        return 'https://example.com';
      case 'date':
        return '2024-01-01';
      default:
        return `Test ${input.name || 'Value'}`;
    }
  }

  private generateNavigationTest(blueprint: AppBlueprint): GeneratedTest {
    const steps: Step[] = [];

    steps.push({
      action: 'goto',
      url: blueprint.baseUrl,
      description: 'Start at homepage',
    } as Step);

    // Visit key pages
    const keyPages = blueprint.pages.slice(0, 5);
    for (const page of keyPages) {
      if (page.url !== blueprint.baseUrl) {
        steps.push({
          action: 'goto',
          url: page.url,
          description: `Navigate to ${page.title || page.url}`,
        } as Step);

        steps.push({
          action: 'waitForLoadState',
          state: 'networkidle',
          description: 'Wait for page load',
        } as Step);

        steps.push({
          action: 'screenshot',
          name: page.title?.replace(/\s+/g, '-').toLowerCase() || `page-${keyPages.indexOf(page)}`,
          description: `Capture ${page.title}`,
        } as Step);
      }
    }

    return {
      name: 'Navigation Test',
      description: 'Test navigation between key pages',
      priority: 'medium',
      tags: ['navigation', 'generated'],
      flow: {
        name: 'Navigation Test',
        runner: 'web',
        steps,
      },
    };
  }

  private generateLinkValidationTest(blueprint: AppBlueprint): GeneratedTest {
    const allLinks: LinkInfo[] = [];
    for (const page of blueprint.pages) {
      allLinks.push(...page.links);
    }

    // Deduplicate
    const uniqueLinks = Array.from(new Map(allLinks.map(l => [l.href, l])).values());
    const internalLinks = uniqueLinks.filter(l => l.internal).slice(0, 10);

    const steps: Step[] = [];

    for (const link of internalLinks) {
      steps.push({
        action: 'goto',
        url: link.href,
        description: `Verify link: ${link.text || link.href}`,
      } as Step);

      steps.push({
        action: 'expectVisible',
        selector: 'body',
        description: 'Page loads',
      } as Step);
    }

    return {
      name: 'Link Validation Test',
      description: 'Verify internal links are not broken',
      priority: 'low',
      tags: ['links', 'validation', 'generated'],
      flow: {
        name: 'Link Validation',
        runner: 'web',
        steps,
      },
    };
  }

  private generateFlowTest(detectedFlow: DetectedFlow): GeneratedTest {
    return {
      name: detectedFlow.name,
      description: `Auto-detected ${detectedFlow.type} flow`,
      priority: detectedFlow.confidence > 0.8 ? 'high' : 'medium',
      tags: [detectedFlow.type, 'generated', 'ai-detected'],
      flow: {
        name: detectedFlow.name,
        runner: 'web',
        steps: detectedFlow.steps,
      },
    };
  }

  // ============================================================================
  // Export Methods
  // ============================================================================

  /**
   * Save blueprint to file
   */
  static saveBlueprint(blueprint: AppBlueprint, filePath: string): void {
    const content = yaml.dump(blueprint, { indent: 2, lineWidth: 120 });
    fs.writeFileSync(filePath, content, 'utf-8');
    logger.info(`Blueprint saved: ${filePath}`);
  }

  /**
   * Save generated tests to files
   */
  static saveTests(tests: GeneratedTest[], outputDir: string): void {
    fs.mkdirSync(outputDir, { recursive: true });

    for (const test of tests) {
      const filename = test.name.toLowerCase().replace(/\s+/g, '_') + '.yaml';
      const filePath = path.join(outputDir, filename);
      const content = yaml.dump(test.flow, { indent: 2 });
      fs.writeFileSync(filePath, content, 'utf-8');
      logger.info(`Test saved: ${filePath}`);
    }
  }

  /**
   * Load blueprint from file
   */
  static loadBlueprint(filePath: string): AppBlueprint {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as AppBlueprint;
  }
}
