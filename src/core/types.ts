// ============================================================================
// LiteQA - Core Types
// ============================================================================

// Performance step types (imported for Step union)
import type { LoadTestStep, PagePerformanceStep, ApiPerformanceStep } from './performance-types';

export type RunnerType = 'web' | 'api' | 'desktop' | 'mobile' | 'performance';

export type StepStatus = 'passed' | 'failed' | 'skipped' | 'pending';

// ============================================================================
// Step Types
// ============================================================================

export interface BaseStep {
  id?: string;
  description?: string;
  timeout?: number;
  continueOnError?: boolean;
}

// Web Steps
export interface GotoStep extends BaseStep {
  action: 'goto';
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickStep extends BaseStep {
  action: 'click';
  selector: string;
  button?: 'left' | 'right' | 'middle';
}

export interface FillStep extends BaseStep {
  action: 'fill';
  selector: string;
  value: string;
}

export interface TypeStep extends BaseStep {
  action: 'type';
  selector: string;
  text: string;
  delay?: number;
}

export interface ExpectTextStep extends BaseStep {
  action: 'expectText';
  selector: string;
  text: string;
  exact?: boolean;
}

export interface ExpectVisibleStep extends BaseStep {
  action: 'expectVisible';
  selector: string;
}

export interface WaitForSelectorStep extends BaseStep {
  action: 'waitForSelector';
  selector: string;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export interface WaitForLoadStateStep extends BaseStep {
  action: 'waitForLoadState';
  state: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ScreenshotStep extends BaseStep {
  action: 'screenshot';
  name?: string;
  fullPage?: boolean;
}

export interface SelectStep extends BaseStep {
  action: 'select';
  selector: string;
  value: string;
}

export interface HoverStep extends BaseStep {
  action: 'hover';
  selector: string;
}

export interface PressStep extends BaseStep {
  action: 'press';
  selector?: string;
  key: string;
}

export interface WaitStep extends BaseStep {
  action: 'wait';
  duration: number;
}

// API Steps
export interface RequestStep extends BaseStep {
  action: 'request';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  saveResponse?: string;
}

export interface ExpectStatusStep extends BaseStep {
  action: 'expectStatus';
  status: number;
}

export interface ExpectJsonPathStep extends BaseStep {
  action: 'expectJsonPath';
  path: string;
  value?: unknown;
  contains?: string;
}

// Desktop Steps (Windows)
export interface DesktopLaunchStep extends BaseStep {
  action: 'desktopLaunch';
  app: string;
  args?: string[];
}

export interface DesktopClickStep extends BaseStep {
  action: 'desktopClick';
  selector: string;
  controlType?: string;
}

export interface DesktopTypeStep extends BaseStep {
  action: 'desktopType';
  selector: string;
  text: string;
}

export interface DesktopCloseStep extends BaseStep {
  action: 'desktopClose';
}

// Mobile Steps
export interface MobileTapStep extends BaseStep {
  action: 'mobileTap';
  selector: string;
}

export interface MobileTypeStep extends BaseStep {
  action: 'mobileType';
  selector: string;
  text: string;
}

export interface MobileWaitForTextStep extends BaseStep {
  action: 'mobileWaitForText';
  text: string;
}

export interface MobileSwipeStep extends BaseStep {
  action: 'mobileSwipe';
  direction: 'up' | 'down' | 'left' | 'right';
}

// Include Module
export interface IncludeStep extends BaseStep {
  action: 'include';
  module: string;
  params?: Record<string, string>;
}

// Union of all step types (including performance steps)
export type Step =
  | GotoStep
  | ClickStep
  | FillStep
  | TypeStep
  | ExpectTextStep
  | ExpectVisibleStep
  | WaitForSelectorStep
  | WaitForLoadStateStep
  | ScreenshotStep
  | SelectStep
  | HoverStep
  | PressStep
  | WaitStep
  | RequestStep
  | ExpectStatusStep
  | ExpectJsonPathStep
  | DesktopLaunchStep
  | DesktopClickStep
  | DesktopTypeStep
  | DesktopCloseStep
  | MobileTapStep
  | MobileTypeStep
  | MobileWaitForTextStep
  | MobileSwipeStep
  | IncludeStep
  | LoadTestStep
  | PagePerformanceStep
  | ApiPerformanceStep;

// ============================================================================
// Flow & Suite Types
// ============================================================================

export interface Flow {
  name: string;
  description?: string;
  runner: RunnerType;
  baseUrl?: string;
  tags?: string[];
  setup?: Step[];
  steps: Step[];
  teardown?: Step[];
}

export interface Suite {
  name: string;
  description?: string;
  flows: string[];
  parallel?: boolean;
  env?: Record<string, string>;
}

export interface Module {
  name: string;
  description?: string;
  params?: string[];
  steps: Step[];
}

// ============================================================================
// Execution Results
// ============================================================================

export interface StepResult {
  step: Step;
  status: StepStatus;
  duration: number;
  error?: string;
  screenshot?: string;
  healedSelector?: HealedSelector;
}

export interface FlowResult {
  flow: string;
  name: string;
  status: StepStatus;
  duration: number;
  startTime: Date;
  endTime: Date;
  steps: StepResult[];
  error?: string;
}

export interface SuiteResult {
  suite: string;
  name: string;
  status: StepStatus;
  duration: number;
  startTime: Date;
  endTime: Date;
  flows: FlowResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

// ============================================================================
// Self-Healing Types
// ============================================================================

export interface HealedSelector {
  original: string;
  healed: string;
  strategy: 'text-similarity' | 'role-name' | 'css-contains' | 'data-testid-fuzzy';
  confidence: number;
  suggestion: string;
}

export interface SelectorCandidate {
  selector: string;
  score: number;
  strategy: string;
}

// ============================================================================
// Configuration
// ============================================================================

export interface LiteQAConfig {
  artifactsDir: string;
  screenshotsDir: string;
  reportsDir: string;
  defaultTimeout: number;
  headless: boolean;
  slowMo: number;
  retries: number;
  selfHeal: boolean;
  selfHealThreshold: number;
  browser: 'chromium' | 'firefox' | 'webkit';
  viewport: { width: number; height: number };
  mobile?: {
    appiumUrl: string;
    capabilities: Record<string, unknown>;
  };
}

export const DEFAULT_CONFIG: LiteQAConfig = {
  artifactsDir: './artifacts',
  screenshotsDir: './artifacts/screenshots',
  reportsDir: './artifacts/reports',
  defaultTimeout: 30000,
  headless: true,
  slowMo: 0,
  retries: 0,
  selfHeal: true,
  selfHealThreshold: 0.6,
  browser: 'chromium',
  viewport: { width: 1280, height: 720 },
};
