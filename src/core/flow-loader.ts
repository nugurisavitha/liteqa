// ============================================================================
// LiteQA - Flow Loader (YAML Parser)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Flow, Suite, Module, Step, LiteQAConfig, DEFAULT_CONFIG } from './types';
import { logger } from '../utils/logger';

export class FlowLoader {
  private basePath: string;
  private moduleCache: Map<string, Module> = new Map();
  private config: LiteQAConfig;

  constructor(basePath: string, config: Partial<LiteQAConfig> = {}) {
    this.basePath = basePath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load a suite YAML file
   */
  loadSuite(suitePath: string): Suite {
    const fullPath = this.resolvePath(suitePath);
    logger.debug(`Loading suite: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Suite file not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const suite = yaml.load(content) as Suite;

    this.validateSuite(suite);
    return suite;
  }

  /**
   * Load a flow YAML file
   */
  loadFlow(flowPath: string): Flow {
    const fullPath = this.resolvePath(flowPath);
    logger.debug(`Loading flow: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Flow file not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const flow = yaml.load(content) as Flow;

    this.validateFlow(flow);

    // Expand module includes
    flow.steps = this.expandModules(flow.steps);

    if (flow.setup) {
      flow.setup = this.expandModules(flow.setup);
    }
    if (flow.teardown) {
      flow.teardown = this.expandModules(flow.teardown);
    }

    // Apply variable substitution
    flow.steps = this.substituteVariables(flow.steps, process.env);

    return flow;
  }

  /**
   * Load a module YAML file
   */
  loadModule(moduleName: string): Module {
    // Check cache first
    if (this.moduleCache.has(moduleName)) {
      return this.moduleCache.get(moduleName)!;
    }

    const modulePath = path.join(this.basePath, 'modules', `${moduleName}.yaml`);
    logger.debug(`Loading module: ${modulePath}`);

    if (!fs.existsSync(modulePath)) {
      throw new Error(`Module not found: ${moduleName} (looked in ${modulePath})`);
    }

    const content = fs.readFileSync(modulePath, 'utf-8');
    const module = yaml.load(content) as Module;

    this.validateModule(module);
    this.moduleCache.set(moduleName, module);

    return module;
  }

  /**
   * Expand module includes in steps
   */
  private expandModules(steps: Step[]): Step[] {
    const expanded: Step[] = [];

    for (const step of steps) {
      if (step.action === 'include') {
        const includeStep = step as { action: 'include'; module: string; params?: Record<string, string> };
        const module = this.loadModule(includeStep.module);

        // Clone and substitute parameters
        let moduleSteps = JSON.parse(JSON.stringify(module.steps)) as Step[];

        if (includeStep.params) {
          moduleSteps = this.substituteVariables(moduleSteps, includeStep.params);
        }

        // Recursively expand nested modules
        moduleSteps = this.expandModules(moduleSteps);

        expanded.push(...moduleSteps);
      } else {
        expanded.push(step);
      }
    }

    return expanded;
  }

  /**
   * Substitute variables in steps (${VAR} syntax)
   */
  private substituteVariables(steps: Step[], vars: Record<string, string | undefined>): Step[] {
    const substitute = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
          return vars[varName] ?? `\${${varName}}`;
        });
      }
      if (Array.isArray(value)) {
        return value.map(substitute);
      }
      if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = substitute(v);
        }
        return result;
      }
      return value;
    };

    return substitute(steps) as Step[];
  }

  /**
   * Resolve path relative to base path
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.basePath, filePath);
  }

  /**
   * Validate suite structure
   */
  private validateSuite(suite: Suite): void {
    if (!suite.name) {
      throw new Error('Suite must have a name');
    }
    if (!suite.flows || !Array.isArray(suite.flows) || suite.flows.length === 0) {
      throw new Error('Suite must have at least one flow');
    }
  }

  /**
   * Validate flow structure
   */
  private validateFlow(flow: Flow): void {
    if (!flow.name) {
      throw new Error('Flow must have a name');
    }
    if (!flow.runner) {
      throw new Error('Flow must specify a runner (web, api, desktop, mobile)');
    }
    if (!flow.steps || !Array.isArray(flow.steps) || flow.steps.length === 0) {
      throw new Error('Flow must have at least one step');
    }
  }

  /**
   * Validate module structure
   */
  private validateModule(module: Module): void {
    if (!module.name) {
      throw new Error('Module must have a name');
    }
    if (!module.steps || !Array.isArray(module.steps) || module.steps.length === 0) {
      throw new Error('Module must have at least one step');
    }
  }

  /**
   * Get all flows from a suite
   */
  loadFlowsFromSuite(suite: Suite): Flow[] {
    const flows: Flow[] = [];
    const suiteDir = this.basePath;

    for (const flowPath of suite.flows) {
      try {
        const flow = this.loadFlow(flowPath);
        flows.push(flow);
      } catch (error) {
        logger.error(`Failed to load flow: ${flowPath}`, error);
        throw error;
      }
    }

    return flows;
  }

  /**
   * Load config file if exists
   */
  static loadConfig(basePath: string): LiteQAConfig {
    const configPath = path.join(basePath, 'liteqa.config.yaml');

    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const userConfig = yaml.load(content) as Partial<LiteQAConfig>;
      return { ...DEFAULT_CONFIG, ...userConfig };
    }

    return DEFAULT_CONFIG;
  }
}
