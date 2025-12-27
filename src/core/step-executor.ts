// ============================================================================
// LiteQA - Step Executor (Runner Coordinator)
// ============================================================================

import {
  Flow,
  Suite,
  FlowResult,
  SuiteResult,
  LiteQAConfig,
  DEFAULT_CONFIG,
} from './types';
import { FlowLoader } from './flow-loader';
import { WebRunner } from '../runners/web-runner';
import { ApiRunner } from '../runners/api-runner';
import { DesktopRunner } from '../runners/desktop-runner';
import { MobileRunner } from '../runners/mobile-runner';
import { PerformanceRunner } from '../runners/performance-runner';
import { HtmlReporter } from '../reporters/html-reporter';
import { JsonReporter } from '../reporters/json-reporter';
import { ConsoleReporter } from '../reporters/console-reporter';
import { logger } from '../utils/logger';

export class StepExecutor {
  private config: LiteQAConfig;
  private flowLoader: FlowLoader;
  private webRunner: WebRunner;
  private apiRunner: ApiRunner;
  private desktopRunner: DesktopRunner;
  private mobileRunner: MobileRunner;
  private performanceRunner: PerformanceRunner;
  private htmlReporter: HtmlReporter;
  private jsonReporter: JsonReporter;
  private consoleReporter: ConsoleReporter;

  constructor(basePath: string, config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.flowLoader = new FlowLoader(basePath, this.config);
    this.webRunner = new WebRunner(this.config);
    this.apiRunner = new ApiRunner(this.config);
    this.desktopRunner = new DesktopRunner(this.config);
    this.mobileRunner = new MobileRunner(this.config);
    this.performanceRunner = new PerformanceRunner(this.config);
    this.htmlReporter = new HtmlReporter(this.config);
    this.jsonReporter = new JsonReporter(this.config);
    this.consoleReporter = new ConsoleReporter();
  }

  /**
   * Run a suite file
   */
  async runSuite(suitePath: string): Promise<SuiteResult> {
    const suite = this.flowLoader.loadSuite(suitePath);
    const flows = this.flowLoader.loadFlowsFromSuite(suite);

    logger.suiteStart(suite.name);

    const startTime = new Date();
    const flowResults: FlowResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const flow of flows) {
      const result = await this.runFlow(flow);
      flowResults.push(result);

      switch (result.status) {
        case 'passed':
          passed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    const result: SuiteResult = {
      suite: suitePath,
      name: suite.name,
      status: failed > 0 ? 'failed' : 'passed',
      duration,
      startTime,
      endTime,
      flows: flowResults,
      summary: {
        total: flows.length,
        passed,
        failed,
        skipped,
      },
    };

    // Print summary
    logger.suiteSummary(result.summary.total, passed, failed, skipped, duration);

    // Generate reports
    await this.generateReports(result);

    return result;
  }

  /**
   * Run a single flow file
   */
  async runFlowFile(flowPath: string): Promise<FlowResult> {
    const flow = this.flowLoader.loadFlow(flowPath);
    const result = await this.runFlow(flow);

    // Print summary
    this.consoleReporter.printSummary(result);

    // Generate reports (wrap in suite result)
    const suiteResult: SuiteResult = {
      suite: flowPath,
      name: flow.name,
      status: result.status,
      duration: result.duration,
      startTime: result.startTime,
      endTime: result.endTime,
      flows: [result],
      summary: {
        total: 1,
        passed: result.status === 'passed' ? 1 : 0,
        failed: result.status === 'failed' ? 1 : 0,
        skipped: result.status === 'skipped' ? 1 : 0,
      },
    };

    await this.generateReports(suiteResult);

    return result;
  }

  /**
   * Run a flow using the appropriate runner
   */
  private async runFlow(flow: Flow): Promise<FlowResult> {
    switch (flow.runner) {
      case 'web':
        return this.webRunner.runFlow(flow);
      case 'api':
        return this.apiRunner.runFlow(flow);
      case 'desktop':
        return this.desktopRunner.runFlow(flow);
      case 'mobile':
        return this.mobileRunner.runFlow(flow);
      case 'performance':
        return this.performanceRunner.runFlow(flow);
      default:
        throw new Error(`Unknown runner type: ${flow.runner}`);
    }
  }

  /**
   * Generate HTML and JSON reports
   */
  private async generateReports(result: SuiteResult): Promise<void> {
    // JSON report
    const jsonReport = this.jsonReporter.generateFromSuite(result);
    this.jsonReporter.save(jsonReport, 'report.json');

    // HTML report
    const htmlReport = this.htmlReporter.generateFromSuite(result);
    this.htmlReporter.save(htmlReport, 'report.html');
  }
}
