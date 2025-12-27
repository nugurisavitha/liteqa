// ============================================================================
// LiteQA - Logger Utility
// ============================================================================

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

class Logger {
  private verbose = false;

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.verbose) {
      console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    console.log(chalk.blue(`[INFO] ${message}`), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.log(chalk.yellow(`[WARN] ${message}`), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.log(chalk.red(`[ERROR] ${message}`), ...args);
  }

  success(message: string, ...args: unknown[]): void {
    console.log(chalk.green(`[SUCCESS] ${message}`), ...args);
  }

  step(index: number, total: number, action: string, details?: string): void {
    const progress = chalk.gray(`[${index}/${total}]`);
    const actionText = chalk.cyan(action);
    const detailsText = details ? chalk.white(details) : '';
    console.log(`  ${progress} ${actionText} ${detailsText}`);
  }

  stepPass(index: number, total: number, action: string, duration: number): void {
    const progress = chalk.gray(`[${index}/${total}]`);
    const actionText = chalk.green(`✓ ${action}`);
    const durationText = chalk.gray(`(${duration}ms)`);
    console.log(`  ${progress} ${actionText} ${durationText}`);
  }

  stepFail(index: number, total: number, action: string, error: string): void {
    const progress = chalk.gray(`[${index}/${total}]`);
    const actionText = chalk.red(`✗ ${action}`);
    console.log(`  ${progress} ${actionText}`);
    console.log(chalk.red(`      Error: ${error}`));
  }

  stepHealed(original: string, healed: string, confidence: number): void {
    console.log(chalk.yellow(`      ⚡ Self-healed selector:`));
    console.log(chalk.gray(`         Original: ${original}`));
    console.log(chalk.green(`         Healed:   ${healed}`));
    console.log(chalk.gray(`         Confidence: ${(confidence * 100).toFixed(0)}%`));
  }

  flowStart(name: string): void {
    console.log('');
    console.log(chalk.bold.white(`▶ Running flow: ${name}`));
    console.log(chalk.gray('─'.repeat(50)));
  }

  flowEnd(name: string, passed: boolean, duration: number): void {
    const status = passed
      ? chalk.green.bold('PASSED')
      : chalk.red.bold('FAILED');
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`${status} ${chalk.white(name)} ${chalk.gray(`(${duration}ms)`)}`);
  }

  suiteStart(name: string): void {
    console.log('');
    console.log(chalk.bold.magenta('═'.repeat(60)));
    console.log(chalk.bold.magenta(`  LiteQA Test Suite: ${name}`));
    console.log(chalk.bold.magenta('═'.repeat(60)));
  }

  suiteSummary(
    total: number,
    passed: number,
    failed: number,
    skipped: number,
    duration: number
  ): void {
    console.log('');
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(chalk.bold.white('  Test Summary'));
    console.log(chalk.bold.white('═'.repeat(60)));
    console.log(`  Total:   ${chalk.white(total)}`);
    console.log(`  Passed:  ${chalk.green(passed)}`);
    console.log(`  Failed:  ${chalk.red(failed)}`);
    console.log(`  Skipped: ${chalk.yellow(skipped)}`);
    console.log(`  Duration: ${chalk.gray(duration + 'ms')}`);
    console.log(chalk.bold.white('═'.repeat(60)));

    if (failed === 0) {
      console.log(chalk.green.bold('\n  ✓ All tests passed!\n'));
    } else {
      console.log(chalk.red.bold(`\n  ✗ ${failed} test(s) failed\n`));
    }
  }

  banner(): void {
    console.log(chalk.cyan(`
    ╔═══════════════════════════════════════╗
    ║                                       ║
    ║   LiteQA - Test Automation Platform   ║
    ║   v1.0.0                              ║
    ║                                       ║
    ╚═══════════════════════════════════════╝
    `));
  }
}

export const logger = new Logger();
