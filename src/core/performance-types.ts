// ============================================================================
// LiteQA - Performance Testing Types
// ============================================================================

import { BaseStep } from './types';
import { PerformanceAssertion } from '../performance/load-tester';

// ============================================================================
// Performance Step Types
// ============================================================================

/**
 * Load Test Step - Simulate concurrent users hitting an endpoint
 */
export interface LoadTestStep extends BaseStep {
  action: 'loadTest';
  targetUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  virtualUsers: number;
  duration: number; // seconds
  rampUp?: number; // seconds to reach full load
  thinkTime?: number; // ms between requests
  assertions?: PerformanceAssertion[];
}

/**
 * Page Performance Step - Measure Web Vitals for a page
 */
export interface PagePerformanceStep extends BaseStep {
  action: 'pagePerformance';
  url: string;
  waitForNetworkIdle?: boolean;
  thresholds?: {
    lcp?: number;   // Largest Contentful Paint (ms)
    fcp?: number;   // First Contentful Paint (ms)
    ttfb?: number;  // Time to First Byte (ms)
    cls?: number;   // Cumulative Layout Shift (score)
    domLoad?: number; // DOM Load time (ms)
    fullLoad?: number; // Full page load (ms)
  };
}

/**
 * API Performance Step - Measure API endpoint response times
 */
export interface ApiPerformanceStep extends BaseStep {
  action: 'apiPerformance';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  iterations: number;
  thresholds?: {
    avgResponseTime?: number;  // ms
    minResponseTime?: number;  // ms
    maxResponseTime?: number;  // ms
    p95?: number;              // ms
    p99?: number;              // ms
    errorRate?: number;        // percentage (0-100)
  };
}

/**
 * Union of all performance step types
 */
export type PerformanceStep = LoadTestStep | PagePerformanceStep | ApiPerformanceStep;

// ============================================================================
// Performance Result Types
// ============================================================================

/**
 * Extended step result with performance metrics
 */
export interface PerformanceStepResult {
  action: string;
  description?: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;

  // Load test metrics
  loadTestMetrics?: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    throughput: number;
    errorRate: number;
  };

  // Web vitals metrics
  webVitals?: {
    lcp?: number;
    fcp?: number;
    fid?: number;
    cls?: number;
    ttfb?: number;
    domLoad?: number;
    fullLoad?: number;
    resourceCount?: number;
    transferSize?: number;
  };

  // API performance metrics
  apiMetrics?: {
    iterations: number;
    avgResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    p95: number;
    p99: number;
    errorRate: number;
    successCount: number;
    errorCount: number;
  };

  // Assertion results
  assertions?: {
    metric: string;
    operator: string;
    expected: number;
    actual: number;
    passed: boolean;
  }[];
}

/**
 * Performance flow result
 */
export interface PerformanceFlowResult {
  name: string;
  description?: string;
  status: 'passed' | 'failed';
  duration: number;
  startTime: Date;
  endTime: Date;
  steps: PerformanceStepResult[];
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
  };
}
