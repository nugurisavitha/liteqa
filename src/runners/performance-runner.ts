// ============================================================================
// LiteQA - Performance Runner
// ============================================================================
//
// Executes performance tests including:
// - Load testing (concurrent users)
// - Page performance (Web Vitals)
// - API performance (response times)
//
// ============================================================================

import {
  Flow,
  FlowResult,
  StepResult,
  LiteQAConfig,
  DEFAULT_CONFIG,
  Step,
} from '../core/types';
import {
  LoadTestStep,
  PagePerformanceStep,
  ApiPerformanceStep,
  PerformanceStep,
  PerformanceStepResult,
} from '../core/performance-types';
import { LoadTester, WebVitalsCollector, LoadTestResult, WebVitalsResult } from '../performance/load-tester';
import { logger } from '../utils/logger';

// ============================================================================
// Performance Runner
// ============================================================================

export class PerformanceRunner {
  private config: LiteQAConfig;
  private loadTester: LoadTester;
  private vitalsCollector: WebVitalsCollector;

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadTester = new LoadTester();
    this.vitalsCollector = new WebVitalsCollector();
  }

  /**
   * Run a performance flow
   */
  async runFlow(flow: Flow): Promise<FlowResult> {
    const startTime = new Date();
    const stepResults: StepResult[] = [];
    let flowPassed = true;

    logger.flowStart(flow.name);
    logger.info(`Running performance flow: ${flow.name}`);

    try {
      // Run setup steps if any
      if (flow.setup) {
        for (const step of flow.setup) {
          const result = await this.runStep(step, stepResults.length + 1, this.getTotalSteps(flow));
          stepResults.push(result);
          if (result.status === 'failed' && !step.continueOnError) {
            flowPassed = false;
            break;
          }
        }
      }

      // Run main steps only if setup passed
      if (flowPassed) {
        for (const step of flow.steps) {
          const result = await this.runStep(step, stepResults.length + 1, this.getTotalSteps(flow));
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
          const result = await this.runStep(step, stepResults.length + 1, this.getTotalSteps(flow));
          stepResults.push(result);
        }
      }
    } catch (error) {
      flowPassed = false;
      logger.error(`Flow error: ${(error as Error).message}`);
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

    logger.step(index, total, (step as PerformanceStep).action, description);

    try {
      const result = await this.executeStep(step as PerformanceStep);
      const duration = Date.now() - startTime;

      if (result.status === 'passed') {
        logger.stepPass(index, total, (step as PerformanceStep).action, duration);
      } else {
        logger.stepFail(index, total, (step as PerformanceStep).action, result.error || 'Unknown error');
      }

      return {
        step,
        status: result.status,
        duration,
        error: result.error,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      logger.stepFail(index, total, (step as PerformanceStep).action, errorMessage);

      return {
        step,
        status: 'failed',
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a performance step
   */
  private async executeStep(step: PerformanceStep): Promise<PerformanceStepResult> {
    switch (step.action) {
      case 'loadTest':
        return this.executeLoadTest(step);
      case 'pagePerformance':
        return this.executePagePerformance(step);
      case 'apiPerformance':
        return this.executeApiPerformance(step);
      default:
        throw new Error(`Unknown performance action: ${(step as any).action}`);
    }
  }

  /**
   * Execute load test step
   */
  private async executeLoadTest(step: LoadTestStep): Promise<PerformanceStepResult> {
    const config = {
      targetUrl: step.targetUrl,
      method: step.method || 'GET',
      headers: step.headers,
      body: step.body,
      virtualUsers: step.virtualUsers,
      duration: step.duration,
      rampUp: step.rampUp,
      thinkTime: step.thinkTime,
      timeout: step.timeout,
      assertions: step.assertions,
    };

    const result = await this.loadTester.run(config);
    const allAssertionsPassed = result.assertions.every(a => a.passed);

    return {
      action: 'loadTest',
      description: step.description,
      status: allAssertionsPassed ? 'passed' : 'failed',
      duration: result.duration * 1000, // Convert to ms
      error: allAssertionsPassed ? undefined : this.formatAssertionErrors(result),
      loadTestMetrics: {
        totalRequests: result.totalRequests,
        successfulRequests: result.successfulRequests,
        failedRequests: result.failedRequests,
        avgResponseTime: result.metrics.avgResponseTime,
        minResponseTime: result.metrics.minResponseTime,
        maxResponseTime: result.metrics.maxResponseTime,
        p50: result.metrics.p50,
        p90: result.metrics.p90,
        p95: result.metrics.p95,
        p99: result.metrics.p99,
        throughput: result.metrics.throughput,
        errorRate: result.metrics.errorRate,
      },
      assertions: result.assertions.map(a => ({
        metric: a.assertion.metric,
        operator: a.assertion.operator,
        expected: a.assertion.value,
        actual: a.actualValue,
        passed: a.passed,
      })),
    };
  }

  /**
   * Execute page performance step
   */
  private async executePagePerformance(step: PagePerformanceStep): Promise<PerformanceStepResult> {
    const startTime = Date.now();

    const vitals = await this.vitalsCollector.measure(step.url, {
      waitForNetworkIdle: step.waitForNetworkIdle,
      timeout: step.timeout,
    });

    // Check thresholds
    let passed = true;
    const failures: string[] = [];
    const assertions: PerformanceStepResult['assertions'] = [];

    if (step.thresholds) {
      if (step.thresholds.lcp !== undefined && vitals.lcp !== undefined) {
        const met = vitals.lcp <= step.thresholds.lcp;
        assertions.push({
          metric: 'lcp',
          operator: '<=',
          expected: step.thresholds.lcp,
          actual: vitals.lcp,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`LCP ${vitals.lcp.toFixed(0)}ms exceeds threshold ${step.thresholds.lcp}ms`);
        }
      }

      if (step.thresholds.fcp !== undefined && vitals.fcp !== undefined) {
        const met = vitals.fcp <= step.thresholds.fcp;
        assertions.push({
          metric: 'fcp',
          operator: '<=',
          expected: step.thresholds.fcp,
          actual: vitals.fcp,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`FCP ${vitals.fcp.toFixed(0)}ms exceeds threshold ${step.thresholds.fcp}ms`);
        }
      }

      if (step.thresholds.ttfb !== undefined && vitals.ttfb !== undefined) {
        const met = vitals.ttfb <= step.thresholds.ttfb;
        assertions.push({
          metric: 'ttfb',
          operator: '<=',
          expected: step.thresholds.ttfb,
          actual: vitals.ttfb,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`TTFB ${vitals.ttfb.toFixed(0)}ms exceeds threshold ${step.thresholds.ttfb}ms`);
        }
      }

      if (step.thresholds.cls !== undefined && vitals.cls !== undefined) {
        const met = vitals.cls <= step.thresholds.cls;
        assertions.push({
          metric: 'cls',
          operator: '<=',
          expected: step.thresholds.cls,
          actual: vitals.cls,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`CLS ${vitals.cls.toFixed(3)} exceeds threshold ${step.thresholds.cls}`);
        }
      }

      if (step.thresholds.domLoad !== undefined && vitals.domLoad !== undefined) {
        const met = vitals.domLoad <= step.thresholds.domLoad;
        assertions.push({
          metric: 'domLoad',
          operator: '<=',
          expected: step.thresholds.domLoad,
          actual: vitals.domLoad,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`DOM Load ${vitals.domLoad.toFixed(0)}ms exceeds threshold ${step.thresholds.domLoad}ms`);
        }
      }

      if (step.thresholds.fullLoad !== undefined && vitals.fullLoad !== undefined) {
        const met = vitals.fullLoad <= step.thresholds.fullLoad;
        assertions.push({
          metric: 'fullLoad',
          operator: '<=',
          expected: step.thresholds.fullLoad,
          actual: vitals.fullLoad,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`Full Load ${vitals.fullLoad.toFixed(0)}ms exceeds threshold ${step.thresholds.fullLoad}ms`);
        }
      }
    }

    return {
      action: 'pagePerformance',
      description: step.description,
      status: passed ? 'passed' : 'failed',
      duration: Date.now() - startTime,
      error: failures.length > 0 ? failures.join('; ') : undefined,
      webVitals: {
        lcp: vitals.lcp,
        fcp: vitals.fcp,
        fid: vitals.fid,
        cls: vitals.cls,
        ttfb: vitals.ttfb,
        domLoad: vitals.domLoad,
        fullLoad: vitals.fullLoad,
        resourceCount: vitals.resourceCount,
        transferSize: vitals.transferSize,
      },
      assertions,
    };
  }

  /**
   * Execute API performance step
   */
  private async executeApiPerformance(step: ApiPerformanceStep): Promise<PerformanceStepResult> {
    const startTime = Date.now();
    const responseTimes: number[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < step.iterations; i++) {
      const reqStart = Date.now();
      try {
        const response = await fetch(step.url, {
          method: step.method || 'GET',
          headers: step.headers,
          body: step.body ? JSON.stringify(step.body) : undefined,
        });

        if (response.ok) {
          successCount++;
        } else {
          errorCount++;
        }
        responseTimes.push(Date.now() - reqStart);
      } catch {
        errorCount++;
        responseTimes.push(Date.now() - reqStart);
      }
    }

    // Calculate metrics
    responseTimes.sort((a, b) => a - b);
    const avg = responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length;
    const min = responseTimes[0] || 0;
    const max = responseTimes[responseTimes.length - 1] || 0;
    const p95Idx = Math.floor(responseTimes.length * 0.95);
    const p99Idx = Math.floor(responseTimes.length * 0.99);
    const p95 = responseTimes[p95Idx] || max;
    const p99 = responseTimes[p99Idx] || max;
    const errorRate = (errorCount / step.iterations) * 100;

    // Check thresholds
    let passed = true;
    const failures: string[] = [];
    const assertions: PerformanceStepResult['assertions'] = [];

    if (step.thresholds) {
      if (step.thresholds.avgResponseTime !== undefined) {
        const met = avg <= step.thresholds.avgResponseTime;
        assertions.push({
          metric: 'avgResponseTime',
          operator: '<=',
          expected: step.thresholds.avgResponseTime,
          actual: avg,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`Avg response ${avg.toFixed(0)}ms exceeds ${step.thresholds.avgResponseTime}ms`);
        }
      }

      if (step.thresholds.p95 !== undefined) {
        const met = p95 <= step.thresholds.p95;
        assertions.push({
          metric: 'p95',
          operator: '<=',
          expected: step.thresholds.p95,
          actual: p95,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`P95 ${p95}ms exceeds ${step.thresholds.p95}ms`);
        }
      }

      if (step.thresholds.p99 !== undefined) {
        const met = p99 <= step.thresholds.p99;
        assertions.push({
          metric: 'p99',
          operator: '<=',
          expected: step.thresholds.p99,
          actual: p99,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`P99 ${p99}ms exceeds ${step.thresholds.p99}ms`);
        }
      }

      if (step.thresholds.errorRate !== undefined) {
        const met = errorRate <= step.thresholds.errorRate;
        assertions.push({
          metric: 'errorRate',
          operator: '<=',
          expected: step.thresholds.errorRate,
          actual: errorRate,
          passed: met,
        });
        if (!met) {
          passed = false;
          failures.push(`Error rate ${errorRate.toFixed(1)}% exceeds ${step.thresholds.errorRate}%`);
        }
      }
    }

    return {
      action: 'apiPerformance',
      description: step.description,
      status: passed ? 'passed' : 'failed',
      duration: Date.now() - startTime,
      error: failures.length > 0 ? failures.join('; ') : undefined,
      apiMetrics: {
        iterations: step.iterations,
        avgResponseTime: avg,
        minResponseTime: min,
        maxResponseTime: max,
        p95,
        p99,
        errorRate,
        successCount,
        errorCount,
      },
      assertions,
    };
  }

  /**
   * Get total step count
   */
  private getTotalSteps(flow: Flow): number {
    let total = flow.steps.length;
    if (flow.setup) total += flow.setup.length;
    if (flow.teardown) total += flow.teardown.length;
    return total;
  }

  /**
   * Get step description
   */
  private getStepDescription(step: Step): string {
    const perfStep = step as PerformanceStep;
    switch (perfStep.action) {
      case 'loadTest':
        return `Load test ${(perfStep as LoadTestStep).targetUrl} with ${(perfStep as LoadTestStep).virtualUsers} users`;
      case 'pagePerformance':
        return `Measure page performance: ${(perfStep as PagePerformanceStep).url}`;
      case 'apiPerformance':
        return `Measure API performance: ${(perfStep as ApiPerformanceStep).url}`;
      default:
        return 'Performance step';
    }
  }

  /**
   * Format assertion errors
   */
  private formatAssertionErrors(result: LoadTestResult): string {
    const failed = result.assertions.filter(a => !a.passed);
    return failed.map(a =>
      `${a.assertion.metric} ${a.assertion.operator} ${a.assertion.value} (actual: ${a.actualValue.toFixed(2)})`
    ).join('; ');
  }
}
