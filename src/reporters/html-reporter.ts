// ============================================================================
// LiteQA - HTML Reporter
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { SuiteResult, FlowResult, StepResult, LiteQAConfig, DEFAULT_CONFIG } from '../core/types';
import { logger } from '../utils/logger';

export class HtmlReporter {
  private config: LiteQAConfig;

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate HTML report from suite result
   */
  generateFromSuite(result: SuiteResult): string {
    return this.generateHtml({
      title: result.name,
      timestamp: result.startTime,
      duration: result.duration,
      summary: result.summary,
      flows: result.flows,
    });
  }

  /**
   * Generate HTML report from single flow result
   */
  generateFromFlow(result: FlowResult): string {
    const status = result.status;
    const passed = status === 'passed' ? 1 : 0;
    const failed = status === 'failed' ? 1 : 0;
    const skipped = status === 'skipped' ? 1 : 0;

    return this.generateHtml({
      title: result.name,
      timestamp: result.startTime,
      duration: result.duration,
      summary: { total: 1, passed, failed, skipped },
      flows: [result],
    });
  }

  /**
   * Generate HTML content
   */
  private generateHtml(data: {
    title: string;
    timestamp: Date;
    duration: number;
    summary: { total: number; passed: number; failed: number; skipped: number };
    flows: FlowResult[];
  }): string {
    const { title, timestamp, duration, summary, flows } = data;
    const passRate = summary.total > 0
      ? ((summary.passed / summary.total) * 100).toFixed(1)
      : '0';

    const statusClass = summary.failed > 0 ? 'failed' : 'passed';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiteQA Report - ${this.escapeHtml(title)}</title>
  <style>
    :root {
      --color-passed: #10b981;
      --color-failed: #ef4444;
      --color-skipped: #f59e0b;
      --color-bg: #f8fafc;
      --color-card: #ffffff;
      --color-border: #e2e8f0;
      --color-text: #1e293b;
      --color-text-muted: #64748b;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      padding: 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .header h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .header .subtitle {
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--color-card);
      border-radius: 8px;
      padding: 1.5rem;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .stat-card .value {
      font-size: 2rem;
      font-weight: 700;
    }

    .stat-card .label {
      color: var(--color-text-muted);
      font-size: 0.875rem;
      text-transform: uppercase;
    }

    .stat-card.passed .value { color: var(--color-passed); }
    .stat-card.failed .value { color: var(--color-failed); }
    .stat-card.skipped .value { color: var(--color-skipped); }

    .flow {
      background: var(--color-card);
      border-radius: 8px;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .flow-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      cursor: pointer;
      border-bottom: 1px solid var(--color-border);
    }

    .flow-header:hover {
      background: #f1f5f9;
    }

    .flow-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .flow-title h3 {
      font-size: 1rem;
      font-weight: 600;
    }

    .status-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-badge.passed { background: #d1fae5; color: #065f46; }
    .status-badge.failed { background: #fee2e2; color: #991b1b; }
    .status-badge.skipped { background: #fef3c7; color: #92400e; }

    .flow-meta {
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }

    .flow-steps {
      display: none;
      padding: 1rem 1.5rem;
    }

    .flow.expanded .flow-steps {
      display: block;
    }

    .step {
      display: flex;
      align-items: flex-start;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--color-border);
    }

    .step:last-child {
      border-bottom: none;
    }

    .step-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 1rem;
      flex-shrink: 0;
      font-size: 0.75rem;
    }

    .step-icon.passed { background: #d1fae5; color: #065f46; }
    .step-icon.failed { background: #fee2e2; color: #991b1b; }
    .step-icon.skipped { background: #fef3c7; color: #92400e; }

    .step-content {
      flex: 1;
    }

    .step-action {
      font-weight: 600;
      color: #4f46e5;
    }

    .step-description {
      color: var(--color-text-muted);
      font-size: 0.875rem;
      word-break: break-all;
    }

    .step-error {
      background: #fee2e2;
      color: #991b1b;
      padding: 0.5rem;
      border-radius: 4px;
      margin-top: 0.5rem;
      font-size: 0.875rem;
      font-family: monospace;
    }

    .step-healed {
      background: #fef3c7;
      color: #92400e;
      padding: 0.5rem;
      border-radius: 4px;
      margin-top: 0.5rem;
      font-size: 0.875rem;
    }

    .step-duration {
      color: var(--color-text-muted);
      font-size: 0.75rem;
      margin-left: 1rem;
    }

    .screenshot-link {
      color: #4f46e5;
      text-decoration: none;
      font-size: 0.875rem;
      margin-top: 0.5rem;
      display: inline-block;
    }

    .screenshot-link:hover {
      text-decoration: underline;
    }

    .footer {
      text-align: center;
      color: var(--color-text-muted);
      font-size: 0.875rem;
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 1px solid var(--color-border);
    }

    .overall-status {
      padding: 1rem;
      border-radius: 8px;
      text-align: center;
      margin-bottom: 2rem;
      font-weight: 600;
    }

    .overall-status.passed {
      background: #d1fae5;
      color: #065f46;
    }

    .overall-status.failed {
      background: #fee2e2;
      color: #991b1b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>LiteQA Test Report</h1>
      <p class="subtitle">${this.escapeHtml(title)} - ${timestamp.toLocaleString()}</p>
    </div>

    <div class="overall-status ${statusClass}">
      ${summary.failed === 0 ? '✓ All Tests Passed' : `✗ ${summary.failed} Test(s) Failed`}
    </div>

    <div class="summary">
      <div class="stat-card">
        <div class="value">${summary.total}</div>
        <div class="label">Total</div>
      </div>
      <div class="stat-card passed">
        <div class="value">${summary.passed}</div>
        <div class="label">Passed</div>
      </div>
      <div class="stat-card failed">
        <div class="value">${summary.failed}</div>
        <div class="label">Failed</div>
      </div>
      <div class="stat-card skipped">
        <div class="value">${summary.skipped}</div>
        <div class="label">Skipped</div>
      </div>
      <div class="stat-card">
        <div class="value">${passRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
      <div class="stat-card">
        <div class="value">${this.formatDuration(duration)}</div>
        <div class="label">Duration</div>
      </div>
    </div>

    <div class="flows">
      ${flows.map(flow => this.renderFlow(flow)).join('\n')}
    </div>

    <div class="footer">
      Generated by LiteQA v1.0.0 | ${new Date().toISOString()}
    </div>
  </div>

  <script>
    document.querySelectorAll('.flow-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('expanded');
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Render a single flow
   */
  private renderFlow(flow: FlowResult): string {
    return `
    <div class="flow">
      <div class="flow-header">
        <div class="flow-title">
          <span class="status-badge ${flow.status}">${flow.status}</span>
          <h3>${this.escapeHtml(flow.name)}</h3>
        </div>
        <div class="flow-meta">
          ${flow.steps.length} steps | ${this.formatDuration(flow.duration)}
        </div>
      </div>
      <div class="flow-steps">
        ${flow.steps.map((step, idx) => this.renderStep(step, idx + 1)).join('\n')}
      </div>
    </div>`;
  }

  /**
   * Render a single step
   */
  private renderStep(step: StepResult, index: number): string {
    const icon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '○';

    return `
    <div class="step">
      <div class="step-icon ${step.status}">${icon}</div>
      <div class="step-content">
        <span class="step-action">${this.escapeHtml(step.step.action)}</span>
        ${step.step.description ? `<div class="step-description">${this.escapeHtml(step.step.description)}</div>` : ''}
        ${this.renderStepDetails(step)}
        ${step.error ? `<div class="step-error">${this.escapeHtml(step.error)}</div>` : ''}
        ${step.healedSelector ? `
          <div class="step-healed">
            ⚡ Selector healed: "${this.escapeHtml(step.healedSelector.original)}" → "${this.escapeHtml(step.healedSelector.healed)}"
            (${(step.healedSelector.confidence * 100).toFixed(0)}% confidence)
          </div>
        ` : ''}
        ${step.screenshot ? `<a href="${this.escapeHtml(step.screenshot)}" class="screenshot-link" target="_blank">📷 View Screenshot</a>` : ''}
      </div>
      <div class="step-duration">${step.duration}ms</div>
    </div>`;
  }

  /**
   * Render step-specific details
   */
  private renderStepDetails(step: StepResult): string {
    const s = step.step as any;

    switch (s.action) {
      case 'goto':
        return `<div class="step-description">URL: ${this.escapeHtml(s.url)}</div>`;
      case 'click':
      case 'fill':
      case 'type':
      case 'expectText':
      case 'expectVisible':
      case 'waitForSelector':
        return `<div class="step-description">Selector: ${this.escapeHtml(s.selector)}</div>`;
      case 'request':
        return `<div class="step-description">${s.method} ${this.escapeHtml(s.url)}</div>`;
      case 'expectStatus':
        return `<div class="step-description">Expected: ${s.status}</div>`;
      default:
        return '';
    }
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Save HTML report to file
   */
  save(html: string, filename?: string): string {
    const reportsDir = this.config.reportsDir;
    fs.mkdirSync(reportsDir, { recursive: true });

    const reportFilename = filename || `report-${Date.now()}.html`;
    const reportPath = path.join(reportsDir, reportFilename);

    fs.writeFileSync(reportPath, html, 'utf-8');

    logger.info(`HTML report saved: ${reportPath}`);
    return reportPath;
  }
}
