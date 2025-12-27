// ============================================================================
// LiteQA - JSON Reporter
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { SuiteResult, FlowResult, LiteQAConfig, DEFAULT_CONFIG } from '../core/types';
import { logger } from '../utils/logger';

export interface JsonReport {
  timestamp: string;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: string;
  };
  environment: {
    platform: string;
    nodeVersion: string;
    liteqaVersion: string;
  };
  flows: FlowReport[];
}

export interface FlowReport {
  name: string;
  status: string;
  duration: number;
  startTime: string;
  endTime: string;
  steps: StepReport[];
  error?: string;
}

export interface StepReport {
  action: string;
  description?: string;
  status: string;
  duration: number;
  error?: string;
  screenshot?: string;
  healedSelector?: {
    original: string;
    healed: string;
    strategy: string;
    confidence: number;
  };
}

export class JsonReporter {
  private config: LiteQAConfig;

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate JSON report from suite result
   */
  generateFromSuite(result: SuiteResult): JsonReport {
    return {
      timestamp: result.startTime.toISOString(),
      duration: result.duration,
      summary: {
        total: result.summary.total,
        passed: result.summary.passed,
        failed: result.summary.failed,
        skipped: result.summary.skipped,
        passRate: result.summary.total > 0
          ? ((result.summary.passed / result.summary.total) * 100).toFixed(1) + '%'
          : '0%',
      },
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        liteqaVersion: '1.0.0',
      },
      flows: result.flows.map(flow => this.formatFlow(flow)),
    };
  }

  /**
   * Generate JSON report from single flow result
   */
  generateFromFlow(result: FlowResult): JsonReport {
    const status = result.status;
    const passed = status === 'passed' ? 1 : 0;
    const failed = status === 'failed' ? 1 : 0;
    const skipped = status === 'skipped' ? 1 : 0;

    return {
      timestamp: result.startTime.toISOString(),
      duration: result.duration,
      summary: {
        total: 1,
        passed,
        failed,
        skipped,
        passRate: passed === 1 ? '100%' : '0%',
      },
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        liteqaVersion: '1.0.0',
      },
      flows: [this.formatFlow(result)],
    };
  }

  /**
   * Format flow result for report
   */
  private formatFlow(flow: FlowResult): FlowReport {
    return {
      name: flow.name,
      status: flow.status,
      duration: flow.duration,
      startTime: flow.startTime.toISOString(),
      endTime: flow.endTime.toISOString(),
      error: flow.error,
      steps: flow.steps.map(step => ({
        action: step.step.action,
        description: step.step.description,
        status: step.status,
        duration: step.duration,
        error: step.error,
        screenshot: step.screenshot,
        healedSelector: step.healedSelector ? {
          original: step.healedSelector.original,
          healed: step.healedSelector.healed,
          strategy: step.healedSelector.strategy,
          confidence: step.healedSelector.confidence,
        } : undefined,
      })),
    };
  }

  /**
   * Save JSON report to file
   */
  save(report: JsonReport, filename?: string): string {
    const reportsDir = this.config.reportsDir;
    fs.mkdirSync(reportsDir, { recursive: true });

    const reportFilename = filename || `report-${Date.now()}.json`;
    const reportPath = path.join(reportsDir, reportFilename);

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    logger.info(`JSON report saved: ${reportPath}`);
    return reportPath;
  }
}
