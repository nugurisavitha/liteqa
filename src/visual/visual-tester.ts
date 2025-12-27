// ============================================================================
// LiteQA - Visual Regression Testing
// ============================================================================
//
// Pixel-by-pixel screenshot comparison with:
// - Baseline image management
// - Configurable thresholds
// - Diff image generation
// - Element-level comparison
// - Ignore regions
// - Cross-browser comparison
//
// ============================================================================

import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface VisualConfig {
  baselineDir: string;
  actualDir: string;
  diffDir: string;
  threshold: number;
  antialiasing: boolean;
  ignoreColors: boolean;
  ignoreRegions?: IgnoreRegion[];
  failOnMissing: boolean;
  updateBaseline: boolean;
}

export interface IgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}

export interface ComparisonResult {
  name: string;
  passed: boolean;
  baselinePath: string;
  actualPath: string;
  diffPath?: string;
  diffPixels: number;
  diffPercentage: number;
  dimensions: { width: number; height: number };
  timestamp: string;
  message: string;
}

export interface VisualReport {
  timestamp: string;
  totalComparisons: number;
  passed: number;
  failed: number;
  new: number;
  comparisons: ComparisonResult[];
}

// ============================================================================
// Visual Tester
// ============================================================================

export class VisualTester {
  private config: VisualConfig;
  private results: ComparisonResult[] = [];

  constructor(config: Partial<VisualConfig> = {}) {
    this.config = {
      baselineDir: './visual-baselines',
      actualDir: './artifacts/visual/actual',
      diffDir: './artifacts/visual/diff',
      threshold: 0.1, // 0.1% difference allowed
      antialiasing: true,
      ignoreColors: false,
      failOnMissing: false,
      updateBaseline: false,
      ...config,
    };

    // Ensure directories exist
    fs.mkdirSync(this.config.baselineDir, { recursive: true });
    fs.mkdirSync(this.config.actualDir, { recursive: true });
    fs.mkdirSync(this.config.diffDir, { recursive: true });
  }

  // ============================================================================
  // Main Comparison Methods
  // ============================================================================

  /**
   * Compare a page screenshot against baseline
   */
  async comparePage(
    page: Page,
    name: string,
    options?: {
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      ignoreRegions?: IgnoreRegion[];
      threshold?: number;
    }
  ): Promise<ComparisonResult> {
    const actualPath = path.join(this.config.actualDir, `${name}.png`);
    const baselinePath = path.join(this.config.baselineDir, `${name}.png`);

    // Take screenshot
    await page.screenshot({
      path: actualPath,
      fullPage: options?.fullPage ?? true,
      clip: options?.clip,
    });

    // Compare
    return this.compare(name, actualPath, baselinePath, {
      ignoreRegions: options?.ignoreRegions,
      threshold: options?.threshold,
    });
  }

  /**
   * Compare an element screenshot against baseline
   */
  async compareElement(
    page: Page,
    selector: string,
    name: string,
    options?: {
      padding?: number;
      ignoreRegions?: IgnoreRegion[];
      threshold?: number;
    }
  ): Promise<ComparisonResult> {
    const actualPath = path.join(this.config.actualDir, `${name}.png`);
    const baselinePath = path.join(this.config.baselineDir, `${name}.png`);

    // Find element and take screenshot
    const element = page.locator(selector);
    await element.screenshot({ path: actualPath });

    return this.compare(name, actualPath, baselinePath, {
      ignoreRegions: options?.ignoreRegions,
      threshold: options?.threshold,
    });
  }

  /**
   * Compare two image files
   */
  compare(
    name: string,
    actualPath: string,
    baselinePath: string,
    options?: {
      ignoreRegions?: IgnoreRegion[];
      threshold?: number;
    }
  ): ComparisonResult {
    const threshold = options?.threshold ?? this.config.threshold;
    const ignoreRegions = [...(this.config.ignoreRegions || []), ...(options?.ignoreRegions || [])];

    // Check if baseline exists
    if (!fs.existsSync(baselinePath)) {
      if (this.config.updateBaseline) {
        // Create baseline
        fs.copyFileSync(actualPath, baselinePath);
        const result: ComparisonResult = {
          name,
          passed: true,
          baselinePath,
          actualPath,
          diffPixels: 0,
          diffPercentage: 0,
          dimensions: this.getImageDimensions(actualPath),
          timestamp: new Date().toISOString(),
          message: 'New baseline created',
        };
        this.results.push(result);
        logger.info(`Created baseline: ${name}`);
        return result;
      }

      const result: ComparisonResult = {
        name,
        passed: !this.config.failOnMissing,
        baselinePath,
        actualPath,
        diffPixels: -1,
        diffPercentage: -1,
        dimensions: this.getImageDimensions(actualPath),
        timestamp: new Date().toISOString(),
        message: 'No baseline found',
      };
      this.results.push(result);
      logger.warn(`No baseline for: ${name}`);
      return result;
    }

    // Load images
    const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
    const actual = PNG.sync.read(fs.readFileSync(actualPath));

    // Check dimensions
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      const result: ComparisonResult = {
        name,
        passed: false,
        baselinePath,
        actualPath,
        diffPixels: -1,
        diffPercentage: 100,
        dimensions: { width: actual.width, height: actual.height },
        timestamp: new Date().toISOString(),
        message: `Dimension mismatch: baseline ${baseline.width}x${baseline.height}, actual ${actual.width}x${actual.height}`,
      };
      this.results.push(result);
      logger.error(`Dimension mismatch: ${name}`);
      return result;
    }

    // Create diff image
    const diff = new PNG({ width: baseline.width, height: baseline.height });

    // Compare pixels
    const { diffPixels, diffPercentage } = this.comparePixels(
      baseline,
      actual,
      diff,
      ignoreRegions
    );

    const passed = diffPercentage <= threshold;

    // Save diff if there are differences
    let diffPath: string | undefined;
    if (diffPixels > 0) {
      diffPath = path.join(this.config.diffDir, `${name}-diff.png`);
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
    }

    // Update baseline if requested and passed
    if (this.config.updateBaseline && passed) {
      fs.copyFileSync(actualPath, baselinePath);
    }

    const result: ComparisonResult = {
      name,
      passed,
      baselinePath,
      actualPath,
      diffPath,
      diffPixels,
      diffPercentage,
      dimensions: { width: baseline.width, height: baseline.height },
      timestamp: new Date().toISOString(),
      message: passed
        ? `Match (${diffPercentage.toFixed(3)}% diff)`
        : `Mismatch (${diffPercentage.toFixed(3)}% diff, threshold: ${threshold}%)`,
    };

    this.results.push(result);

    if (passed) {
      logger.success(`Visual match: ${name} (${diffPercentage.toFixed(3)}% diff)`);
    } else {
      logger.error(`Visual mismatch: ${name} (${diffPercentage.toFixed(3)}% diff)`);
    }

    return result;
  }

  // ============================================================================
  // Pixel Comparison
  // ============================================================================

  private comparePixels(
    baseline: PNG,
    actual: PNG,
    diff: PNG,
    ignoreRegions: IgnoreRegion[]
  ): { diffPixels: number; diffPercentage: number } {
    const { width, height } = baseline;
    let diffPixels = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Check if in ignore region
        if (this.isInIgnoreRegion(x, y, ignoreRegions)) {
          const idx = (y * width + x) * 4;
          // Mark ignored area in diff (gray)
          diff.data[idx] = 128;
          diff.data[idx + 1] = 128;
          diff.data[idx + 2] = 128;
          diff.data[idx + 3] = 255;
          continue;
        }

        const idx = (y * width + x) * 4;

        const baseR = baseline.data[idx];
        const baseG = baseline.data[idx + 1];
        const baseB = baseline.data[idx + 2];
        const baseA = baseline.data[idx + 3];

        const actR = actual.data[idx];
        const actG = actual.data[idx + 1];
        const actB = actual.data[idx + 2];
        const actA = actual.data[idx + 3];

        let isDiff = false;

        if (this.config.ignoreColors) {
          // Compare luminance only
          const baseLum = 0.299 * baseR + 0.587 * baseG + 0.114 * baseB;
          const actLum = 0.299 * actR + 0.587 * actG + 0.114 * actB;
          isDiff = Math.abs(baseLum - actLum) > 10;
        } else {
          // Full RGB comparison
          isDiff = baseR !== actR || baseG !== actG || baseB !== actB || baseA !== actA;
        }

        // Check for antialiasing (if enabled)
        if (isDiff && this.config.antialiasing) {
          if (this.isAntialiased(baseline, x, y, actual)) {
            isDiff = false;
          }
        }

        if (isDiff) {
          diffPixels++;
          // Highlight diff in red
          diff.data[idx] = 255;
          diff.data[idx + 1] = 0;
          diff.data[idx + 2] = 0;
          diff.data[idx + 3] = 255;
        } else {
          // Copy actual pixel (dimmed)
          diff.data[idx] = actual.data[idx] * 0.3;
          diff.data[idx + 1] = actual.data[idx + 1] * 0.3;
          diff.data[idx + 2] = actual.data[idx + 2] * 0.3;
          diff.data[idx + 3] = 255;
        }
      }
    }

    const totalPixels = width * height;
    const diffPercentage = (diffPixels / totalPixels) * 100;

    return { diffPixels, diffPercentage };
  }

  private isInIgnoreRegion(x: number, y: number, regions: IgnoreRegion[]): boolean {
    for (const region of regions) {
      if (
        x >= region.x &&
        x < region.x + region.width &&
        y >= region.y &&
        y < region.y + region.height
      ) {
        return true;
      }
    }
    return false;
  }

  private isAntialiased(img: PNG, x: number, y: number, other: PNG): boolean {
    const { width, height } = img;
    let minDelta = 255 * 3;
    let maxDelta = 0;

    // Check 3x3 neighborhood
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const idx = (ny * width + nx) * 4;
        const delta = Math.abs(img.data[idx] - other.data[idx]) +
                      Math.abs(img.data[idx + 1] - other.data[idx + 1]) +
                      Math.abs(img.data[idx + 2] - other.data[idx + 2]);

        minDelta = Math.min(minDelta, delta);
        maxDelta = Math.max(maxDelta, delta);
      }
    }

    // If there's high variance in neighborhood, likely antialiasing
    return maxDelta - minDelta > 100;
  }

  private getImageDimensions(imagePath: string): { width: number; height: number } {
    const img = PNG.sync.read(fs.readFileSync(imagePath));
    return { width: img.width, height: img.height };
  }

  // ============================================================================
  // Baseline Management
  // ============================================================================

  /**
   * Update baseline from actual
   */
  updateBaseline(name: string): boolean {
    const actualPath = path.join(this.config.actualDir, `${name}.png`);
    const baselinePath = path.join(this.config.baselineDir, `${name}.png`);

    if (!fs.existsSync(actualPath)) {
      logger.error(`Actual image not found: ${actualPath}`);
      return false;
    }

    fs.copyFileSync(actualPath, baselinePath);
    logger.success(`Updated baseline: ${name}`);
    return true;
  }

  /**
   * Update all baselines
   */
  updateAllBaselines(): number {
    let updated = 0;
    const actuals = fs.readdirSync(this.config.actualDir).filter(f => f.endsWith('.png'));

    for (const file of actuals) {
      const name = file.replace('.png', '');
      if (this.updateBaseline(name)) {
        updated++;
      }
    }

    return updated;
  }

  /**
   * Delete baseline
   */
  deleteBaseline(name: string): boolean {
    const baselinePath = path.join(this.config.baselineDir, `${name}.png`);
    if (fs.existsSync(baselinePath)) {
      fs.unlinkSync(baselinePath);
      logger.info(`Deleted baseline: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * List all baselines
   */
  listBaselines(): string[] {
    return fs.readdirSync(this.config.baselineDir)
      .filter(f => f.endsWith('.png'))
      .map(f => f.replace('.png', ''));
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  /**
   * Get comparison results
   */
  getResults(): ComparisonResult[] {
    return this.results;
  }

  /**
   * Generate visual report
   */
  generateReport(): VisualReport {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed && r.diffPixels >= 0).length;
    const newBaselines = this.results.filter(r => r.message === 'New baseline created').length;

    return {
      timestamp: new Date().toISOString(),
      totalComparisons: this.results.length,
      passed,
      failed,
      new: newBaselines,
      comparisons: this.results,
    };
  }

  /**
   * Save HTML report
   */
  saveHtmlReport(outputPath: string): void {
    const report = this.generateReport();

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Visual Regression Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .summary { display: flex; gap: 20px; margin-bottom: 30px; }
    .stat { background: white; padding: 20px; border-radius: 8px; text-align: center; min-width: 100px; }
    .stat .value { font-size: 2em; font-weight: bold; }
    .stat.passed .value { color: #22c55e; }
    .stat.failed .value { color: #ef4444; }
    .comparison { background: white; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
    .comparison-header { padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
    .comparison-header.passed { border-left: 4px solid #22c55e; }
    .comparison-header.failed { border-left: 4px solid #ef4444; }
    .comparison-images { display: flex; gap: 10px; padding: 15px; flex-wrap: wrap; }
    .comparison-images img { max-width: 300px; border: 1px solid #ddd; }
    .comparison-images .label { text-align: center; font-size: 12px; color: #666; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    .badge.passed { background: #dcfce7; color: #166534; }
    .badge.failed { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <h1>Visual Regression Report</h1>
  <p>Generated: ${report.timestamp}</p>

  <div class="summary">
    <div class="stat"><div class="value">${report.totalComparisons}</div><div>Total</div></div>
    <div class="stat passed"><div class="value">${report.passed}</div><div>Passed</div></div>
    <div class="stat failed"><div class="value">${report.failed}</div><div>Failed</div></div>
    <div class="stat"><div class="value">${report.new}</div><div>New</div></div>
  </div>

  ${report.comparisons.map(c => `
    <div class="comparison">
      <div class="comparison-header ${c.passed ? 'passed' : 'failed'}">
        <div>
          <strong>${c.name}</strong>
          <span class="badge ${c.passed ? 'passed' : 'failed'}">${c.passed ? 'PASSED' : 'FAILED'}</span>
        </div>
        <div>${c.message}</div>
      </div>
      <div class="comparison-images">
        <div>
          <div class="label">Baseline</div>
          <img src="${c.baselinePath}" onerror="this.src='data:image/svg+xml,<svg/>'">
        </div>
        <div>
          <div class="label">Actual</div>
          <img src="${c.actualPath}" onerror="this.src='data:image/svg+xml,<svg/>'">
        </div>
        ${c.diffPath ? `
        <div>
          <div class="label">Diff (${c.diffPixels} pixels, ${c.diffPercentage.toFixed(3)}%)</div>
          <img src="${c.diffPath}">
        </div>
        ` : ''}
      </div>
    </div>
  `).join('')}
</body>
</html>`;

    fs.writeFileSync(outputPath, html, 'utf-8');
    logger.info(`Visual report saved: ${outputPath}`);
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }
}

// ============================================================================
// Visual Test Step Types
// ============================================================================

export interface VisualCompareStep {
  action: 'visualCompare';
  name: string;
  fullPage?: boolean;
  threshold?: number;
  ignoreRegions?: IgnoreRegion[];
}

export interface VisualCompareElementStep {
  action: 'visualCompareElement';
  selector: string;
  name: string;
  threshold?: number;
  ignoreRegions?: IgnoreRegion[];
}
