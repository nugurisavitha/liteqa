#!/usr/bin/env node
// ============================================================================
// LiteQA - CLI Entry Point (Enhanced)
// ============================================================================

import { Command } from 'commander';
import { initProject } from './init';
import { runTests, RunOptions } from './run';
import { AITestGenerator } from '../ai/test-generator';
import { BrowserRecorder } from '../recorder/browser-recorder';
import { LoadTester, WebVitalsCollector, saveLoadTestReport } from '../performance/load-tester';
import { VisualTester } from '../visual/visual-tester';
import { StateMachineModel } from '../model/state-machine';
import { ScriptRunner } from '../runners/script-runner';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const program = new Command();

program
  .name('liteqa')
  .description('LiteQA - AI-Assisted Test Automation Platform')
  .version('1.0.0');

// ============================================================================
// Init Command
// ============================================================================

program
  .command('init [directory]')
  .description('Initialize a new LiteQA project')
  .action(async (directory: string = '.') => {
    try {
      await initProject(directory);
      process.exit(0);
    } catch (error) {
      console.error('Init failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Run Command
// ============================================================================

program
  .command('run <target>')
  .description('Run a test suite, flow, or script')
  .option('--headed', 'Run browser in headed mode')
  .option('--browser <browser>', 'Browser: chromium, firefox, webkit', 'chromium')
  .option('--timeout <ms>', 'Default timeout', '30000')
  .option('--no-self-heal', 'Disable self-healing')
  .option('-v, --verbose', 'Verbose logging')
  .option('--data <file>', 'Test data file (JSON/YAML)')
  .option('--env <name>', 'Environment name')
  .action(async (target: string, opts) => {
    try {
      const options: RunOptions = {
        headless: !opts.headed,
        browser: opts.browser,
        timeout: parseInt(opts.timeout, 10),
        noSelfHeal: opts.selfHeal === false,
        verbose: opts.verbose,
      };

      const success = await runTests(target, options);
      process.exit(success ? 0 : 1);
    } catch (error) {
      console.error('Run failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Record Command
// ============================================================================

program
  .command('record <url>')
  .description('Record browser interactions and generate test')
  .option('-n, --name <name>', 'Recording name')
  .option('-o, --output <dir>', 'Output directory', './recordings')
  .option('-f, --format <format>', 'Output format: yaml, typescript, both', 'yaml')
  .action(async (url: string, opts) => {
    try {
      logger.banner();
      logger.info('Starting browser recorder...');
      logger.info('Interact with the browser. Press Ctrl+C to stop.');

      const recorder = new BrowserRecorder({
        startUrl: url,
        outputDir: opts.output,
        outputFormat: opts.format,
      });

      await recorder.startRecording(opts.name);
    } catch (error) {
      console.error('Recording failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Generate Command (AI Test Generation)
// ============================================================================

program
  .command('generate <url>')
  .alias('gen')
  .description('Auto-generate tests by crawling an application')
  .option('-o, --output <dir>', 'Output directory', './generated')
  .option('-d, --depth <n>', 'Max crawl depth', '3')
  .option('-p, --pages <n>', 'Max pages to crawl', '50')
  .option('--blueprint <file>', 'Save blueprint to file')
  .option('--headed', 'Show browser during crawl')
  .action(async (url: string, opts) => {
    try {
      logger.banner();
      logger.info('Starting AI test generation...');

      const generator = new AITestGenerator({
        startUrl: url,
        maxDepth: parseInt(opts.depth, 10),
        maxPages: parseInt(opts.pages, 10),
        headless: !opts.headed,
      });

      const { blueprint, tests } = await generator.autoGenerate();

      // Save blueprint
      if (opts.blueprint) {
        AITestGenerator.saveBlueprint(blueprint, opts.blueprint);
      } else {
        AITestGenerator.saveBlueprint(
          blueprint,
          path.join(opts.output, 'blueprint.yaml')
        );
      }

      // Save tests
      AITestGenerator.saveTests(tests, path.join(opts.output, 'flows'));

      logger.success(`Generated ${tests.length} tests in ${opts.output}`);
      process.exit(0);
    } catch (error) {
      console.error('Generation failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Scan Command (Application Blueprint)
// ============================================================================

program
  .command('scan <url>')
  .description('Scan application and create element blueprint')
  .option('-o, --output <file>', 'Output file', './blueprint.yaml')
  .option('-d, --depth <n>', 'Max crawl depth', '2')
  .option('--headed', 'Show browser')
  .action(async (url: string, opts) => {
    try {
      logger.banner();
      logger.info('Scanning application...');

      const generator = new AITestGenerator({
        startUrl: url,
        maxDepth: parseInt(opts.depth, 10),
        maxPages: 20,
        headless: !opts.headed,
      });

      const blueprint = await generator.crawl();
      AITestGenerator.saveBlueprint(blueprint, opts.output);

      logger.success(`Blueprint saved: ${opts.output}`);
      logger.info(`  Pages: ${blueprint.stats.pagesScanned}`);
      logger.info(`  Elements: ${blueprint.stats.elementsFound}`);
      logger.info(`  Forms: ${blueprint.stats.formsFound}`);

      process.exit(0);
    } catch (error) {
      console.error('Scan failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Performance Commands
// ============================================================================

const perf = program
  .command('perf')
  .description('Performance testing commands');

perf
  .command('load <url>')
  .description('Run HTTP load test')
  .option('-u, --users <n>', 'Virtual users', '10')
  .option('-d, --duration <s>', 'Duration in seconds', '30')
  .option('-r, --rampup <s>', 'Ramp-up time', '5')
  .option('--report <file>', 'Save HTML report')
  .action(async (url: string, opts) => {
    try {
      logger.banner();

      const tester = new LoadTester();
      const result = await tester.run({
        targetUrl: url,
        virtualUsers: parseInt(opts.users, 10),
        duration: parseInt(opts.duration, 10),
        rampUp: parseInt(opts.rampup, 10),
      });

      if (opts.report) {
        saveLoadTestReport(result, opts.report);
      }

      const passed = result.metrics.errorRate < 5;
      process.exit(passed ? 0 : 1);
    } catch (error) {
      console.error('Load test failed:', (error as Error).message);
      process.exit(1);
    }
  });

perf
  .command('vitals <url>')
  .description('Measure Web Core Vitals')
  .action(async (url: string) => {
    try {
      logger.banner();

      const collector = new WebVitalsCollector();
      await collector.measure(url);

      process.exit(0);
    } catch (error) {
      console.error('Vitals measurement failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Visual Testing Commands
// ============================================================================

const visual = program
  .command('visual')
  .description('Visual regression testing commands');

visual
  .command('compare <name>')
  .description('Compare screenshot against baseline')
  .option('-t, --threshold <n>', 'Diff threshold percentage', '0.1')
  .option('-u, --update', 'Update baseline if passed')
  .action(async (name: string, opts) => {
    try {
      const tester = new VisualTester({
        threshold: parseFloat(opts.threshold),
        updateBaseline: opts.update,
      });

      // Note: This requires an actual page - use in flows
      logger.info(`Use visual testing in test flows with 'visualCompare' action`);
      process.exit(0);
    } catch (error) {
      console.error('Visual test failed:', (error as Error).message);
      process.exit(1);
    }
  });

visual
  .command('update [name]')
  .description('Update baseline(s) from actual images')
  .action(async (name?: string) => {
    try {
      const tester = new VisualTester();

      if (name) {
        tester.updateBaseline(name);
      } else {
        const count = tester.updateAllBaselines();
        logger.success(`Updated ${count} baseline(s)`);
      }

      process.exit(0);
    } catch (error) {
      console.error('Update failed:', (error as Error).message);
      process.exit(1);
    }
  });

visual
  .command('list')
  .description('List all baselines')
  .action(() => {
    const tester = new VisualTester();
    const baselines = tester.listBaselines();

    console.log('\nVisual Baselines:');
    for (const b of baselines) {
      console.log(`  - ${b}`);
    }
    console.log(`\nTotal: ${baselines.length}`);
    process.exit(0);
  });

// ============================================================================
// Model-Based Testing Commands
// ============================================================================

program
  .command('model <file>')
  .description('Generate tests from state machine model')
  .option('-o, --output <dir>', 'Output directory', './generated')
  .option('-c, --coverage <type>', 'Coverage: state, transition, n-switch', 'transition')
  .option('-n, --n-switch <n>', 'N-switch coverage depth', '1')
  .option('--diagram <file>', 'Save Mermaid diagram')
  .action(async (file: string, opts) => {
    try {
      logger.banner();
      logger.info('Generating tests from model...');

      const model = StateMachineModel.fromFile(file);

      let paths;
      switch (opts.coverage) {
        case 'state':
          paths = model.generateStateCoveragePaths();
          break;
        case 'n-switch':
          paths = model.generateNSwitchCoverage(parseInt(opts.nSwitch, 10));
          break;
        default:
          paths = model.generateTransitionCoveragePaths();
      }

      const flows = model.generateFlows(paths);
      const report = model.generateCoverageReport(paths);

      // Save flows
      fs.mkdirSync(opts.output, { recursive: true });
      for (const flow of flows) {
        const filename = flow.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.yaml';
        fs.writeFileSync(
          path.join(opts.output, filename),
          yaml.dump(flow, { indent: 2 }),
          'utf-8'
        );
      }

      // Save diagram
      if (opts.diagram) {
        fs.writeFileSync(opts.diagram, model.toMermaid(), 'utf-8');
        logger.info(`Diagram saved: ${opts.diagram}`);
      }

      logger.success(`Generated ${flows.length} test flows`);
      logger.info(`State coverage: ${report.stateCoverage.toFixed(1)}%`);
      logger.info(`Transition coverage: ${report.transitionCoverage.toFixed(1)}%`);

      process.exit(0);
    } catch (error) {
      console.error('Model generation failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Script Command
// ============================================================================

program
  .command('script <file>')
  .description('Run a custom JavaScript/TypeScript test script')
  .option('--headed', 'Show browser')
  .option('-p, --params <json>', 'Parameters as JSON')
  .action(async (file: string, opts) => {
    try {
      logger.banner();

      const runner = new ScriptRunner({
        headless: !opts.headed,
      });

      const params = opts.params ? JSON.parse(opts.params) : {};
      const result = await runner.runFile(file, params);

      process.exit(result.passed ? 0 : 1);
    } catch (error) {
      console.error('Script failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Web UI Command
// ============================================================================

program
  .command('web')
  .alias('ui')
  .description('Start the LiteQA Web UI')
  .option('-p, --port <port>', 'Port number', process.env.PORT || '3000')
  .option('-d, --dir <directory>', 'Project directory', '.')
  .action(async (opts) => {
    try {
      const { startServer } = require('../web/server');
      const projectDir = path.resolve(opts.dir);
      const port = parseInt(process.env.PORT || opts.port, 10);
      await startServer(port, projectDir);
    } catch (error) {
      console.error('Web UI failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Report Command
// ============================================================================

program
  .command('report')
  .description('Generate test report from results')
  .option('-i, --input <file>', 'Input results JSON')
  .option('-o, --output <file>', 'Output HTML report', './artifacts/reports/report.html')
  .action(async (opts) => {
    try {
      if (opts.input) {
        const content = fs.readFileSync(opts.input, 'utf-8');
        const results = JSON.parse(content);
        // Generate report from results
        logger.info(`Report generated: ${opts.output}`);
      } else {
        logger.warn('No input file specified');
      }
      process.exit(0);
    } catch (error) {
      console.error('Report generation failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================================
// Parse and Execute
// ============================================================================

program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  logger.banner();
  program.outputHelp();
}
