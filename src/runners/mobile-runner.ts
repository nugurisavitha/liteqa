// ============================================================================
// LiteQA - Mobile Runner (Appium)
// ============================================================================
//
// This runner provides basic Android mobile automation support using Appium.
// It requires Appium to be installed and running on the system.
//
// Setup:
//   npm install -g appium
//   appium driver install uiautomator2
//   appium  # Start Appium server
//
// Requirements:
//   - Android SDK with platform-tools
//   - ANDROID_HOME environment variable set
//   - An Android emulator running or real device connected
//
// ============================================================================

import { remote, Browser } from 'webdriverio';
import * as fs from 'fs';
import * as path from 'path';
import {
  Flow,
  Step,
  StepResult,
  FlowResult,
  LiteQAConfig,
  DEFAULT_CONFIG,
  MobileTapStep,
  MobileTypeStep,
  MobileWaitForTextStep,
  MobileSwipeStep,
} from '../core/types';
import { logger } from '../utils/logger';

export class MobileRunner {
  private config: LiteQAConfig;
  private driver: Browser | null = null;
  private flowName = '';

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if Appium is available
   */
  async isAppiumAvailable(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:4723/status');
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Initialize Appium driver
   */
  private async init(): Promise<void> {
    const isAvailable = await this.isAppiumAvailable();

    if (!isAvailable) {
      throw new Error(
        'Appium server is not running.\n\n' +
        'To use mobile testing, please:\n' +
        '  1. Install Appium: npm install -g appium\n' +
        '  2. Install Android driver: appium driver install uiautomator2\n' +
        '  3. Start Appium server: appium\n' +
        '  4. Ensure an Android emulator is running or device is connected\n\n' +
        'For more details, see: https://appium.io/docs/en/latest/'
      );
    }

    const capabilities = this.config.mobile?.capabilities || {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Android Emulator',
      'appium:newCommandTimeout': 300,
    };

    const appiumUrl = this.config.mobile?.appiumUrl || 'http://127.0.0.1:4723';

    try {
      this.driver = await remote({
        capabilities,
        logLevel: 'warn',
        connectionRetryTimeout: 30000,
        connectionRetryCount: 3,
        path: '/',
        hostname: new URL(appiumUrl).hostname,
        port: parseInt(new URL(appiumUrl).port) || 4723,
      });

      logger.debug('Appium driver initialized');
    } catch (error) {
      throw new Error(
        `Failed to connect to Appium: ${(error as Error).message}\n\n` +
        'Make sure:\n' +
        '  - Appium server is running on port 4723\n' +
        '  - An Android emulator/device is available\n' +
        '  - The app capabilities are correct'
      );
    }
  }

  /**
   * Cleanup Appium driver
   */
  private async cleanup(): Promise<void> {
    if (this.driver) {
      await this.driver.deleteSession();
      this.driver = null;
    }
    logger.debug('Appium driver closed');
  }

  /**
   * Run a complete mobile flow
   */
  async runFlow(flow: Flow): Promise<FlowResult> {
    this.flowName = flow.name;
    const startTime = new Date();
    const stepResults: StepResult[] = [];
    let flowPassed = true;

    logger.flowStart(flow.name);

    try {
      await this.init();

      // Run steps
      const totalSteps = flow.steps.length;
      let stepIndex = 1;

      for (const step of flow.steps) {
        const result = await this.runStep(step, stepIndex++, totalSteps);
        stepResults.push(result);
        if (result.status === 'failed' && !step.continueOnError) {
          flowPassed = false;
          break;
        }
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Flow failed: ${errorMessage}`);

      // Check if it's an Appium availability error
      if (errorMessage.includes('Appium server is not running')) {
        logger.warn('\nMobile testing skipped - Appium not available');
        return {
          flow: flow.name,
          name: flow.name,
          status: 'skipped',
          duration: 0,
          startTime,
          endTime: new Date(),
          steps: [],
          error: errorMessage,
        };
      }

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
    const description = step.description || this.getStepDescription(step);

    logger.step(index, total, step.action, description);

    try {
      await this.executeStep(step);

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
      const screenshot = await this.takeFailureScreenshot(index);

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
  private async executeStep(step: Step): Promise<void> {
    if (!this.driver) {
      throw new Error('Driver not initialized');
    }

    switch (step.action) {
      case 'mobileTap':
        await this.executeTap(step as MobileTapStep);
        break;
      case 'mobileType':
        await this.executeType(step as MobileTypeStep);
        break;
      case 'mobileWaitForText':
        await this.executeWaitForText(step as MobileWaitForTextStep);
        break;
      case 'mobileSwipe':
        await this.executeSwipe(step as MobileSwipeStep);
        break;
      default:
        throw new Error(`Unknown mobile action: ${(step as any).action}`);
    }
  }

  // ============================================================================
  // Step Implementations
  // ============================================================================

  private async executeTap(step: MobileTapStep): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized');

    const element = await this.findElement(step.selector);
    await element.click();
  }

  private async executeType(step: MobileTypeStep): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized');

    const element = await this.findElement(step.selector);
    await element.setValue(step.text);
  }

  private async executeWaitForText(step: MobileWaitForTextStep): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized');

    const timeout = step.timeout || this.config.defaultTimeout;

    await this.driver.waitUntil(
      async () => {
        const source = await this.driver!.getPageSource();
        return source.includes(step.text);
      },
      {
        timeout,
        timeoutMsg: `Text "${step.text}" not found within ${timeout}ms`,
      }
    );
  }

  private async executeSwipe(step: MobileSwipeStep): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized');

    const { width, height } = await this.driver.getWindowSize();
    const centerX = width / 2;
    const centerY = height / 2;

    let startX = centerX;
    let startY = centerY;
    let endX = centerX;
    let endY = centerY;

    const swipeDistance = Math.min(width, height) * 0.4;

    switch (step.direction) {
      case 'up':
        startY = centerY + swipeDistance / 2;
        endY = centerY - swipeDistance / 2;
        break;
      case 'down':
        startY = centerY - swipeDistance / 2;
        endY = centerY + swipeDistance / 2;
        break;
      case 'left':
        startX = centerX + swipeDistance / 2;
        endX = centerX - swipeDistance / 2;
        break;
      case 'right':
        startX = centerX - swipeDistance / 2;
        endX = centerX + swipeDistance / 2;
        break;
    }

    await this.driver.action('pointer', {
      parameters: { pointerType: 'touch' }
    })
      .move({ x: Math.round(startX), y: Math.round(startY) })
      .down()
      .move({ x: Math.round(endX), y: Math.round(endY), duration: 300 })
      .up()
      .perform();
  }

  // ============================================================================
  // Element Finding with Multiple Strategies
  // ============================================================================

  private async findElement(selector: string): Promise<WebdriverIO.Element> {
    if (!this.driver) throw new Error('Driver not initialized');

    // Try multiple strategies
    const strategies = [
      // Resource ID
      () => this.driver!.$(`android=new UiSelector().resourceId("${selector}")`),
      // Content description (accessibility)
      () => this.driver!.$(`android=new UiSelector().description("${selector}")`),
      // Text
      () => this.driver!.$(`android=new UiSelector().text("${selector}")`),
      // Text contains
      () => this.driver!.$(`android=new UiSelector().textContains("${selector}")`),
      // Class name + text
      () => this.driver!.$(`android=new UiSelector().className("android.widget.Button").text("${selector}")`),
      // XPath fallback
      () => this.driver!.$(`//*[@text="${selector}" or @content-desc="${selector}"]`),
    ];

    for (const strategy of strategies) {
      try {
        const element = await strategy();
        if (await element.isExisting()) {
          return element;
        }
      } catch {
        // Try next strategy
      }
    }

    throw new Error(`Element not found: ${selector}`);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getStepDescription(step: Step): string {
    switch (step.action) {
      case 'mobileTap':
      case 'mobileType':
        return (step as any).selector;
      case 'mobileWaitForText':
        return `"${(step as MobileWaitForTextStep).text}"`;
      case 'mobileSwipe':
        return (step as MobileSwipeStep).direction;
      default:
        return '';
    }
  }

  private async takeFailureScreenshot(stepIndex: number): Promise<string | undefined> {
    if (!this.driver) return undefined;

    try {
      const filename = `${this.flowName.replace(/\s+/g, '-')}-mobile-failure-step-${stepIndex}.png`;
      const filepath = path.join(this.config.screenshotsDir, filename);

      fs.mkdirSync(this.config.screenshotsDir, { recursive: true });

      const screenshot = await this.driver.takeScreenshot();
      fs.writeFileSync(filepath, screenshot, 'base64');

      return filepath;
    } catch {
      return undefined;
    }
  }
}
