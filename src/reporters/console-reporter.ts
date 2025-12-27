// ============================================================================
// LiteQA - Console Reporter
// ============================================================================

import chalk from 'chalk';
import { SuiteResult, FlowResult, StepResult } from '../core/types';

export class ConsoleReporter {
  /**
   * Print summary to console
   */
  printSummary(result: SuiteResult | FlowResult): void {
    if ('flows' in result) {
      this.printSuiteSummary(result as SuiteResult);
    } else {
      this.printFlowSummary(result as FlowResult);
    }
  }

  /**
   * Print suite summary
   */
  private printSuiteSummary(result: SuiteResult): void {
    const { summary, duration } = result;
    const passRate = summary.total > 0
      ? ((summary.passed / summary.total) * 100).toFixed(1)
      : '0';

    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white('  Test Results Summary'));
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log('');

    // Stats
    console.log(`  ${chalk.gray('Total:')}     ${chalk.white(summary.total)}`);
    console.log(`  ${chalk.gray('Passed:')}    ${chalk.green(summary.passed)}`);
    console.log(`  ${chalk.gray('Failed:')}    ${chalk.red(summary.failed)}`);
    console.log(`  ${chalk.gray('Skipped:')}   ${chalk.yellow(summary.skipped)}`);
    console.log(`  ${chalk.gray('Pass Rate:')} ${chalk.cyan(passRate + '%')}`);
    console.log(`  ${chalk.gray('Duration:')}  ${chalk.white(this.formatDuration(duration))}`);

    console.log('');
    console.log(chalk.bold.white('─'.repeat(60)));

    // Flow results
    for (const flow of result.flows) {
      const icon = flow.status === 'passed' ? chalk.green('✓') :
                   flow.status === 'failed' ? chalk.red('✗') :
                   chalk.yellow('○');
      const name = flow.name;
      const dur = chalk.gray(`(${this.formatDuration(flow.duration)})`);

      console.log(`  ${icon} ${name} ${dur}`);

      // Show failed steps
      if (flow.status === 'failed') {
        const failedSteps = flow.steps.filter(s => s.status === 'failed');
        for (const step of failedSteps) {
          console.log(chalk.red(`      └─ ${step.step.action}: ${step.error}`));
        }
      }
    }

    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));

    // Overall status
    if (summary.failed === 0) {
      console.log(chalk.green.bold('\n  ✓ All tests passed!\n'));
    } else {
      console.log(chalk.red.bold(`\n  ✗ ${summary.failed} test(s) failed\n`));
    }
  }

  /**
   * Print single flow summary
   */
  private printFlowSummary(result: FlowResult): void {
    const { status, duration, steps } = result;
    const passed = steps.filter(s => s.status === 'passed').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const skipped = steps.filter(s => s.status === 'skipped').length;

    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white(`  Flow: ${result.name}`));
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log('');

    console.log(`  ${chalk.gray('Status:')}    ${this.statusBadge(status)}`);
    console.log(`  ${chalk.gray('Steps:')}     ${chalk.green(passed)} passed, ${chalk.red(failed)} failed, ${chalk.yellow(skipped)} skipped`);
    console.log(`  ${chalk.gray('Duration:')}  ${chalk.white(this.formatDuration(duration))}`);

    // Show failed steps
    const failedSteps = steps.filter(s => s.status === 'failed');
    if (failedSteps.length > 0) {
      console.log('');
      console.log(chalk.red.bold('  Failed Steps:'));
      for (const step of failedSteps) {
        console.log(chalk.red(`    ✗ ${step.step.action}`));
        console.log(chalk.gray(`      ${step.error}`));
        if (step.screenshot) {
          console.log(chalk.gray(`      📷 ${step.screenshot}`));
        }
      }
    }

    // Show healed selectors
    const healedSteps = steps.filter(s => s.healedSelector);
    if (healedSteps.length > 0) {
      console.log('');
      console.log(chalk.yellow.bold('  Healed Selectors:'));
      for (const step of healedSteps) {
        console.log(chalk.yellow(`    ⚡ ${step.healedSelector!.original}`));
        console.log(chalk.green(`       → ${step.healedSelector!.healed}`));
        console.log(chalk.gray(`       (${(step.healedSelector!.confidence * 100).toFixed(0)}% confidence)`));
      }
    }

    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));

    if (status === 'passed') {
      console.log(chalk.green.bold('\n  ✓ Flow passed!\n'));
    } else if (status === 'failed') {
      console.log(chalk.red.bold('\n  ✗ Flow failed\n'));
    } else {
      console.log(chalk.yellow.bold('\n  ○ Flow skipped\n'));
    }
  }

  /**
   * Format status as colored badge
   */
  private statusBadge(status: string): string {
    switch (status) {
      case 'passed':
        return chalk.green.bold('PASSED');
      case 'failed':
        return chalk.red.bold('FAILED');
      case 'skipped':
        return chalk.yellow.bold('SKIPPED');
      default:
        return chalk.gray(status);
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
}
