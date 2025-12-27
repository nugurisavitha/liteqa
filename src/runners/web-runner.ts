// ============================================================================
// LiteQA - Web Runner (Playwright)
// ============================================================================

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  Flow,
  Step,
  StepResult,
  FlowResult,
  LiteQAConfig,
  DEFAULT_CONFIG,
  GotoStep,
  ClickStep,
  FillStep,
  TypeStep,
  ExpectTextStep,
  ExpectVisibleStep,
  WaitForSelectorStep,
  WaitForLoadStateStep,
  ScreenshotStep,
  SelectStep,
  HoverStep,
  PressStep,
  WaitStep,
} from '../core/types';
import { SelfHealingLocator } from '../core/self-heal';
import { logger } from '../utils/logger';

export class WebRunner {
  private config: LiteQAConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private selfHealer: SelfHealingLocator;
  private screenshotCounter = 0;
  private flowName = '';

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.selfHealer = new SelfHealingLocator(this.config);
  }

  /**
   * Initialize browser and create new page
   */
  async init(): Promise<void> {
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
    this.screenshotCounter = 0;

    logger.debug('Browser initialized');
  }

  /**
   * Close browser and cleanup
   */
  async cleanup(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    // Save healed selectors
    await this.selfHealer.saveHealedSelectors(this.config.artifactsDir);

    logger.debug('Browser closed');
  }

  /**
   * Run a complete flow
   */
  async runFlow(flow: Flow): Promise<FlowResult> {
    this.flowName = flow.name;
    const startTime = new Date();
    const stepResults: StepResult[] = [];
    let flowPassed = true;

    logger.flowStart(flow.name);

    try {
      await this.init();

      // Run setup steps
      if (flow.setup) {
        for (const step of flow.setup) {
          const result = await this.runStep(step, stepResults.length + 1, flow.setup.length + flow.steps.length);
          stepResults.push(result);
          if (result.status === 'failed' && !step.continueOnError) {
            flowPassed = false;
            break;
          }
        }
      }

      // Run main steps (only if setup passed)
      if (flowPassed) {
        const totalSteps = (flow.setup?.length || 0) + flow.steps.length + (flow.teardown?.length || 0);
        let stepIndex = (flow.setup?.length || 0) + 1;

        for (const step of flow.steps) {
          const result = await this.runStep(step, stepIndex++, totalSteps);
          stepResults.push(result);
          if (result.status === 'failed' && !step.continueOnError) {
            flowPassed = false;
            break;
          }
        }
      }

      // Always run teardown
      if (flow.teardown) {
        for (const step of flow.teardown) {
          const result = await this.runStep(step, stepResults.length + 1, stepResults.length + flow.teardown.length);
          stepResults.push(result);
        }
      }
    } catch (error) {
      logger.error(`Flow failed with error: ${(error as Error).message}`);
      flowPassed = false;
    } finally {
      await this.cleanup();
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    logger.flowEnd(flow.name, flowPassed, duration);

    return {
      flow: flow.name,
      name: flow.name,
      status: flowPassed ? 'passed' : 'failed',
      duration,
      startTime,
      endTime,
      steps: stepResults,
    };
  }

  /**
   * Run a single step
   */
  private async runStep(step: Step, index: number, total: number): Promise<StepResult> {
    const startTime = Date.now();
    const timeout = step.timeout || this.config.defaultTimeout;
    const description = step.description || this.getStepDescription(step);

    logger.step(index, total, step.action, description);

    try {
      await this.executeStep(step, timeout);

      const duration = Date.now() - startTime;
      logger.stepPass(index, total, step.action, duration);

      return {
        step,
        status: 'passed',
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      logger.stepFail(index, total, step.action, errorMessage);

      // Take failure screenshot
      const screenshot = await this.takeFailureScreenshot(step, index);

      return {
        step,
        status: 'failed',
        duration,
        error: errorMessage,
        screenshot,
      };
    }
  }

  /**
   * Execute a step based on its action type
   */
  private async executeStep(step: Step, timeout: number): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    switch (step.action) {
      case 'goto':
        await this.executeGoto(step as GotoStep, timeout);
        break;
      case 'click':
        await this.executeClick(step as ClickStep, timeout);
        break;
      case 'fill':
        await this.executeFill(step as FillStep, timeout);
        break;
      case 'type':
        await this.executeType(step as TypeStep, timeout);
        break;
      case 'expectText':
        await this.executeExpectText(step as ExpectTextStep, timeout);
        break;
      case 'expectVisible':
        await this.executeExpectVisible(step as ExpectVisibleStep, timeout);
        break;
      case 'waitForSelector':
        await this.executeWaitForSelector(step as WaitForSelectorStep, timeout);
        break;
      case 'waitForLoadState':
        await this.executeWaitForLoadState(step as WaitForLoadStateStep, timeout);
        break;
      case 'screenshot':
        await this.executeScreenshot(step as ScreenshotStep);
        break;
      case 'select':
        await this.executeSelect(step as SelectStep, timeout);
        break;
      case 'hover':
        await this.executeHover(step as HoverStep, timeout);
        break;
      case 'press':
        await this.executePress(step as PressStep, timeout);
        break;
      case 'wait':
        await this.executeWait(step as WaitStep);
        break;
      default:
        throw new Error(`Unknown web action: ${(step as any).action}`);
    }
  }

  // ============================================================================
  // Step Implementations
  // ============================================================================

  private async executeGoto(step: GotoStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    await this.page.goto(step.url, {
      waitUntil: step.waitUntil || 'load',
      timeout,
    });

    // For Angular SSR apps, wait for hydration
    await this.waitForAngularHydration();
  }

  private async executeClick(step: ClickStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.click({ button: step.button || 'left', timeout });
  }

  private async executeFill(step: FillStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.fill(step.value, { timeout });
  }

  private async executeType(step: TypeStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.type(step.text, { delay: step.delay, timeout });
  }

  private async executeExpectText(step: ExpectTextStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    const text = await locator.textContent({ timeout });

    if (step.exact) {
      if (text !== step.text) {
        throw new Error(`Expected exact text "${step.text}" but got "${text}"`);
      }
    } else {
      if (!text?.includes(step.text)) {
        throw new Error(`Expected text to contain "${step.text}" but got "${text}"`);
      }
    }
  }

  private async executeExpectVisible(step: ExpectVisibleStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.waitFor({ state: 'visible', timeout });
  }

  private async executeWaitForSelector(step: WaitForSelectorStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.waitFor({ state: step.state || 'visible', timeout });
  }

  private async executeWaitForLoadState(step: WaitForLoadStateStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    await this.page.waitForLoadState(step.state, { timeout });
  }

  private async executeScreenshot(step: ScreenshotStep): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    this.screenshotCounter++;
    const name = step.name || `screenshot-${this.screenshotCounter}`;
    const filename = `${this.flowName.replace(/\s+/g, '-')}-${name}.png`;
    const filepath = path.join(this.config.screenshotsDir, filename);

    fs.mkdirSync(this.config.screenshotsDir, { recursive: true });

    await this.page.screenshot({
      path: filepath,
      fullPage: step.fullPage || false,
    });

    logger.debug(`Screenshot saved: ${filepath}`);
  }

  private async executeSelect(step: SelectStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.selectOption(step.value, { timeout });
  }

  private async executeHover(step: HoverStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

    if (healed) {
      logger.stepHealed(healed.original, healed.healed, healed.confidence);
    }

    await locator.hover({ timeout });
  }

  private async executePress(step: PressStep, timeout: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    if (step.selector) {
      const { locator, healed } = await this.selfHealer.findElement(this.page, step.selector, timeout);

      if (healed) {
        logger.stepHealed(healed.original, healed.healed, healed.confidence);
      }

      await locator.press(step.key, { timeout });
    } else {
      await this.page.keyboard.press(step.key);
    }
  }

  private async executeWait(step: WaitStep): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, step.duration));
  }

  // ============================================================================
  // Angular SSR Helpers
  // ============================================================================

  /**
   * Wait for Angular to complete hydration
   * This is crucial for Angular SSR apps to avoid flaky tests
   */
  private async waitForAngularHydration(): Promise<void> {
    if (!this.page) return;

    try {
      // Wait for Angular to be defined and stable
      await this.page.waitForFunction(
        () => {
          // Check if Angular is present
          const ngVersion = (window as any).getAllAngularRootElements?.() ||
                           (window as any).ng?.getComponent;

          if (!ngVersion) {
            // Not an Angular app, continue
            return true;
          }

          // Wait for zone.js to be stable (no pending tasks)
          const zone = (window as any).Zone?.current;
          if (zone) {
            // Angular Zone is present, check if stable
            return !zone._hasPendingMicrotasks && !zone._hasPendingMacrotasks;
          }

          return true;
        },
        { timeout: 5000 }
      ).catch(() => {
        // Ignore timeout - may not be Angular app
      });
    } catch {
      // Not an Angular app or hydration not needed
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getStepDescription(step: Step): string {
    switch (step.action) {
      case 'goto':
        return (step as GotoStep).url;
      case 'click':
      case 'fill':
      case 'type':
      case 'expectText':
      case 'expectVisible':
      case 'waitForSelector':
      case 'select':
      case 'hover':
        return (step as any).selector;
      case 'screenshot':
        return (step as ScreenshotStep).name || 'screenshot';
      case 'wait':
        return `${(step as WaitStep).duration}ms`;
      case 'press':
        return (step as PressStep).key;
      default:
        return '';
    }
  }

  private async takeFailureScreenshot(step: Step, index: number): Promise<string | undefined> {
    if (!this.page) return undefined;

    try {
      const filename = `${this.flowName.replace(/\s+/g, '-')}-failure-step-${index}.png`;
      const filepath = path.join(this.config.screenshotsDir, filename);

      fs.mkdirSync(this.config.screenshotsDir, { recursive: true });

      await this.page.screenshot({
        path: filepath,
        fullPage: true,
      });

      return filepath;
    } catch {
      return undefined;
    }
  }
}
