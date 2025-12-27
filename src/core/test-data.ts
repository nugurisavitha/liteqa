// ============================================================================
// LiteQA - Test Data Management (Tosca-Style)
// ============================================================================
//
// Data-driven testing support with:
// - CSV, JSON, Excel data sources
// - Parameter substitution
// - Data iteration
// - Synthetic data generation
// - Environment-specific data
// - Data masking/encryption
//
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface DataSource {
  type: 'csv' | 'json' | 'yaml' | 'inline' | 'generated';
  path?: string;
  data?: Record<string, unknown>[];
  options?: DataSourceOptions;
}

export interface DataSourceOptions {
  delimiter?: string;
  headers?: boolean;
  sheet?: string;
  encoding?: string;
  filter?: string;
  limit?: number;
  shuffle?: boolean;
}

export interface DataSet {
  name: string;
  source: DataSource;
  variables?: Record<string, string>;
  rows: DataRow[];
  currentIndex: number;
}

export interface DataRow {
  index: number;
  data: Record<string, unknown>;
}

export interface GeneratorConfig {
  type: 'uuid' | 'email' | 'name' | 'phone' | 'date' | 'number' | 'string' | 'custom';
  options?: Record<string, unknown>;
}

export interface TestDataConfig {
  dataSets: Record<string, DataSource>;
  generators?: Record<string, GeneratorConfig>;
  environments?: Record<string, Record<string, string>>;
  globalVariables?: Record<string, string>;
}

// ============================================================================
// Test Data Manager
// ============================================================================

export class TestDataManager {
  private dataSets: Map<string, DataSet> = new Map();
  private generators: Map<string, GeneratorConfig> = new Map();
  private globalVariables: Record<string, string> = {};
  private environment: string = 'default';
  private environmentVariables: Record<string, Record<string, string>> = {};
  private basePath: string;

  constructor(basePath: string = '.') {
    this.basePath = basePath;
    this.registerDefaultGenerators();
  }

  // ============================================================================
  // Data Loading
  // ============================================================================

  /**
   * Load data from configuration
   */
  loadConfig(config: TestDataConfig): void {
    // Load global variables
    if (config.globalVariables) {
      this.globalVariables = { ...config.globalVariables };
    }

    // Load environment variables
    if (config.environments) {
      this.environmentVariables = config.environments;
    }

    // Load generators
    if (config.generators) {
      for (const [name, gen] of Object.entries(config.generators)) {
        this.generators.set(name, gen);
      }
    }

    // Load data sets
    for (const [name, source] of Object.entries(config.dataSets)) {
      this.loadDataSet(name, source);
    }
  }

  /**
   * Load a data set from source
   */
  loadDataSet(name: string, source: DataSource): DataSet {
    let rows: DataRow[] = [];

    switch (source.type) {
      case 'csv':
        rows = this.loadCsv(source.path!, source.options);
        break;
      case 'json':
        rows = this.loadJson(source.path!, source.options);
        break;
      case 'yaml':
        rows = this.loadYaml(source.path!, source.options);
        break;
      case 'inline':
        rows = this.loadInline(source.data || [], source.options);
        break;
      case 'generated':
        rows = this.generateData(source.options);
        break;
    }

    // Apply options
    if (source.options?.shuffle) {
      rows = this.shuffle(rows);
    }
    if (source.options?.limit) {
      rows = rows.slice(0, source.options.limit);
    }

    const dataSet: DataSet = {
      name,
      source,
      rows,
      currentIndex: 0,
    };

    this.dataSets.set(name, dataSet);
    logger.debug(`Loaded data set '${name}' with ${rows.length} rows`);

    return dataSet;
  }

  /**
   * Load CSV file
   */
  private loadCsv(filePath: string, options?: DataSourceOptions): DataRow[] {
    const fullPath = path.resolve(this.basePath, filePath);
    const content = fs.readFileSync(fullPath, options?.encoding as BufferEncoding || 'utf-8');
    const delimiter = options?.delimiter || ',';
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) return [];

    const hasHeaders = options?.headers !== false;
    const headers = hasHeaders
      ? lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''))
      : lines[0].split(delimiter).map((_, i) => `col${i}`);

    const dataLines = hasHeaders ? lines.slice(1) : lines;

    return dataLines.map((line, index) => {
      const values = this.parseCsvLine(line, delimiter);
      const data: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        data[header] = values[i]?.trim().replace(/^["']|["']$/g, '') ?? '';
      });
      return { index, data };
    });
  }

  /**
   * Parse CSV line handling quoted values
   */
  private parseCsvLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  /**
   * Load JSON file
   */
  private loadJson(filePath: string, options?: DataSourceOptions): DataRow[] {
    const fullPath = path.resolve(this.basePath, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);
    const rows = Array.isArray(data) ? data : [data];

    return rows.map((item, index) => ({ index, data: item }));
  }

  /**
   * Load YAML file
   */
  private loadYaml(filePath: string, options?: DataSourceOptions): DataRow[] {
    const yaml = require('js-yaml');
    const fullPath = path.resolve(this.basePath, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const data = yaml.load(content);
    const rows = Array.isArray(data) ? data : [data];

    return rows.map((item, index) => ({ index, data: item }));
  }

  /**
   * Load inline data
   */
  private loadInline(data: Record<string, unknown>[], options?: DataSourceOptions): DataRow[] {
    return data.map((item, index) => ({ index, data: item }));
  }

  /**
   * Generate synthetic data
   */
  private generateData(options?: DataSourceOptions): DataRow[] {
    const count = options?.limit || 10;
    const rows: DataRow[] = [];

    for (let i = 0; i < count; i++) {
      rows.push({
        index: i,
        data: {
          id: this.generate('uuid'),
          email: this.generate('email'),
          name: this.generate('name'),
          phone: this.generate('phone'),
          timestamp: this.generate('date'),
        },
      });
    }

    return rows;
  }

  // ============================================================================
  // Data Access
  // ============================================================================

  /**
   * Get current row from a data set
   */
  getCurrentRow(dataSetName: string): DataRow | undefined {
    const dataSet = this.dataSets.get(dataSetName);
    if (!dataSet) return undefined;
    return dataSet.rows[dataSet.currentIndex];
  }

  /**
   * Get next row from a data set
   */
  getNextRow(dataSetName: string): DataRow | undefined {
    const dataSet = this.dataSets.get(dataSetName);
    if (!dataSet) return undefined;

    if (dataSet.currentIndex >= dataSet.rows.length - 1) {
      return undefined; // No more rows
    }

    dataSet.currentIndex++;
    return dataSet.rows[dataSet.currentIndex];
  }

  /**
   * Reset data set to beginning
   */
  resetDataSet(dataSetName: string): void {
    const dataSet = this.dataSets.get(dataSetName);
    if (dataSet) {
      dataSet.currentIndex = 0;
    }
  }

  /**
   * Get all rows from a data set
   */
  getAllRows(dataSetName: string): DataRow[] {
    const dataSet = this.dataSets.get(dataSetName);
    return dataSet?.rows || [];
  }

  /**
   * Get row count
   */
  getRowCount(dataSetName: string): number {
    const dataSet = this.dataSets.get(dataSetName);
    return dataSet?.rows.length || 0;
  }

  /**
   * Check if more rows available
   */
  hasMoreRows(dataSetName: string): boolean {
    const dataSet = this.dataSets.get(dataSetName);
    if (!dataSet) return false;
    return dataSet.currentIndex < dataSet.rows.length - 1;
  }

  // ============================================================================
  // Variable Substitution
  // ============================================================================

  /**
   * Substitute variables in a string
   * Supports: ${variable}, ${DataSet.column}, ${env.variable}, ${gen.type}
   */
  substitute(template: string, additionalVars?: Record<string, unknown>): string {
    return template.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      const value = this.resolveExpression(expr, additionalVars);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Substitute variables in an object (deep)
   */
  substituteObject<T>(obj: T, additionalVars?: Record<string, unknown>): T {
    if (typeof obj === 'string') {
      return this.substitute(obj, additionalVars) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.substituteObject(item, additionalVars)) as unknown as T;
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.substituteObject(value, additionalVars);
      }
      return result as T;
    }
    return obj;
  }

  /**
   * Resolve a variable expression
   */
  private resolveExpression(expr: string, additionalVars?: Record<string, unknown>): unknown {
    const parts = expr.split('.');

    // Check additional variables first
    if (additionalVars && expr in additionalVars) {
      return additionalVars[expr];
    }

    // Check global variables
    if (expr in this.globalVariables) {
      return this.globalVariables[expr];
    }

    // Check environment variables
    if (parts[0] === 'env') {
      const varName = parts.slice(1).join('.');
      const envVars = this.environmentVariables[this.environment] || {};
      return envVars[varName] ?? process.env[varName];
    }

    // Check generators
    if (parts[0] === 'gen') {
      return this.generate(parts[1] as GeneratorConfig['type']);
    }

    // Check data sets
    const dataSet = this.dataSets.get(parts[0]);
    if (dataSet) {
      const row = dataSet.rows[dataSet.currentIndex];
      if (row && parts.length > 1) {
        return this.getNestedValue(row.data, parts.slice(1));
      }
    }

    // Check process environment
    if (process.env[expr]) {
      return process.env[expr];
    }

    return undefined;
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: unknown, path: string[]): unknown {
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  // ============================================================================
  // Data Generation
  // ============================================================================

  /**
   * Register default generators
   */
  private registerDefaultGenerators(): void {
    this.generators.set('uuid', { type: 'uuid' });
    this.generators.set('email', { type: 'email' });
    this.generators.set('name', { type: 'name' });
    this.generators.set('phone', { type: 'phone' });
    this.generators.set('date', { type: 'date' });
    this.generators.set('number', { type: 'number' });
    this.generators.set('string', { type: 'string' });
  }

  /**
   * Generate synthetic data
   */
  generate(type: GeneratorConfig['type'], options?: Record<string, unknown>): string {
    switch (type) {
      case 'uuid':
        return this.generateUuid();
      case 'email':
        return this.generateEmail(options);
      case 'name':
        return this.generateName(options);
      case 'phone':
        return this.generatePhone(options);
      case 'date':
        return this.generateDate(options);
      case 'number':
        return this.generateNumber(options);
      case 'string':
        return this.generateString(options);
      default:
        return '';
    }
  }

  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private generateEmail(options?: Record<string, unknown>): string {
    const domains = ['example.com', 'test.com', 'demo.org'];
    const name = this.generateString({ length: 8, charset: 'lowercase' });
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `${name}@${domain}`;
  }

  private generateName(options?: Record<string, unknown>): string {
    const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana', 'Edward', 'Fiona'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller'];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${first} ${last}`;
  }

  private generatePhone(options?: Record<string, unknown>): string {
    const format = options?.format as string || '(###) ###-####';
    return format.replace(/#/g, () => Math.floor(Math.random() * 10).toString());
  }

  private generateDate(options?: Record<string, unknown>): string {
    const start = options?.start ? new Date(options.start as string) : new Date(2020, 0, 1);
    const end = options?.end ? new Date(options.end as string) : new Date();
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return date.toISOString().split('T')[0];
  }

  private generateNumber(options?: Record<string, unknown>): string {
    const min = options?.min as number ?? 0;
    const max = options?.max as number ?? 1000;
    return Math.floor(Math.random() * (max - min + 1) + min).toString();
  }

  private generateString(options?: Record<string, unknown>): string {
    const length = options?.length as number ?? 10;
    const charset = options?.charset as string ?? 'alphanumeric';
    const chars = {
      lowercase: 'abcdefghijklmnopqrstuvwxyz',
      uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      numeric: '0123456789',
      alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      special: '!@#$%^&*()_+-=[]{}|;:,.<>?',
    }[charset] || charset;

    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Set current environment
   */
  setEnvironment(env: string): void {
    this.environment = env;
    logger.debug(`Test data environment set to: ${env}`);
  }

  /**
   * Set global variable
   */
  setVariable(name: string, value: string): void {
    this.globalVariables[name] = value;
  }

  /**
   * Get global variable
   */
  getVariable(name: string): string | undefined {
    return this.globalVariables[name];
  }

  /**
   * Shuffle array
   */
  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Get loaded data set names
   */
  getDataSetNames(): string[] {
    return Array.from(this.dataSets.keys());
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.dataSets.clear();
    this.globalVariables = {};
  }
}

// ============================================================================
// Data Iterator for loops
// ============================================================================

export class DataIterator {
  private dataManager: TestDataManager;
  private dataSetName: string;
  private started = false;

  constructor(dataManager: TestDataManager, dataSetName: string) {
    this.dataManager = dataManager;
    this.dataSetName = dataSetName;
  }

  /**
   * Iterator protocol
   */
  *[Symbol.iterator](): Generator<DataRow> {
    this.dataManager.resetDataSet(this.dataSetName);

    const rows = this.dataManager.getAllRows(this.dataSetName);
    for (const row of rows) {
      yield row;
    }
  }

  /**
   * Get next row
   */
  next(): DataRow | undefined {
    if (!this.started) {
      this.started = true;
      return this.dataManager.getCurrentRow(this.dataSetName);
    }
    return this.dataManager.getNextRow(this.dataSetName);
  }

  /**
   * Check if more rows
   */
  hasNext(): boolean {
    if (!this.started) return this.dataManager.getRowCount(this.dataSetName) > 0;
    return this.dataManager.hasMoreRows(this.dataSetName);
  }

  /**
   * Reset iterator
   */
  reset(): void {
    this.started = false;
    this.dataManager.resetDataSet(this.dataSetName);
  }
}
