// ============================================================================
// LiteQA - Desktop Runner (Windows via pywinauto)
// ============================================================================
//
// This runner provides basic Windows desktop automation support using pywinauto.
// It requires Python 3.x and pywinauto to be installed on the system.
//
// Setup:
//   pip install pywinauto
//
// Limitations:
//   - Windows only (pywinauto does not support macOS/Linux)
//   - Basic operations only (launch, click, type, close)
//   - No image-based matching (MVP)
//
// ============================================================================

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  Flow,
  Step,
  StepResult,
  FlowResult,
  LiteQAConfig,
  DEFAULT_CONFIG,
  DesktopLaunchStep,
  DesktopClickStep,
  DesktopTypeStep,
  DesktopCloseStep,
} from '../core/types';
import { logger } from '../utils/logger';

// Python script for pywinauto bridge
const PYWINAUTO_BRIDGE = `
import sys
import json
import time

try:
    from pywinauto import Application, Desktop
    from pywinauto.findwindows import ElementNotFoundError
    from pywinauto.timings import TimeoutError
except ImportError:
    print(json.dumps({"error": "pywinauto not installed. Run: pip install pywinauto"}))
    sys.exit(1)

app = None
window = None

def handle_command(cmd):
    global app, window
    action = cmd.get("action")

    try:
        if action == "launch":
            app_path = cmd.get("app")
            args = cmd.get("args", [])
            app = Application(backend="uia").start(app_path, *args)
            time.sleep(2)  # Wait for app to initialize
            window = app.top_window()
            return {"status": "ok", "title": window.window_text()}

        elif action == "click":
            selector = cmd.get("selector")
            control_type = cmd.get("controlType", "Button")
            if window:
                try:
                    ctrl = window.child_window(title=selector, control_type=control_type)
                    ctrl.click_input()
                    return {"status": "ok"}
                except ElementNotFoundError:
                    # Try by auto_id
                    ctrl = window.child_window(auto_id=selector)
                    ctrl.click_input()
                    return {"status": "ok"}
            return {"error": "No window active"}

        elif action == "type":
            selector = cmd.get("selector")
            text = cmd.get("text")
            if window:
                try:
                    ctrl = window.child_window(title=selector, control_type="Edit")
                    ctrl.type_keys(text, with_spaces=True)
                    return {"status": "ok"}
                except ElementNotFoundError:
                    ctrl = window.child_window(auto_id=selector, control_type="Edit")
                    ctrl.type_keys(text, with_spaces=True)
                    return {"status": "ok"}
            return {"error": "No window active"}

        elif action == "close":
            if app:
                app.kill()
                app = None
                window = None
            return {"status": "ok"}

        else:
            return {"error": f"Unknown action: {action}"}

    except Exception as e:
        return {"error": str(e)}

# Read commands from stdin
for line in sys.stdin:
    try:
        cmd = json.loads(line.strip())
        result = handle_command(cmd)
        print(json.dumps(result))
        sys.stdout.flush()
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.stdout.flush()
`;

export class DesktopRunner {
  private config: LiteQAConfig;
  private pythonProcess: ChildProcess | null = null;
  private flowName = '';
  private isWindows: boolean;

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isWindows = os.platform() === 'win32';
  }

  /**
   * Check if desktop testing is available
   */
  isAvailable(): boolean {
    return this.isWindows;
  }

  /**
   * Initialize the Python bridge
   */
  private async init(): Promise<void> {
    if (!this.isWindows) {
      throw new Error(
        'Desktop testing is only available on Windows.\n' +
        'pywinauto requires Windows APIs for UI automation.\n' +
        'For macOS/Linux desktop testing, consider using:\n' +
        '  - macOS: AppleScript or Accessibility APIs\n' +
        '  - Linux: AT-SPI or LDTP'
      );
    }

    // Create temp Python script
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, 'liteqa-desktop-bridge.py');
    fs.writeFileSync(scriptPath, PYWINAUTO_BRIDGE, 'utf-8');

    // Start Python process
    this.pythonProcess = spawn('python', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle errors
    this.pythonProcess.stderr?.on('data', (data) => {
      logger.debug(`Desktop bridge stderr: ${data}`);
    });

    this.pythonProcess.on('error', (err) => {
      throw new Error(`Failed to start Python bridge: ${err.message}`);
    });

    // Wait for process to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    logger.debug('Desktop bridge initialized');
  }

  /**
   * Send command to Python bridge and get response
   */
  private async sendCommand(command: object): Promise<{ status?: string; error?: string }> {
    if (!this.pythonProcess || !this.pythonProcess.stdin || !this.pythonProcess.stdout) {
      throw new Error('Python bridge not initialized');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Desktop command timeout'));
      }, this.config.defaultTimeout);

      const onData = (data: Buffer) => {
        clearTimeout(timeout);
        this.pythonProcess?.stdout?.removeListener('data', onData);
        try {
          const result = JSON.parse(data.toString().trim());
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Invalid response: ${data.toString()}`));
        }
      };

      this.pythonProcess.stdout.on('data', onData);
      this.pythonProcess.stdin.write(JSON.stringify(command) + '\n');
    });
  }

  /**
   * Cleanup Python bridge
   */
  private async cleanup(): Promise<void> {
    if (this.pythonProcess) {
      try {
        await this.sendCommand({ action: 'close' });
      } catch {
        // Ignore errors on cleanup
      }
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    logger.debug('Desktop bridge closed');
  }

  /**
   * Run a complete desktop flow
   */
  async runFlow(flow: Flow): Promise<FlowResult> {
    this.flowName = flow.name;
    const startTime = new Date();
    const stepResults: StepResult[] = [];
    let flowPassed = true;

    logger.flowStart(flow.name);

    // Check availability
    if (!this.isAvailable()) {
      logger.warn('Desktop testing is only available on Windows');
      return {
        flow: flow.name,
        name: flow.name,
        status: 'skipped',
        duration: 0,
        startTime,
        endTime: new Date(),
        steps: [],
        error: 'Desktop testing is only available on Windows',
      };
    }

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

      return {
        step,
        status: 'failed',
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a step based on its action type
   */
  private async executeStep(step: Step): Promise<void> {
    switch (step.action) {
      case 'desktopLaunch':
        await this.executeLaunch(step as DesktopLaunchStep);
        break;
      case 'desktopClick':
        await this.executeClick(step as DesktopClickStep);
        break;
      case 'desktopType':
        await this.executeType(step as DesktopTypeStep);
        break;
      case 'desktopClose':
        await this.executeClose();
        break;
      default:
        throw new Error(`Unknown desktop action: ${(step as any).action}`);
    }
  }

  // ============================================================================
  // Step Implementations
  // ============================================================================

  private async executeLaunch(step: DesktopLaunchStep): Promise<void> {
    await this.sendCommand({
      action: 'launch',
      app: step.app,
      args: step.args || [],
    });
  }

  private async executeClick(step: DesktopClickStep): Promise<void> {
    await this.sendCommand({
      action: 'click',
      selector: step.selector,
      controlType: step.controlType || 'Button',
    });
  }

  private async executeType(step: DesktopTypeStep): Promise<void> {
    await this.sendCommand({
      action: 'type',
      selector: step.selector,
      text: step.text,
    });
  }

  private async executeClose(): Promise<void> {
    await this.sendCommand({ action: 'close' });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getStepDescription(step: Step): string {
    switch (step.action) {
      case 'desktopLaunch':
        return (step as DesktopLaunchStep).app;
      case 'desktopClick':
      case 'desktopType':
        return (step as any).selector;
      case 'desktopClose':
        return 'close application';
      default:
        return '';
    }
  }
}
