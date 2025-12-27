// ============================================================================
// LiteQA - Script Runner (Custom JavaScript/TypeScript)
// ============================================================================
//
// Executes custom scripts with:
// - Playwright API access
// - LiteQA helpers
// - Data management integration
// - Assertion library
// - Screenshot/reporting capabilities
//
// ============================================================================

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { FlowResult, StepResult, LiteQAConfig, DEFAULT_CONFIG } from '../core/types';
import { TestDataManager } from '../core/test-data';
import { ObjectRepository } from '../core/object-repository';
import { SelfHealingLocator } from '../core/self-heal';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ScriptContext {
  // Playwright objects
  browser: Browser;
  context: BrowserContext;
  page: Page;

  // LiteQA helpers
  liteqa: LiteQAHelpers;
  data: TestDataManager;
  repository: ObjectRepository;

  // Utilities
  log: typeof logger;
  expect: ExpectAPI;
  sleep: (ms: number) => Promise<void>;

  // Test data
  params: Record<string, unknown>;
  env: Record<string, string | undefined>;
}

export interface LiteQAHelpers {
  // Navigation
  goto(url: string, options?: { waitUntil?: 'load' | 'networkidle' }): Promise<void>;

  // Actions with self-healing
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  check(selector: string): Promise<void>;
  uncheck(selector: string): Promise<void>;
  hover(selector: string): Promise<void>;

  // Waits
  waitForSelector(selector: string, options?: { state?: 'visible' | 'hidden' }): Promise<void>;
  waitForNavigation(): Promise<void>;
  waitForLoadState(state?: 'load' | 'networkidle'): Promise<void>;

  // Assertions
  expectVisible(selector: string): Promise<void>;
  expectHidden(selector: string): Promise<void>;
  expectText(selector: string, text: string): Promise<void>;
  expectValue(selector: string, value: string): Promise<void>;
  expectUrl(pattern: string | RegExp): Promise<void>;

  // Screenshots
  screenshot(name: string, options?: { fullPage?: boolean }): Promise<string>;

  // Data
  getData(key: string): unknown;
  setData(key: string, value: unknown): void;

  // Repository
  getElement(name: string): string | undefined;

  // API
  fetch(url: string, options?: RequestInit): Promise<Response>;
  fetchJson<T>(url: string, options?: RequestInit): Promise<T>;
}

export interface ExpectAPI {
  (value: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(item: unknown): void;
    toMatch(pattern: RegExp): void;
    toBeGreaterThan(n: number): void;
    toBeLessThan(n: number): void;
  };
}

export interface ScriptResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  screenshots: string[];
  logs: string[];
}

// ============================================================================
// Script Runner
// ============================================================================

export class ScriptRunner {
  private config: LiteQAConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private selfHealer: SelfHealingLocator;
  private dataManager: TestDataManager;
  private objectRepository: ObjectRepository;
  private screenshots: string[] = [];
  private logs: string[] = [];
  private testData: Map<string, unknown> = new Map();

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.selfHealer = new SelfHealingLocator(this.config);
    this.dataManager = new TestDataManager();
    this.objectRepository = new ObjectRepository();
  }

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * Run a script file
   */
  async runFile(scriptPath: string, params?: Record<string, unknown>): Promise<ScriptResult> {
    const content = fs.readFileSync(scriptPath, 'utf-8');
    const name = path.basename(scriptPath, path.extname(scriptPath));
    return this.runScript(content, name, params);
  }

  /**
   * Run script content
   */
  async runScript(
    script: string,
    name: string = 'script',
    params?: Record<string, unknown>
  ): Promise<ScriptResult> {
    const startTime = Date.now();
    this.screenshots = [];
    this.logs = [];
    this.testData.clear();

    logger.info(`Running script: ${name}`);

    try {
      await this.init();

      // Create context
      const ctx = this.createContext(params || {});

      // Wrap script in async function
      const wrappedScript = `
        (async () => {
          ${script}
        })();
      `;

      // Execute
      const result = vm.runInNewContext(wrappedScript, ctx, {
        filename: `${name}.js`,
        timeout: this.config.defaultTimeout * 10,
      });

      await result;

      const duration = Date.now() - startTime;

      logger.success(`Script passed: ${name} (${duration}ms)`);

      return {
        name,
        passed: true,
        duration,
        screenshots: this.screenshots,
        logs: this.logs,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      logger.error(`Script failed: ${name} - ${errorMessage}`);

      return {
        name,
        passed: false,
        duration,
        error: errorMessage,
        screenshots: this.screenshots,
        logs: this.logs,
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Run inline script (for YAML script steps)
   */
  async runInline(
    script: string,
    page: Page,
    context: BrowserContext,
    browser: Browser
  ): Promise<void> {
    this.page = page;
    this.context = context;
    this.browser = browser;

    const ctx = this.createContext({});

    const wrappedScript = `
      (async () => {
        ${script}
      })();
    `;

    const result = vm.runInNewContext(wrappedScript, ctx, {
      timeout: this.config.defaultTimeout,
    });

    await result;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private async init(): Promise<void> {
    const browserType = {
      chromium,
      firefox,
      webkit,
    }[this.config.browser];

    this.browser = await browserType.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    });

    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
    });

    this.page = await this.context.newPage();
  }

  private async cleanup(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});

    this.page = null;
    this.context = null;
    this.browser = null;
  }

  // ============================================================================
  // Context Creation
  // ============================================================================

  private createContext(params: Record<string, unknown>): ScriptContext {
    const self = this;

    const helpers: LiteQAHelpers = {
      // Navigation
      async goto(url, options) {
        await self.page!.goto(url, {
          waitUntil: options?.waitUntil || 'load',
        });
      },

      // Actions with self-healing
      async click(selector) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.click();
      },

      async fill(selector, value) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.fill(value);
      },

      async type(selector, text) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.type(text);
      },

      async select(selector, value) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.selectOption(value);
      },

      async check(selector) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.check();
      },

      async uncheck(selector) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.uncheck();
      },

      async hover(selector) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.hover();
      },

      // Waits
      async waitForSelector(selector, options) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        await locator.waitFor({ state: options?.state || 'visible' });
      },

      async waitForNavigation() {
        await self.page!.waitForNavigation();
      },

      async waitForLoadState(state) {
        await self.page!.waitForLoadState(state || 'load');
      },

      // Assertions
      async expectVisible(selector) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        const isVisible = await locator.isVisible();
        if (!isVisible) {
          throw new Error(`Expected ${selector} to be visible`);
        }
      },

      async expectHidden(selector) {
        const locator = self.page!.locator(selector);
        const isVisible = await locator.isVisible();
        if (isVisible) {
          throw new Error(`Expected ${selector} to be hidden`);
        }
      },

      async expectText(selector, text) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        const actual = await locator.textContent();
        if (!actual?.includes(text)) {
          throw new Error(`Expected "${text}" but got "${actual}"`);
        }
      },

      async expectValue(selector, value) {
        const { locator } = await self.selfHealer.findElement(self.page!, selector);
        const actual = await locator.inputValue();
        if (actual !== value) {
          throw new Error(`Expected value "${value}" but got "${actual}"`);
        }
      },

      async expectUrl(pattern) {
        const url = self.page!.url();
        if (pattern instanceof RegExp) {
          if (!pattern.test(url)) {
            throw new Error(`URL "${url}" doesn't match pattern ${pattern}`);
          }
        } else {
          if (!url.includes(pattern)) {
            throw new Error(`URL "${url}" doesn't contain "${pattern}"`);
          }
        }
      },

      // Screenshots
      async screenshot(name, options) {
        const filename = `${name}-${Date.now()}.png`;
        const filepath = path.join(self.config.screenshotsDir, filename);
        fs.mkdirSync(self.config.screenshotsDir, { recursive: true });
        await self.page!.screenshot({
          path: filepath,
          fullPage: options?.fullPage || false,
        });
        self.screenshots.push(filepath);
        return filepath;
      },

      // Data
      getData(key) {
        return self.testData.get(key);
      },

      setData(key, value) {
        self.testData.set(key, value);
      },

      // Repository
      getElement(name) {
        return self.objectRepository.resolveReference(`\${${name}}`);
      },

      // API
      async fetch(url, options) {
        return fetch(url, options);
      },

      async fetchJson<T>(url, options) {
        const response = await fetch(url, options);
        return response.json() as Promise<T>;
      },
    };

    // Expect API
    const expect: ExpectAPI = (value: unknown) => ({
      toBe(expected) {
        if (value !== expected) {
          throw new Error(`Expected ${expected} but got ${value}`);
        }
      },
      toEqual(expected) {
        if (JSON.stringify(value) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(value)}`);
        }
      },
      toBeTruthy() {
        if (!value) {
          throw new Error(`Expected truthy value but got ${value}`);
        }
      },
      toBeFalsy() {
        if (value) {
          throw new Error(`Expected falsy value but got ${value}`);
        }
      },
      toContain(item) {
        if (Array.isArray(value)) {
          if (!value.includes(item)) {
            throw new Error(`Expected array to contain ${item}`);
          }
        } else if (typeof value === 'string') {
          if (!value.includes(String(item))) {
            throw new Error(`Expected string to contain ${item}`);
          }
        }
      },
      toMatch(pattern) {
        if (!pattern.test(String(value))) {
          throw new Error(`Expected ${value} to match ${pattern}`);
        }
      },
      toBeGreaterThan(n) {
        if (typeof value !== 'number' || value <= n) {
          throw new Error(`Expected ${value} to be greater than ${n}`);
        }
      },
      toBeLessThan(n) {
        if (typeof value !== 'number' || value >= n) {
          throw new Error(`Expected ${value} to be less than ${n}`);
        }
      },
    });

    // Custom logger for scripts
    const scriptLog = {
      info: (msg: string) => {
        self.logs.push(`[INFO] ${msg}`);
        logger.info(msg);
      },
      debug: (msg: string) => {
        self.logs.push(`[DEBUG] ${msg}`);
        logger.debug(msg);
      },
      warn: (msg: string) => {
        self.logs.push(`[WARN] ${msg}`);
        logger.warn(msg);
      },
      error: (msg: string) => {
        self.logs.push(`[ERROR] ${msg}`);
        logger.error(msg);
      },
    };

    return {
      browser: this.browser!,
      context: this.context!,
      page: this.page!,
      liteqa: helpers,
      data: this.dataManager,
      repository: this.objectRepository,
      log: scriptLog as typeof logger,
      expect,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      params,
      env: process.env as Record<string, string | undefined>,

      // Also expose common globals
      console: {
        log: (...args: unknown[]) => {
          const msg = args.map(a => String(a)).join(' ');
          self.logs.push(msg);
          console.log(...args);
        },
      },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Promise,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      fetch,
    } as unknown as ScriptContext;
  }

  // ============================================================================
  // Load Repository and Data
  // ============================================================================

  loadRepository(filePath: string): void {
    this.objectRepository = new ObjectRepository(filePath);
  }

  loadTestData(config: string | object): void {
    if (typeof config === 'string') {
      const content = fs.readFileSync(config, 'utf-8');
      const parsed = JSON.parse(content);
      this.dataManager.loadConfig(parsed);
    } else {
      this.dataManager.loadConfig(config as any);
    }
  }
}

// ============================================================================
// Script Step Type (for YAML flows)
// ============================================================================

export interface ScriptStep {
  action: 'script';
  code: string;
  description?: string;
}
