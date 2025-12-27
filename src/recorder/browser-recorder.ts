// ============================================================================
// LiteQA - Browser Recorder (Record & Playback)
// ============================================================================
//
// Records user interactions in the browser and generates:
// - YAML test flows
// - Playwright scripts
// - Object repository entries
//
// Features:
// - Click recording
// - Input recording
// - Navigation recording
// - Assertion suggestions
// - Smart selector generation
//
// ============================================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as readline from 'readline';
import { logger } from '../utils/logger';
import { Step, Flow } from '../core/types';

// ============================================================================
// Types
// ============================================================================

export interface RecordedAction {
  timestamp: number;
  type: 'click' | 'fill' | 'type' | 'select' | 'check' | 'navigate' | 'wait' | 'screenshot' | 'assertion';
  selector?: string;
  value?: string;
  url?: string;
  text?: string;
  tagName?: string;
  elementInfo?: ElementInfo;
}

export interface ElementInfo {
  tagName: string;
  id?: string;
  name?: string;
  className?: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
  role?: string;
  type?: string;
  href?: string;
}

export interface RecorderConfig {
  startUrl: string;
  outputDir?: string;
  outputFormat?: 'yaml' | 'typescript' | 'both';
  includeAssertions?: boolean;
  includeWaits?: boolean;
  smartSelectors?: boolean;
  viewport?: { width: number; height: number };
}

export interface RecordingSession {
  name: string;
  startTime: Date;
  endTime?: Date;
  startUrl: string;
  actions: RecordedAction[];
}

// ============================================================================
// Browser Recorder
// ============================================================================

export class BrowserRecorder {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: RecorderConfig;
  private session: RecordingSession | null = null;
  private isRecording = false;
  private rl: readline.Interface | null = null;

  constructor(config: RecorderConfig) {
    this.config = {
      outputDir: './recordings',
      outputFormat: 'yaml',
      includeAssertions: true,
      includeWaits: true,
      smartSelectors: true,
      viewport: { width: 1280, height: 720 },
      ...config,
    };
  }

  // ============================================================================
  // Main Recording Flow
  // ============================================================================

  /**
   * Start recording session
   */
  async startRecording(sessionName?: string): Promise<void> {
    logger.info('Starting recording session...');
    logger.info('Interact with the browser. Press Ctrl+C in terminal to stop recording.');

    try {
      // Launch browser
      this.browser = await chromium.launch({
        headless: false, // Must be visible for recording
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
      });

      this.page = await this.context.newPage();

      // Initialize session
      this.session = {
        name: sessionName || `recording-${Date.now()}`,
        startTime: new Date(),
        startUrl: this.config.startUrl,
        actions: [],
      };

      // Set up event listeners
      await this.setupEventListeners();

      // Navigate to start URL
      await this.page.goto(this.config.startUrl, { waitUntil: 'networkidle' });

      this.isRecording = true;

      // Record initial navigation
      this.recordAction({
        timestamp: Date.now(),
        type: 'navigate',
        url: this.config.startUrl,
      });

      // Set up CLI input for commands
      this.setupCliInput();

      // Keep process running
      await this.waitForStop();

    } catch (error) {
      logger.error(`Recording error: ${(error as Error).message}`);
      await this.stopRecording();
      throw error;
    }
  }

  /**
   * Stop recording and save
   */
  async stopRecording(): Promise<string | undefined> {
    if (!this.isRecording) return;

    this.isRecording = false;

    if (this.session) {
      this.session.endTime = new Date();
    }

    // Clean up readline
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // Close browser
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});

    this.page = null;
    this.context = null;
    this.browser = null;

    // Save recording
    if (this.session && this.session.actions.length > 0) {
      const outputPath = await this.saveRecording();
      logger.success(`Recording saved: ${outputPath}`);
      return outputPath;
    }

    logger.warn('No actions recorded');
    return undefined;
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  private async setupEventListeners(): Promise<void> {
    if (!this.page) return;

    // Inject recording script
    await this.page.addInitScript(() => {
      // @ts-ignore
      window.__liteqa_recorder = {
        actions: [],
        getSelector: (element: Element): string => {
          // Try data-testid
          const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
          if (testId) return `[data-testid="${testId}"]`;

          // Try ID
          const id = element.getAttribute('id');
          if (id && !id.match(/^\d|^ng-|^mat-|^react-/)) return `#${id}`;

          // Try aria-label
          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) return `[aria-label="${ariaLabel}"]`;

          // Try role + name
          const role = element.getAttribute('role');
          const name = element.getAttribute('name');
          if (role && name) return `[role="${role}"][name="${name}"]`;

          // Try name
          if (name) return `[name="${name}"]`;

          // Try placeholder for inputs
          const placeholder = (element as HTMLInputElement).placeholder;
          if (placeholder) return `[placeholder="${placeholder}"]`;

          // Fall back to tag + text
          const tagName = element.tagName.toLowerCase();
          const text = (element as HTMLElement).innerText?.trim().slice(0, 30);
          if (text && ['button', 'a', 'span', 'label'].includes(tagName)) {
            return `${tagName}:has-text("${text}")`;
          }

          // Last resort: nth-of-type
          const parent = element.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
            const index = siblings.indexOf(element) + 1;
            return `${tagName}:nth-of-type(${index})`;
          }

          return tagName;
        },
        getElementInfo: (element: Element): any => {
          const el = element as HTMLElement;
          return {
            tagName: el.tagName.toLowerCase(),
            id: el.id || undefined,
            name: el.getAttribute('name') || undefined,
            className: el.className || undefined,
            text: el.innerText?.trim().slice(0, 100) || undefined,
            placeholder: (el as HTMLInputElement).placeholder || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            testId: el.getAttribute('data-testid') || undefined,
            role: el.getAttribute('role') || undefined,
            type: (el as HTMLInputElement).type || undefined,
            href: (el as HTMLAnchorElement).href || undefined,
          };
        },
      };

      // Click listener
      document.addEventListener('click', (e) => {
        const target = e.target as Element;
        if (!target) return;

        // @ts-ignore
        const recorder = window.__liteqa_recorder;
        const action = {
          timestamp: Date.now(),
          type: 'click',
          selector: recorder.getSelector(target),
          elementInfo: recorder.getElementInfo(target),
        };
        recorder.actions.push(action);

        // Dispatch custom event for Playwright
        document.dispatchEvent(new CustomEvent('liteqa:action', { detail: action }));
      }, true);

      // Input listener
      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        if (!target || !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

        // @ts-ignore
        const recorder = window.__liteqa_recorder;

        // Debounce
        // @ts-ignore
        clearTimeout(target.__liteqa_timeout);
        // @ts-ignore
        target.__liteqa_timeout = setTimeout(() => {
          const action = {
            timestamp: Date.now(),
            type: target.tagName === 'SELECT' ? 'select' : 'fill',
            selector: recorder.getSelector(target),
            value: target.value,
            elementInfo: recorder.getElementInfo(target),
          };
          recorder.actions.push(action);
          document.dispatchEvent(new CustomEvent('liteqa:action', { detail: action }));
        }, 500);
      }, true);

      // Change listener for checkboxes/radios
      document.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (!target || !['checkbox', 'radio'].includes(target.type)) return;

        // @ts-ignore
        const recorder = window.__liteqa_recorder;
        const action = {
          timestamp: Date.now(),
          type: 'check',
          selector: recorder.getSelector(target),
          value: target.checked ? 'check' : 'uncheck',
          elementInfo: recorder.getElementInfo(target),
        };
        recorder.actions.push(action);
        document.dispatchEvent(new CustomEvent('liteqa:action', { detail: action }));
      }, true);
    });

    // Listen for actions from page
    await this.page.exposeFunction('__liteqa_recordAction', (action: RecordedAction) => {
      this.recordAction(action);
    });

    // Navigation listener
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame()) {
        const url = frame.url();
        if (!url.startsWith('about:')) {
          this.recordAction({
            timestamp: Date.now(),
            type: 'navigate',
            url,
          });
        }
      }
    });

    // Listen for custom events
    this.page.on('console', (msg) => {
      if (msg.text().includes('liteqa:action')) {
        // Already handled by exposeFunction
      }
    });

    // Capture page actions via CDP
    const client = await this.context!.newCDPSession(this.page);

    // Listen for actual DOM events
    this.page.on('domcontentloaded', async () => {
      // Re-get actions from page
      const actions = await this.page?.evaluate(() => {
        // @ts-ignore
        const recorder = window.__liteqa_recorder;
        if (recorder) {
          const pending = [...recorder.actions];
          recorder.actions = [];
          return pending;
        }
        return [];
      });

      if (actions) {
        for (const action of actions) {
          this.recordAction(action);
        }
      }
    });
  }

  private recordAction(action: RecordedAction): void {
    if (!this.session || !this.isRecording) return;

    // Avoid duplicate navigations
    if (action.type === 'navigate') {
      const lastNav = [...this.session.actions].reverse().find(a => a.type === 'navigate');
      if (lastNav && lastNav.url === action.url) return;
    }

    this.session.actions.push(action);

    // Log action
    const desc = this.describeAction(action);
    logger.debug(`Recorded: ${desc}`);
  }

  private describeAction(action: RecordedAction): string {
    switch (action.type) {
      case 'click':
        return `Click ${action.selector}`;
      case 'fill':
        return `Fill ${action.selector} with "${action.value?.slice(0, 20)}..."`;
      case 'select':
        return `Select "${action.value}" in ${action.selector}`;
      case 'check':
        return `${action.value} ${action.selector}`;
      case 'navigate':
        return `Navigate to ${action.url}`;
      default:
        return `${action.type}`;
    }
  }

  // ============================================================================
  // CLI Input
  // ============================================================================

  private setupCliInput(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\nRecording commands:');
    console.log('  screenshot [name] - Take a screenshot');
    console.log('  assert <selector> - Add visibility assertion');
    console.log('  assertText <selector> <text> - Add text assertion');
    console.log('  wait <ms> - Add wait step');
    console.log('  stop - Stop recording\n');

    this.rl.on('line', async (input) => {
      const parts = input.trim().split(' ');
      const command = parts[0].toLowerCase();

      switch (command) {
        case 'screenshot':
          this.recordAction({
            timestamp: Date.now(),
            type: 'screenshot',
            value: parts[1] || `screenshot-${this.session?.actions.length}`,
          });
          logger.info('Screenshot recorded');
          break;

        case 'assert':
          if (parts[1]) {
            this.recordAction({
              timestamp: Date.now(),
              type: 'assertion',
              selector: parts[1],
              value: 'visible',
            });
            logger.info('Assertion recorded');
          }
          break;

        case 'asserttext':
          if (parts[1] && parts[2]) {
            this.recordAction({
              timestamp: Date.now(),
              type: 'assertion',
              selector: parts[1],
              text: parts.slice(2).join(' '),
              value: 'text',
            });
            logger.info('Text assertion recorded');
          }
          break;

        case 'wait':
          if (parts[1]) {
            this.recordAction({
              timestamp: Date.now(),
              type: 'wait',
              value: parts[1],
            });
            logger.info('Wait recorded');
          }
          break;

        case 'stop':
        case 'quit':
        case 'exit':
          await this.stopRecording();
          process.exit(0);
          break;
      }
    });

    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\nStopping recording...');
      await this.stopRecording();
      process.exit(0);
    });
  }

  private waitForStop(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.isRecording) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  // ============================================================================
  // Save Recording
  // ============================================================================

  private async saveRecording(): Promise<string> {
    if (!this.session) throw new Error('No session to save');

    fs.mkdirSync(this.config.outputDir!, { recursive: true });

    const baseName = this.session.name;
    let outputPath = '';

    // Convert actions to steps
    const steps = this.convertActionsToSteps(this.session.actions);

    // Save as YAML
    if (this.config.outputFormat === 'yaml' || this.config.outputFormat === 'both') {
      const flow: Flow = {
        name: this.session.name,
        description: `Recorded on ${this.session.startTime.toISOString()}`,
        runner: 'web',
        steps,
      };

      outputPath = path.join(this.config.outputDir!, `${baseName}.yaml`);
      const yamlContent = yaml.dump(flow, { indent: 2 });
      fs.writeFileSync(outputPath, yamlContent, 'utf-8');
    }

    // Save as TypeScript
    if (this.config.outputFormat === 'typescript' || this.config.outputFormat === 'both') {
      const tsPath = path.join(this.config.outputDir!, `${baseName}.spec.ts`);
      const tsContent = this.generateTypeScript(this.session);
      fs.writeFileSync(tsPath, tsContent, 'utf-8');

      if (this.config.outputFormat === 'typescript') {
        outputPath = tsPath;
      }
    }

    // Save raw recording
    const rawPath = path.join(this.config.outputDir!, `${baseName}.recording.json`);
    fs.writeFileSync(rawPath, JSON.stringify(this.session, null, 2), 'utf-8');

    return outputPath;
  }

  private convertActionsToSteps(actions: RecordedAction[]): Step[] {
    const steps: Step[] = [];

    for (const action of actions) {
      switch (action.type) {
        case 'navigate':
          steps.push({
            action: 'goto',
            url: action.url!,
            description: `Navigate to ${action.url}`,
          } as Step);
          break;

        case 'click':
          steps.push({
            action: 'click',
            selector: action.selector!,
            description: `Click ${action.elementInfo?.text || action.selector}`,
          } as Step);
          break;

        case 'fill':
          steps.push({
            action: 'fill',
            selector: action.selector!,
            value: action.value!,
            description: `Fill ${action.elementInfo?.name || action.selector}`,
          } as Step);
          break;

        case 'select':
          steps.push({
            action: 'select',
            selector: action.selector!,
            value: action.value!,
            description: `Select ${action.value}`,
          } as Step);
          break;

        case 'check':
          steps.push({
            action: 'click',
            selector: action.selector!,
            description: `${action.value} checkbox`,
          } as Step);
          break;

        case 'screenshot':
          steps.push({
            action: 'screenshot',
            name: action.value,
            description: 'Take screenshot',
          } as Step);
          break;

        case 'wait':
          steps.push({
            action: 'wait',
            duration: parseInt(action.value || '1000', 10),
            description: `Wait ${action.value}ms`,
          } as Step);
          break;

        case 'assertion':
          if (action.value === 'visible') {
            steps.push({
              action: 'expectVisible',
              selector: action.selector!,
              description: `Verify ${action.selector} is visible`,
            } as Step);
          } else if (action.value === 'text') {
            steps.push({
              action: 'expectText',
              selector: action.selector!,
              text: action.text!,
              description: `Verify text: ${action.text}`,
            } as Step);
          }
          break;
      }
    }

    return steps;
  }

  private generateTypeScript(session: RecordingSession): string {
    const lines: string[] = [
      '// Auto-generated by LiteQA Recorder',
      `// Recorded: ${session.startTime.toISOString()}`,
      '',
      "import { test, expect } from '@playwright/test';",
      '',
      `test('${session.name}', async ({ page }) => {`,
    ];

    for (const action of session.actions) {
      switch (action.type) {
        case 'navigate':
          lines.push(`  await page.goto('${action.url}');`);
          break;

        case 'click':
          lines.push(`  await page.locator('${action.selector}').click();`);
          break;

        case 'fill':
          const escapedValue = action.value?.replace(/'/g, "\\'") || '';
          lines.push(`  await page.locator('${action.selector}').fill('${escapedValue}');`);
          break;

        case 'select':
          lines.push(`  await page.locator('${action.selector}').selectOption('${action.value}');`);
          break;

        case 'check':
          if (action.value === 'check') {
            lines.push(`  await page.locator('${action.selector}').check();`);
          } else {
            lines.push(`  await page.locator('${action.selector}').uncheck();`);
          }
          break;

        case 'screenshot':
          lines.push(`  await page.screenshot({ path: '${action.value}.png' });`);
          break;

        case 'wait':
          lines.push(`  await page.waitForTimeout(${action.value});`);
          break;

        case 'assertion':
          if (action.value === 'visible') {
            lines.push(`  await expect(page.locator('${action.selector}')).toBeVisible();`);
          } else if (action.value === 'text') {
            lines.push(`  await expect(page.locator('${action.selector}')).toContainText('${action.text}');`);
          }
          break;
      }
    }

    lines.push('});');
    lines.push('');

    return lines.join('\n');
  }

  // ============================================================================
  // Static Methods
  // ============================================================================

  /**
   * Quick record helper
   */
  static async record(startUrl: string, sessionName?: string): Promise<string | undefined> {
    const recorder = new BrowserRecorder({ startUrl });
    await recorder.startRecording(sessionName);
    return recorder.stopRecording();
  }
}
