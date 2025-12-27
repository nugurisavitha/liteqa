// ============================================================================
// LiteQA - Performance & Load Testing
// ============================================================================
//
// Lightweight performance testing with:
// - HTTP load testing
// - Response time measurement
// - Throughput calculation
// - Concurrent user simulation
// - Performance assertions
// - Web Core Vitals measurement
//
// ============================================================================

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface LoadTestConfig {
  targetUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  virtualUsers: number;
  duration: number; // seconds
  rampUp?: number; // seconds to reach full load
  thinkTime?: number; // ms between requests
  timeout?: number;
  assertions?: PerformanceAssertion[];
}

export interface PerformanceAssertion {
  metric: 'responseTime' | 'throughput' | 'errorRate' | 'p95' | 'p99';
  operator: '<' | '>' | '<=' | '>=' | '==';
  value: number;
}

export interface RequestResult {
  timestamp: number;
  duration: number;
  status: number;
  success: boolean;
  error?: string;
  size?: number;
}

export interface LoadTestResult {
  config: LoadTestConfig;
  startTime: Date;
  endTime: Date;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  metrics: {
    avgResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    throughput: number; // requests per second
    errorRate: number;
    dataTransferred: number;
  };
  assertions: AssertionResult[];
  timeline: TimelinePoint[];
}

export interface AssertionResult {
  assertion: PerformanceAssertion;
  actualValue: number;
  passed: boolean;
}

export interface TimelinePoint {
  timestamp: number;
  activeUsers: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  errorCount: number;
}

export interface WebVitalsResult {
  url: string;
  lcp?: number; // Largest Contentful Paint
  fid?: number; // First Input Delay
  cls?: number; // Cumulative Layout Shift
  fcp?: number; // First Contentful Paint
  ttfb?: number; // Time to First Byte
  tti?: number; // Time to Interactive
  domLoad?: number;
  fullLoad?: number;
  resourceCount: number;
  transferSize: number;
}

// ============================================================================
// HTTP Load Tester
// ============================================================================

export class LoadTester {
  private results: RequestResult[] = [];
  private isRunning = false;
  private activeUsers = 0;
  private timeline: TimelinePoint[] = [];

  /**
   * Run load test
   */
  async run(config: LoadTestConfig): Promise<LoadTestResult> {
    logger.info(`Starting load test: ${config.virtualUsers} users for ${config.duration}s`);

    this.results = [];
    this.timeline = [];
    this.isRunning = true;
    this.activeUsers = 0;

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + config.duration * 1000);
    const rampUpTime = (config.rampUp || 0) * 1000;

    // Start timeline collector
    const timelineInterval = setInterval(() => {
      this.collectTimelinePoint();
    }, 1000);

    // Calculate user spawn rate
    const userSpawnDelay = rampUpTime > 0 ? rampUpTime / config.virtualUsers : 0;

    // Spawn virtual users
    const userPromises: Promise<void>[] = [];

    for (let i = 0; i < config.virtualUsers; i++) {
      const spawnDelay = userSpawnDelay * i;

      userPromises.push(
        new Promise(async (resolve) => {
          await this.sleep(spawnDelay);

          if (!this.isRunning) {
            resolve();
            return;
          }

          this.activeUsers++;
          await this.runVirtualUser(config, endTime);
          this.activeUsers--;
          resolve();
        })
      );
    }

    // Wait for all users to complete
    await Promise.all(userPromises);

    this.isRunning = false;
    clearInterval(timelineInterval);

    const actualEndTime = new Date();
    const duration = (actualEndTime.getTime() - startTime.getTime()) / 1000;

    // Calculate metrics
    const metrics = this.calculateMetrics(duration);

    // Check assertions
    const assertions = this.checkAssertions(config.assertions || [], metrics);

    const result: LoadTestResult = {
      config,
      startTime,
      endTime: actualEndTime,
      duration,
      totalRequests: this.results.length,
      successfulRequests: this.results.filter(r => r.success).length,
      failedRequests: this.results.filter(r => !r.success).length,
      metrics,
      assertions,
      timeline: this.timeline,
    };

    // Log summary
    this.logSummary(result);

    return result;
  }

  /**
   * Stop running test
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Stopping load test...');
  }

  /**
   * Run single virtual user
   */
  private async runVirtualUser(config: LoadTestConfig, endTime: Date): Promise<void> {
    while (this.isRunning && new Date() < endTime) {
      const start = Date.now();

      try {
        const response = await fetch(config.targetUrl, {
          method: config.method || 'GET',
          headers: config.headers,
          body: config.body ? JSON.stringify(config.body) : undefined,
          signal: AbortSignal.timeout(config.timeout || 30000),
        });

        const duration = Date.now() - start;
        const size = parseInt(response.headers.get('content-length') || '0', 10);

        this.results.push({
          timestamp: start,
          duration,
          status: response.status,
          success: response.ok,
          size,
        });
      } catch (error) {
        const duration = Date.now() - start;

        this.results.push({
          timestamp: start,
          duration,
          status: 0,
          success: false,
          error: (error as Error).message,
        });
      }

      // Think time
      if (config.thinkTime) {
        await this.sleep(config.thinkTime);
      }
    }
  }

  /**
   * Collect timeline data point
   */
  private collectTimelinePoint(): void {
    const now = Date.now();
    const recentResults = this.results.filter(r => r.timestamp > now - 1000);

    this.timeline.push({
      timestamp: now,
      activeUsers: this.activeUsers,
      requestsPerSecond: recentResults.length,
      avgResponseTime: recentResults.length > 0
        ? recentResults.reduce((sum, r) => sum + r.duration, 0) / recentResults.length
        : 0,
      errorCount: recentResults.filter(r => !r.success).length,
    });
  }

  /**
   * Calculate performance metrics
   */
  private calculateMetrics(duration: number): LoadTestResult['metrics'] {
    const durations = this.results.map(r => r.duration).sort((a, b) => a - b);
    const successful = this.results.filter(r => r.success);
    const dataTransferred = this.results.reduce((sum, r) => sum + (r.size || 0), 0);

    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    return {
      avgResponseTime: durations.length > 0
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length
        : 0,
      minResponseTime: durations[0] || 0,
      maxResponseTime: durations[durations.length - 1] || 0,
      p50: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      throughput: this.results.length / duration,
      errorRate: this.results.length > 0
        ? (this.results.filter(r => !r.success).length / this.results.length) * 100
        : 0,
      dataTransferred,
    };
  }

  /**
   * Check performance assertions
   */
  private checkAssertions(
    assertions: PerformanceAssertion[],
    metrics: LoadTestResult['metrics']
  ): AssertionResult[] {
    return assertions.map(assertion => {
      let actualValue: number;

      switch (assertion.metric) {
        case 'responseTime':
          actualValue = metrics.avgResponseTime;
          break;
        case 'throughput':
          actualValue = metrics.throughput;
          break;
        case 'errorRate':
          actualValue = metrics.errorRate;
          break;
        case 'p95':
          actualValue = metrics.p95;
          break;
        case 'p99':
          actualValue = metrics.p99;
          break;
        default:
          actualValue = 0;
      }

      let passed = false;
      switch (assertion.operator) {
        case '<':
          passed = actualValue < assertion.value;
          break;
        case '>':
          passed = actualValue > assertion.value;
          break;
        case '<=':
          passed = actualValue <= assertion.value;
          break;
        case '>=':
          passed = actualValue >= assertion.value;
          break;
        case '==':
          passed = actualValue === assertion.value;
          break;
      }

      return { assertion, actualValue, passed };
    });
  }

  /**
   * Log summary
   */
  private logSummary(result: LoadTestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('  Load Test Results');
    console.log('='.repeat(60));
    console.log(`  URL:           ${result.config.targetUrl}`);
    console.log(`  Duration:      ${result.duration.toFixed(1)}s`);
    console.log(`  Virtual Users: ${result.config.virtualUsers}`);
    console.log('');
    console.log(`  Total Requests:    ${result.totalRequests}`);
    console.log(`  Successful:        ${result.successfulRequests}`);
    console.log(`  Failed:            ${result.failedRequests}`);
    console.log('');
    console.log('  Response Times:');
    console.log(`    Average:   ${result.metrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`    Min:       ${result.metrics.minResponseTime}ms`);
    console.log(`    Max:       ${result.metrics.maxResponseTime}ms`);
    console.log(`    P50:       ${result.metrics.p50}ms`);
    console.log(`    P95:       ${result.metrics.p95}ms`);
    console.log(`    P99:       ${result.metrics.p99}ms`);
    console.log('');
    console.log(`  Throughput:    ${result.metrics.throughput.toFixed(2)} req/s`);
    console.log(`  Error Rate:    ${result.metrics.errorRate.toFixed(2)}%`);
    console.log(`  Data:          ${(result.metrics.dataTransferred / 1024).toFixed(1)} KB`);

    if (result.assertions.length > 0) {
      console.log('');
      console.log('  Assertions:');
      for (const a of result.assertions) {
        const status = a.passed ? '✓' : '✗';
        console.log(`    ${status} ${a.assertion.metric} ${a.assertion.operator} ${a.assertion.value} (actual: ${a.actualValue.toFixed(2)})`);
      }
    }

    console.log('='.repeat(60) + '\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Web Vitals Collector
// ============================================================================

export class WebVitalsCollector {
  private browser: Browser | null = null;

  /**
   * Measure Web Vitals for a URL
   */
  async measure(url: string, options?: {
    timeout?: number;
    waitForNetworkIdle?: boolean;
  }): Promise<WebVitalsResult> {
    logger.info(`Measuring Web Vitals: ${url}`);

    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext();
    const page = await context.newPage();

    // Enable performance metrics
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');

    // Inject Web Vitals measurement
    await page.addInitScript(() => {
      // @ts-ignore
      window.__vitals = {};

      // LCP
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        // @ts-ignore
        window.__vitals.lcp = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      // FID
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        // @ts-ignore
        window.__vitals.fid = entries[0].processingStart - entries[0].startTime;
      }).observe({ type: 'first-input', buffered: true });

      // CLS
      let clsValue = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // @ts-ignore
          if (!entry.hadRecentInput) {
            // @ts-ignore
            clsValue += entry.value;
          }
        }
        // @ts-ignore
        window.__vitals.cls = clsValue;
      }).observe({ type: 'layout-shift', buffered: true });
    });

    const startTime = Date.now();

    await page.goto(url, {
      waitUntil: options?.waitForNetworkIdle ? 'networkidle' : 'load',
      timeout: options?.timeout || 30000,
    });

    // Wait a bit for metrics to be collected
    await page.waitForTimeout(2000);

    // Get performance timing
    const timing = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      // @ts-ignore
      const vitals = window.__vitals || {};

      return {
        // @ts-ignore
        lcp: vitals.lcp,
        // @ts-ignore
        fid: vitals.fid,
        // @ts-ignore
        cls: vitals.cls,
        fcp: perf.domContentLoadedEventEnd - perf.fetchStart,
        ttfb: perf.responseStart - perf.fetchStart,
        domLoad: perf.domContentLoadedEventEnd - perf.fetchStart,
        fullLoad: perf.loadEventEnd - perf.fetchStart,
      };
    });

    // Get resource stats
    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        count: entries.length,
        size: entries.reduce((sum, e) => sum + (e.transferSize || 0), 0),
      };
    });

    await this.browser.close();
    this.browser = null;

    const result: WebVitalsResult = {
      url,
      lcp: timing.lcp,
      fid: timing.fid,
      cls: timing.cls,
      fcp: timing.fcp,
      ttfb: timing.ttfb,
      domLoad: timing.domLoad,
      fullLoad: timing.fullLoad,
      resourceCount: resources.count,
      transferSize: resources.size,
    };

    this.logVitals(result);

    return result;
  }

  /**
   * Measure multiple URLs
   */
  async measureMultiple(urls: string[]): Promise<WebVitalsResult[]> {
    const results: WebVitalsResult[] = [];

    for (const url of urls) {
      try {
        const result = await this.measure(url);
        results.push(result);
      } catch (error) {
        logger.error(`Failed to measure ${url}: ${(error as Error).message}`);
      }
    }

    return results;
  }

  private logVitals(result: WebVitalsResult): void {
    console.log('\n' + '='.repeat(50));
    console.log('  Web Vitals');
    console.log('='.repeat(50));
    console.log(`  URL: ${result.url}`);
    console.log('');
    console.log('  Core Web Vitals:');
    console.log(`    LCP:  ${result.lcp ? result.lcp.toFixed(0) + 'ms' : 'N/A'} ${this.vitalsGrade('lcp', result.lcp)}`);
    console.log(`    FID:  ${result.fid ? result.fid.toFixed(0) + 'ms' : 'N/A'} ${this.vitalsGrade('fid', result.fid)}`);
    console.log(`    CLS:  ${result.cls ? result.cls.toFixed(3) : 'N/A'} ${this.vitalsGrade('cls', result.cls)}`);
    console.log('');
    console.log('  Other Metrics:');
    console.log(`    TTFB:     ${result.ttfb?.toFixed(0)}ms`);
    console.log(`    FCP:      ${result.fcp?.toFixed(0)}ms`);
    console.log(`    DOM Load: ${result.domLoad?.toFixed(0)}ms`);
    console.log(`    Full:     ${result.fullLoad?.toFixed(0)}ms`);
    console.log('');
    console.log(`  Resources: ${result.resourceCount} (${(result.transferSize / 1024).toFixed(1)} KB)`);
    console.log('='.repeat(50) + '\n');
  }

  private vitalsGrade(metric: string, value?: number): string {
    if (value === undefined) return '';

    const thresholds: Record<string, [number, number]> = {
      lcp: [2500, 4000],
      fid: [100, 300],
      cls: [0.1, 0.25],
    };

    const [good, poor] = thresholds[metric] || [0, 0];

    if (value <= good) return '(Good)';
    if (value <= poor) return '(Needs Improvement)';
    return '(Poor)';
  }
}

// ============================================================================
// Export Report Generators
// ============================================================================

export function saveLoadTestReport(result: LoadTestResult, outputPath: string): void {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Load Test Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
    .metric { text-align: center; padding: 15px; background: #f9f9f9; border-radius: 8px; }
    .metric .value { font-size: 1.5em; font-weight: bold; color: #333; }
    .metric .label { font-size: 0.9em; color: #666; }
    .chart-container { height: 300px; }
    .passed { color: #22c55e; }
    .failed { color: #ef4444; }
  </style>
</head>
<body>
  <h1>Load Test Report</h1>

  <div class="card">
    <h2>Summary</h2>
    <div class="metrics">
      <div class="metric">
        <div class="value">${result.totalRequests}</div>
        <div class="label">Total Requests</div>
      </div>
      <div class="metric">
        <div class="value">${result.metrics.throughput.toFixed(1)}</div>
        <div class="label">Requests/sec</div>
      </div>
      <div class="metric">
        <div class="value">${result.metrics.avgResponseTime.toFixed(0)}ms</div>
        <div class="label">Avg Response</div>
      </div>
      <div class="metric">
        <div class="value">${result.metrics.p95}ms</div>
        <div class="label">P95</div>
      </div>
      <div class="metric">
        <div class="value">${result.metrics.errorRate.toFixed(1)}%</div>
        <div class="label">Error Rate</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Timeline</h2>
    <div class="chart-container">
      <canvas id="timelineChart"></canvas>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('timelineChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(result.timeline.map((_, i) => i + 's'))},
        datasets: [{
          label: 'Response Time (ms)',
          data: ${JSON.stringify(result.timeline.map(t => t.avgResponseTime))},
          borderColor: '#3b82f6',
          yAxisID: 'y'
        }, {
          label: 'Requests/sec',
          data: ${JSON.stringify(result.timeline.map(t => t.requestsPerSecond))},
          borderColor: '#22c55e',
          yAxisID: 'y1'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { position: 'left', title: { display: true, text: 'Response Time (ms)' } },
          y1: { position: 'right', title: { display: true, text: 'Requests/sec' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
  logger.info(`Load test report saved: ${outputPath}`);
}
