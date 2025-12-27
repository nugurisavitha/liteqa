// ============================================================================
// LiteQA - API Runner (REST Client)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  Flow,
  Step,
  StepResult,
  FlowResult,
  LiteQAConfig,
  DEFAULT_CONFIG,
  RequestStep,
  ExpectStatusStep,
  ExpectJsonPathStep,
} from '../core/types';
import { logger } from '../utils/logger';

interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  duration: number;
}

interface RequestLog {
  timestamp: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  response: ApiResponse;
}

export class ApiRunner {
  private config: LiteQAConfig;
  private lastResponse: ApiResponse | null = null;
  private savedResponses: Map<string, unknown> = new Map();
  private requestLogs: RequestLog[] = [];
  private flowName = '';

  constructor(config: Partial<LiteQAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a complete API flow
   */
  async runFlow(flow: Flow): Promise<FlowResult> {
    this.flowName = flow.name;
    this.requestLogs = [];
    this.savedResponses.clear();
    this.lastResponse = null;

    const startTime = new Date();
    const stepResults: StepResult[] = [];
    let flowPassed = true;

    logger.flowStart(flow.name);

    try {
      // Run setup steps
      if (flow.setup) {
        for (const step of flow.setup) {
          const result = await this.runStep(step, stepResults.length + 1, flow.setup.length + flow.steps.length);
          stepResults.push(result);
          if (result.status === 'failed' && !step.continueOnError) {
            flowPassed = false;
            break;
          }
        }
      }

      // Run main steps
      if (flowPassed) {
        const totalSteps = (flow.setup?.length || 0) + flow.steps.length + (flow.teardown?.length || 0);
        let stepIndex = (flow.setup?.length || 0) + 1;

        for (const step of flow.steps) {
          const result = await this.runStep(step, stepIndex++, totalSteps);
          stepResults.push(result);
          if (result.status === 'failed' && !step.continueOnError) {
            flowPassed = false;
            break;
          }
        }
      }

      // Run teardown
      if (flow.teardown) {
        for (const step of flow.teardown) {
          const result = await this.runStep(step, stepResults.length + 1, stepResults.length + flow.teardown.length);
          stepResults.push(result);
        }
      }
    } catch (error) {
      logger.error(`Flow failed with error: ${(error as Error).message}`);
      flowPassed = false;
    }

    // Save request logs
    await this.saveRequestLogs();

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

    logger.step(index, total, step.action, description);

    try {
      await this.executeStep(step);

      const duration = Date.now() - startTime;
      logger.stepPass(index, total, step.action, duration);

      return {
        step,
        status: 'passed',
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      logger.stepFail(index, total, step.action, errorMessage);

      return {
        step,
        status: 'failed',
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a step based on its action type
   */
  private async executeStep(step: Step): Promise<void> {
    switch (step.action) {
      case 'request':
        await this.executeRequest(step as RequestStep);
        break;
      case 'expectStatus':
        await this.executeExpectStatus(step as ExpectStatusStep);
        break;
      case 'expectJsonPath':
        await this.executeExpectJsonPath(step as ExpectJsonPathStep);
        break;
      default:
        throw new Error(`Unknown API action: ${(step as any).action}`);
    }
  }

  // ============================================================================
  // Step Implementations
  // ============================================================================

  private async executeRequest(step: RequestStep): Promise<void> {
    const startTime = Date.now();

    // Substitute variables in URL and body
    let url = this.substituteVariables(step.url);
    let body = step.body ? this.substituteVariables(JSON.stringify(step.body)) : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...step.headers,
    };

    const fetchOptions: RequestInit = {
      method: step.method,
      headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(step.method)) {
      fetchOptions.body = body;
    }

    logger.debug(`API Request: ${step.method} ${url}`);

    const response = await fetch(url, fetchOptions);

    let responseBody: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    const duration = Date.now() - startTime;

    // Convert headers to object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    this.lastResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      duration,
    };

    // Save response if requested
    if (step.saveResponse) {
      this.savedResponses.set(step.saveResponse, responseBody);
    }

    // Log request
    this.requestLogs.push({
      timestamp: new Date().toISOString(),
      method: step.method,
      url,
      headers: step.headers,
      body: step.body,
      response: this.lastResponse,
    });

    logger.debug(`API Response: ${response.status} ${response.statusText} (${duration}ms)`);
  }

  private async executeExpectStatus(step: ExpectStatusStep): Promise<void> {
    if (!this.lastResponse) {
      throw new Error('No response to check - make a request first');
    }

    if (this.lastResponse.status !== step.status) {
      throw new Error(
        `Expected status ${step.status} but got ${this.lastResponse.status}`
      );
    }
  }

  private async executeExpectJsonPath(step: ExpectJsonPathStep): Promise<void> {
    if (!this.lastResponse) {
      throw new Error('No response to check - make a request first');
    }

    const value = this.getJsonPath(this.lastResponse.body, step.path);

    if (value === undefined) {
      throw new Error(`JSON path "${step.path}" not found in response`);
    }

    if (step.value !== undefined) {
      if (JSON.stringify(value) !== JSON.stringify(step.value)) {
        throw new Error(
          `Expected "${step.path}" to equal ${JSON.stringify(step.value)} but got ${JSON.stringify(value)}`
        );
      }
    }

    if (step.contains !== undefined) {
      const stringValue = String(value);
      if (!stringValue.includes(step.contains)) {
        throw new Error(
          `Expected "${step.path}" to contain "${step.contains}" but got "${stringValue}"`
        );
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get value at JSON path (simple implementation)
   * Supports: $.field, $.field.nested, $.array[0], $.array[*].field
   */
  private getJsonPath(obj: unknown, path: string): unknown {
    if (!path.startsWith('$.')) {
      path = '$.' + path;
    }

    const parts = path.slice(2).split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array index: field[0]
      const arrayMatch = part.match(/^(\w+)\[(\d+|\*)\]$/);

      if (arrayMatch) {
        const field = arrayMatch[1];
        const index = arrayMatch[2];

        current = (current as Record<string, unknown>)[field];

        if (!Array.isArray(current)) {
          return undefined;
        }

        if (index === '*') {
          // Return all items
          return current;
        }

        current = current[parseInt(index, 10)];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  /**
   * Substitute variables in string
   */
  private substituteVariables(str: string): string {
    // Substitute saved responses: ${response.fieldName}
    return str.replace(/\$\{(\w+)\.?([\w.]*)\}/g, (_, name, path) => {
      if (this.savedResponses.has(name)) {
        const saved = this.savedResponses.get(name);
        if (path) {
          const value = this.getJsonPath(saved, path);
          return String(value ?? `\${${name}.${path}}`);
        }
        return JSON.stringify(saved);
      }

      // Check environment variables
      if (process.env[name]) {
        return process.env[name]!;
      }

      return `\${${name}${path ? '.' + path : ''}}`;
    });
  }

  private getStepDescription(step: Step): string {
    switch (step.action) {
      case 'request':
        const req = step as RequestStep;
        return `${req.method} ${req.url}`;
      case 'expectStatus':
        return `status = ${(step as ExpectStatusStep).status}`;
      case 'expectJsonPath':
        return `${(step as ExpectJsonPathStep).path}`;
      default:
        return '';
    }
  }

  /**
   * Save request logs to artifacts folder
   */
  private async saveRequestLogs(): Promise<void> {
    if (this.requestLogs.length === 0) return;

    const logsDir = path.join(this.config.artifactsDir, 'api-logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const filename = `${this.flowName.replace(/\s+/g, '-')}-api-log.json`;
    const filepath = path.join(logsDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(this.requestLogs, null, 2), 'utf-8');

    logger.debug(`API logs saved: ${filepath}`);
  }
}
