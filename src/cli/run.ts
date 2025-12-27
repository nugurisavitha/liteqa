// ============================================================================
// LiteQA - CLI Run Command
// ============================================================================

import * as path from 'path';
import { StepExecutor } from '../core/step-executor';
import { FlowLoader } from '../core/flow-loader';
import { LiteQAConfig, DEFAULT_CONFIG } from '../core/types';
import { logger } from '../utils/logger';

export interface RunOptions {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  timeout?: number;
  verbose?: boolean;
  noSelfHeal?: boolean;
}

export async function runTests(
  targetPath: string,
  options: RunOptions = {}
): Promise<boolean> {
  logger.banner();

  const basePath = process.cwd();
  const fullPath = path.resolve(basePath, targetPath);

  // Load config
  const fileConfig = FlowLoader.loadConfig(basePath);

  // Merge with CLI options
  const config: Partial<LiteQAConfig> = {
    ...fileConfig,
  };

  if (options.headless !== undefined) {
    config.headless = options.headless;
  }
  if (options.browser) {
    config.browser = options.browser;
  }
  if (options.timeout) {
    config.defaultTimeout = options.timeout;
  }
  if (options.noSelfHeal) {
    config.selfHeal = false;
  }
  if (options.verbose) {
    logger.setVerbose(true);
  }

  // Determine if running suite or single flow
  const isSuite = targetPath.includes('suite') ||
                  targetPath.endsWith('.suite.yaml') ||
                  targetPath.endsWith('.suite.yml');

  const executor = new StepExecutor(basePath, config);

  try {
    logger.info(`Running: ${targetPath}`);
    logger.info(`Config: headless=${config.headless}, browser=${config.browser}, selfHeal=${config.selfHeal}`);
    console.log('');

    if (isSuite) {
      const result = await executor.runSuite(targetPath);
      return result.status === 'passed';
    } else {
      const result = await executor.runFlowFile(targetPath);
      return result.status === 'passed';
    }
  } catch (error) {
    logger.error(`Execution failed: ${(error as Error).message}`);

    if (options.verbose) {
      console.error(error);
    }

    return false;
  }
}
