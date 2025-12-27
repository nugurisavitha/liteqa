/**
 * LiteQA Web Server
 * Express + Socket.io for web UI with Multi-Project Support
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { FlowLoader } from '../core/flow-loader';
import { WebRunner } from '../runners/web-runner';
import { ApiRunner } from '../runners/api-runner';
import { PerformanceRunner } from '../runners/performance-runner';
import { JsonReporter, JsonReport } from '../reporters/json-reporter';
import { Flow, FlowResult } from '../core/types';
import { BrowserRecorder } from './recorder';
import { LoadTester, WebVitalsCollector } from '../performance/load-tester';

export class LiteQAServer {
  private app: express.Application;
  private server: any;
  private io: SocketServer;
  private port: number;
  private workspaceDir: string;
  private recorders: Map<string, BrowserRecorder> = new Map();

  constructor(port: number = 3000, workspaceDir: string = process.cwd()) {
    this.port = port;
    this.workspaceDir = workspaceDir;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketServer(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from web/public
    const publicDir = path.join(__dirname, 'public');
    this.app.use(express.static(publicDir));
  }

  private getProjectDir(projectName: string): string {
    return path.join(this.workspaceDir, projectName);
  }

  private setupRoutes(): void {
    // API Routes
    const api = express.Router();

    // ==========================================
    // Project Management APIs
    // ==========================================

    // List all projects
    api.get('/projects', (req: Request, res: Response) => {
      const projects = this.listProjects();
      res.json(projects);
    });

    // Get single project info
    api.get('/projects/:project', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const info = this.getProjectInfo(req.params.project);
      res.json(info);
    });

    // Create new project
    api.post('/projects', (req: Request, res: Response) => {
      const { name, description, baseUrl } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }

      // Sanitize project name
      const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const projectDir = this.getProjectDir(safeName);

      if (fs.existsSync(projectDir)) {
        return res.status(400).json({ error: 'Project already exists' });
      }

      try {
        // Create project directory structure
        fs.mkdirSync(projectDir, { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'flows'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'artifacts', 'reports'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'artifacts', 'screenshots'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'data'), { recursive: true });

        // Create suite.yaml
        const suiteContent = `# ${name} Test Suite
# ${'='.repeat(name.length + 12)}

name: ${name}
description: ${description || 'Test suite for ' + name}

# List of flow files to run
flows: []

# Environment variables
env:
  BASE_URL: ${baseUrl || 'https://example.com'}
  TIMEOUT: 30000
`;
        fs.writeFileSync(path.join(projectDir, 'suite.yaml'), suiteContent);

        // Create repository.yaml
        const repoContent = `# Object Repository for ${name}
# Centralized element locators

pages: {}
`;
        fs.writeFileSync(path.join(projectDir, 'repository.yaml'), repoContent);

        res.json({
          success: true,
          project: {
            name: safeName,
            displayName: name,
            path: projectDir,
            description,
            baseUrl
          }
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Delete project
    api.delete('/projects/:project', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);

      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Project not found' });
      }

      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ==========================================
    // Flow APIs (scoped to project)
    // ==========================================

    // List flows for a project
    api.get('/projects/:project/flows', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Project not found' });
      }
      const flows = this.listFlows(projectDir);
      res.json(flows);
    });

    // Get single flow
    api.get('/projects/:project/flows/:name', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const flowPath = this.findFlowPath(projectDir, req.params.name);
      if (!flowPath) {
        return res.status(404).json({ error: 'Flow not found' });
      }
      const content = fs.readFileSync(flowPath, 'utf-8');
      const flow = yaml.load(content);
      res.json({ path: flowPath, content, parsed: flow });
    });

    // Create new flow
    api.post('/projects/:project/flows', (req: Request, res: Response) => {
      const { name, content } = req.body;
      const projectDir = this.getProjectDir(req.params.project);

      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const flowsDir = path.join(projectDir, 'flows');
      if (!fs.existsSync(flowsDir)) {
        fs.mkdirSync(flowsDir, { recursive: true });
      }

      const flowPath = path.join(flowsDir, `${name}.yaml`);
      if (fs.existsSync(flowPath)) {
        return res.status(400).json({ error: 'Flow already exists' });
      }

      fs.writeFileSync(flowPath, content, 'utf-8');

      // Update suite.yaml to include the new flow
      this.addFlowToSuite(projectDir, `flows/${name}.yaml`);

      res.json({ success: true, path: flowPath });
    });

    // Update flow
    api.put('/projects/:project/flows/:name', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const flowPath = this.findFlowPath(projectDir, req.params.name);
      if (!flowPath) {
        return res.status(404).json({ error: 'Flow not found' });
      }
      try {
        fs.writeFileSync(flowPath, req.body.content, 'utf-8');
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Delete flow
    api.delete('/projects/:project/flows/:name', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const flowPath = this.findFlowPath(projectDir, req.params.name);
      if (!flowPath) {
        return res.status(404).json({ error: 'Flow not found' });
      }
      fs.unlinkSync(flowPath);
      res.json({ success: true });
    });

    // ==========================================
    // Excel Import API
    // ==========================================

    // Configure multer for file uploads
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv'
        ];
        if (allowedTypes.includes(file.mimetype) ||
            file.originalname.endsWith('.xlsx') ||
            file.originalname.endsWith('.xls') ||
            file.originalname.endsWith('.csv')) {
          cb(null, true);
        } else {
          cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'));
        }
      }
    });

    // Import test cases from Excel
    api.post('/projects/:project/import', upload.single('file'), (req: Request & { file?: Express.Multer.File }, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);

      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: 'Project not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      try {
        const results = this.importTestCasesFromExcel(req.file.buffer, projectDir);
        res.json(results);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Get import template info
    api.get('/import/template', (req: Request, res: Response) => {
      res.json({
        description: 'Excel template for importing test cases',
        columns: [
          { name: 'Test Case ID', description: 'Unique identifier for the test case', example: 'TC001' },
          { name: 'Test Case Name', description: 'Name of the test case', example: 'Login Test' },
          { name: 'Description', description: 'Description of what the test does', example: 'Verify user can login' },
          { name: 'Test Steps', description: 'Steps separated by newlines or numbered (1. 2. 3.)', example: '1. Go to login page\n2. Enter username\n3. Enter password\n4. Click login' },
          { name: 'Expected Result', description: 'Expected outcome (optional)', example: 'User is logged in' },
          { name: 'Base URL', description: 'Starting URL for the test (optional)', example: 'https://example.com' }
        ],
        notes: [
          'First row should contain column headers',
          'Test Steps can be written as numbered list or separated by newlines',
          'Each row will be converted to a separate test flow file'
        ]
      });
    });

    // ==========================================
    // Reports APIs (scoped to project)
    // ==========================================

    // Get reports for a project
    api.get('/projects/:project/reports', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const reports = this.listReports(projectDir);
      res.json(reports);
    });

    // Get single report
    api.get('/projects/:project/reports/:name', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const reportPath = path.join(projectDir, 'artifacts', 'reports', req.params.name);
      if (!fs.existsSync(reportPath)) {
        return res.status(404).json({ error: 'Report not found' });
      }
      const content = fs.readFileSync(reportPath, 'utf-8');
      res.json(JSON.parse(content));
    });

    // Delete report
    api.delete('/projects/:project/reports/:name', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const reportPath = path.join(projectDir, 'artifacts', 'reports', req.params.name);
      if (!fs.existsSync(reportPath)) {
        return res.status(404).json({ error: 'Report not found' });
      }
      fs.unlinkSync(reportPath);
      res.json({ success: true, message: 'Report deleted' });
    });

    // ==========================================
    // Suite APIs (scoped to project)
    // ==========================================

    // Get suites for a project
    api.get('/projects/:project/suites', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const suites = this.listSuites(projectDir);
      res.json(suites);
    });

    // ==========================================
    // Object Repository APIs (scoped to project)
    // ==========================================

    // Get repository
    api.get('/projects/:project/repository', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const repoPath = path.join(projectDir, 'repository.yaml');
      if (!fs.existsSync(repoPath)) {
        return res.json({ pages: {} });
      }
      const content = fs.readFileSync(repoPath, 'utf-8');
      res.json(yaml.load(content));
    });

    // Save repository
    api.put('/projects/:project/repository', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const repoPath = path.join(projectDir, 'repository.yaml');
      const content = yaml.dump(req.body);
      fs.writeFileSync(repoPath, content, 'utf-8');
      res.json({ success: true });
    });

    // ==========================================
    // Performance Testing APIs
    // ==========================================

    // Run load test
    api.post('/projects/:project/performance/load', async (req: Request, res: Response) => {
      try {
        const { targetUrl, method, headers, body, virtualUsers, duration, rampUp, thinkTime, assertions } = req.body;

        if (!targetUrl || !virtualUsers || !duration) {
          return res.status(400).json({ error: 'targetUrl, virtualUsers, and duration are required' });
        }

        const loadTester = new LoadTester();
        const result = await loadTester.run({
          targetUrl,
          method: method || 'GET',
          headers,
          body,
          virtualUsers,
          duration,
          rampUp,
          thinkTime,
          assertions,
        });

        // Save performance report
        const projectDir = this.getProjectDir(req.params.project);
        const reportsDir = path.join(projectDir, 'artifacts', 'reports');
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportName = `perf_load_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const reportPath = path.join(reportsDir, reportName);
        fs.writeFileSync(reportPath, JSON.stringify({
          type: 'load',
          name: `Load Test - ${targetUrl}`,
          description: `Load test with ${virtualUsers} users for ${duration}s`,
          timestamp: new Date().toISOString(),
          ...result,
        }, null, 2));

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Measure page performance (Web Vitals)
    api.post('/projects/:project/performance/page', async (req: Request, res: Response) => {
      try {
        const { urls, waitForNetworkIdle, timeout } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return res.status(400).json({ error: 'urls array is required' });
        }

        const collector = new WebVitalsCollector();
        const results = await collector.measureMultiple(urls);

        // Save performance report
        const projectDir = this.getProjectDir(req.params.project);
        const reportsDir = path.join(projectDir, 'artifacts', 'reports');
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportName = `perf_vitals_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const reportPath = path.join(reportsDir, reportName);
        fs.writeFileSync(reportPath, JSON.stringify({
          type: 'page',
          name: 'Web Vitals Measurement',
          description: `Page performance for ${urls.length} URL(s)`,
          timestamp: new Date().toISOString(),
          results,
        }, null, 2));

        res.json({ results });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Measure API performance
    api.post('/projects/:project/performance/api', async (req: Request, res: Response) => {
      try {
        const { url, method, headers, body, iterations } = req.body;

        if (!url || !iterations) {
          return res.status(400).json({ error: 'url and iterations are required' });
        }

        const responseTimes: number[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < iterations; i++) {
          const start = Date.now();
          try {
            const response = await fetch(url, {
              method: method || 'GET',
              headers,
              body: body ? JSON.stringify(body) : undefined,
            });
            if (response.ok) {
              successCount++;
            } else {
              errorCount++;
            }
            responseTimes.push(Date.now() - start);
          } catch {
            errorCount++;
            responseTimes.push(Date.now() - start);
          }
        }

        responseTimes.sort((a, b) => a - b);
        const avg = responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length;
        const min = responseTimes[0] || 0;
        const max = responseTimes[responseTimes.length - 1] || 0;
        const p95Idx = Math.floor(responseTimes.length * 0.95);
        const p99Idx = Math.floor(responseTimes.length * 0.99);
        const p95 = responseTimes[p95Idx] || max;
        const p99 = responseTimes[p99Idx] || max;
        const errorRate = (errorCount / iterations) * 100;

        const result = {
          url,
          iterations,
          metrics: {
            avgResponseTime: avg,
            minResponseTime: min,
            maxResponseTime: max,
            p95,
            p99,
            errorRate,
            successCount,
            errorCount,
          },
        };

        // Save performance report
        const projectDir = this.getProjectDir(req.params.project);
        const reportsDir = path.join(projectDir, 'artifacts', 'reports');
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportName = `perf_api_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const reportPath = path.join(reportsDir, reportName);
        fs.writeFileSync(reportPath, JSON.stringify({
          type: 'api',
          name: `API Performance - ${url}`,
          description: `API performance test with ${iterations} iterations`,
          timestamp: new Date().toISOString(),
          ...result,
        }, null, 2));

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Get performance reports
    api.get('/projects/:project/performance/reports', (req: Request, res: Response) => {
      const projectDir = this.getProjectDir(req.params.project);
      const reportsDir = path.join(projectDir, 'artifacts', 'reports');

      if (!fs.existsSync(reportsDir)) {
        return res.json([]);
      }

      const reports = fs.readdirSync(reportsDir)
        .filter(f => f.startsWith('perf_') && f.endsWith('.json'))
        .map(file => {
          const filePath = path.join(reportsDir, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return {
              name: file,
              path: filePath,
              type: content.type,
              displayName: content.name,
              description: content.description,
              timestamp: content.timestamp,
            };
          } catch {
            return { name: file, path: filePath, error: 'Parse error' };
          }
        })
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

      res.json(reports);
    });

    // ==========================================
    // Legacy APIs (for backward compatibility)
    // ==========================================

    // Get project info (legacy - uses first project or workspace)
    api.get('/project', (req: Request, res: Response) => {
      const projects = this.listProjects();
      if (projects.length > 0) {
        const info = this.getProjectInfo(projects[0].name);
        res.json(info);
      } else {
        res.json({
          name: 'workspace',
          path: this.workspaceDir,
          flowCount: 0,
          reportCount: 0
        });
      }
    });

    // List all flows (legacy - from first project)
    api.get('/flows', (req: Request, res: Response) => {
      const projects = this.listProjects();
      if (projects.length > 0) {
        const projectDir = this.getProjectDir(projects[0].name);
        const flows = this.listFlows(projectDir);
        res.json(flows);
      } else {
        res.json([]);
      }
    });

    // Create flow (legacy)
    api.post('/flows', (req: Request, res: Response) => {
      const projects = this.listProjects();
      if (projects.length === 0) {
        return res.status(400).json({ error: 'No projects exist. Create a project first.' });
      }

      const { name, content, project } = req.body;
      const projectName = project || projects[0].name;
      const projectDir = this.getProjectDir(projectName);

      const flowsDir = path.join(projectDir, 'flows');
      if (!fs.existsSync(flowsDir)) {
        fs.mkdirSync(flowsDir, { recursive: true });
      }

      const flowPath = path.join(flowsDir, `${name}.yaml`);
      if (fs.existsSync(flowPath)) {
        return res.status(400).json({ error: 'Flow already exists' });
      }

      fs.writeFileSync(flowPath, content, 'utf-8');
      this.addFlowToSuite(projectDir, `flows/${name}.yaml`);

      res.json({ success: true, path: flowPath });
    });

    // Reports (legacy)
    api.get('/reports', (req: Request, res: Response) => {
      const projects = this.listProjects();
      if (projects.length > 0) {
        const projectDir = this.getProjectDir(projects[0].name);
        const reports = this.listReports(projectDir);
        res.json(reports);
      } else {
        res.json([]);
      }
    });

    // Suites (legacy)
    api.get('/suites', (req: Request, res: Response) => {
      const projects = this.listProjects();
      if (projects.length > 0) {
        const projectDir = this.getProjectDir(projects[0].name);
        const suites = this.listSuites(projectDir);
        res.json(suites);
      } else {
        res.json([]);
      }
    });

    this.app.use('/api', api);

    // Serve index.html for all other routes (SPA)
    this.app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  private addFlowToSuite(projectDir: string, flowPath: string): void {
    const suitePath = path.join(projectDir, 'suite.yaml');
    if (!fs.existsSync(suitePath)) return;

    try {
      const content = fs.readFileSync(suitePath, 'utf-8');
      const suite: any = yaml.load(content);

      if (!suite.flows) {
        suite.flows = [];
      }

      if (!suite.flows.includes(flowPath)) {
        suite.flows.push(flowPath);
        fs.writeFileSync(suitePath, yaml.dump(suite), 'utf-8');
      }
    } catch {
      // Ignore errors
    }
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // Run a flow
      socket.on('run:flow', async (data: { flowPath: string; project?: string }) => {
        const projectDir = data.project ? this.getProjectDir(data.project) : this.workspaceDir;
        await this.executeFlow(socket, data.flowPath, projectDir);
      });

      // Run a suite
      socket.on('run:suite', async (data: { suitePath: string; project?: string }) => {
        const projectDir = data.project ? this.getProjectDir(data.project) : this.workspaceDir;
        await this.executeSuite(socket, data.suitePath, projectDir);
      });

      // Stop execution
      socket.on('run:stop', () => {
        socket.emit('run:stopped');
      });

      // ==========================================
      // Recording handlers
      // ==========================================

      // Start recording
      socket.on('record:start', async (data: { url: string }) => {
        try {
          // Clean up any existing recorder for this socket
          const existingRecorder = this.recorders.get(socket.id);
          if (existingRecorder) {
            await existingRecorder.stop();
          }

          const recorder = new BrowserRecorder();
          this.recorders.set(socket.id, recorder);

          // Start recording with callback for each action
          await recorder.start(data.url, (action) => {
            socket.emit('record:action', action);
          });

          socket.emit('record:started');
        } catch (err: any) {
          console.error('Recording error:', err);
          socket.emit('record:error', { error: err.message });
        }
      });

      // Stop recording
      socket.on('record:stop', async () => {
        try {
          const recorder = this.recorders.get(socket.id);
          if (recorder) {
            const actions = await recorder.stop();
            this.recorders.delete(socket.id);
            socket.emit('record:stopped', { actions });
          } else {
            socket.emit('record:stopped', { actions: [] });
          }
        } catch (err: any) {
          console.error('Stop recording error:', err);
          socket.emit('record:error', { error: err.message });
        }
      });

      socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        // Clean up recorder if any
        const recorder = this.recorders.get(socket.id);
        if (recorder) {
          try {
            await recorder.stop();
          } catch {
            // Ignore cleanup errors
          }
          this.recorders.delete(socket.id);
        }
      });
    });
  }

  private async executeFlow(socket: any, flowPath: string, projectDir: string): Promise<void> {
    const fullPath = path.isAbsolute(flowPath)
      ? flowPath
      : path.join(projectDir, flowPath);

    socket.emit('run:started', { flowPath: fullPath });

    try {
      const loader = new FlowLoader(path.dirname(fullPath));
      const flow = loader.loadFlow(path.basename(fullPath));

      socket.emit('run:flow:started', {
        name: flow.name,
        stepCount: flow.steps.length
      });

      // Run the flow using the appropriate runner
      let result: FlowResult;

      if (flow.runner === 'api') {
        const runner = new ApiRunner();
        result = await this.runApiFlowWithProgress(runner, flow, socket);
      } else {
        const runner = new WebRunner();
        result = await this.runWebFlowWithProgress(runner, flow, socket);
      }

      // Save report
      const reporter = new JsonReporter({ reportsDir: path.join(projectDir, 'artifacts', 'reports') });
      const report = reporter.generateFromFlow(result);
      reporter.save(report, 'report.json');

      socket.emit('run:completed', { result: this.formatResult(result) });

    } catch (err: any) {
      socket.emit('run:error', { error: err.message });
    }
  }

  private async runWebFlowWithProgress(runner: WebRunner, flow: Flow, socket: any): Promise<FlowResult> {
    const result = await runner.runFlow(flow);

    // Emit step results after completion
    result.steps.forEach((step, index) => {
      socket.emit('run:step:completed', {
        index,
        status: step.status,
        duration: step.duration,
        error: step.error
      });
    });

    return result;
  }

  private async runApiFlowWithProgress(runner: ApiRunner, flow: Flow, socket: any): Promise<FlowResult> {
    const result = await runner.runFlow(flow);

    // Emit step results after completion
    result.steps.forEach((step, index) => {
      socket.emit('run:step:completed', {
        index,
        status: step.status,
        duration: step.duration,
        error: step.error
      });
    });

    return result;
  }

  private formatResult(result: FlowResult): any {
    return {
      name: result.name,
      status: result.status,
      duration: result.duration,
      startTime: result.startTime.toISOString(),
      endTime: result.endTime.toISOString(),
      steps: result.steps.map(s => ({
        action: s.step.action,
        description: s.step.description,
        status: s.status,
        duration: s.duration,
        error: s.error
      }))
    };
  }

  private async executeSuite(socket: any, suitePath: string, projectDir: string): Promise<void> {
    const fullPath = path.isAbsolute(suitePath)
      ? suitePath
      : path.join(projectDir, suitePath);

    socket.emit('run:started', { suitePath: fullPath });

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const suite: any = yaml.load(content);

      socket.emit('run:suite:started', {
        name: suite.name,
        flowCount: suite.flows.length
      });

      const results: FlowResult[] = [];
      const suiteStart = Date.now();
      const suiteDir = path.dirname(fullPath);

      for (const flowFile of suite.flows) {
        const flowPath = path.join(suiteDir, flowFile);
        const loader = new FlowLoader(path.dirname(flowPath));
        const flow = loader.loadFlow(path.basename(flowPath));

        socket.emit('run:flow:started', {
          name: flow.name,
          stepCount: flow.steps.length
        });

        let result: FlowResult;

        if (flow.runner === 'api') {
          const runner = new ApiRunner();
          result = await runner.runFlow(flow);
        } else {
          const runner = new WebRunner();
          result = await runner.runFlow(flow);
        }

        results.push(result);
        socket.emit('run:flow:completed', { result: this.formatResult(result) });
      }

      // Save report
      const totalPassed = results.filter(r => r.status === 'passed').length;
      const totalFailed = results.filter(r => r.status === 'failed').length;

      const report: JsonReport = {
        timestamp: new Date().toISOString(),
        duration: Date.now() - suiteStart,
        summary: {
          total: results.length,
          passed: totalPassed,
          failed: totalFailed,
          skipped: 0,
          passRate: results.length > 0 ? ((totalPassed / results.length) * 100).toFixed(1) + '%' : '0%'
        },
        environment: {
          platform: process.platform,
          nodeVersion: process.version,
          liteqaVersion: '1.0.0'
        },
        flows: results.map(r => ({
          name: r.name,
          status: r.status,
          duration: r.duration,
          startTime: r.startTime.toISOString(),
          endTime: r.endTime.toISOString(),
          steps: r.steps.map(s => ({
            action: s.step.action,
            description: s.step.description,
            status: s.status,
            duration: s.duration,
            error: s.error
          }))
        }))
      };

      const reporter = new JsonReporter({ reportsDir: path.join(projectDir, 'artifacts', 'reports') });
      reporter.save(report, 'report.json');

      socket.emit('run:completed', {
        result: {
          summary: report.summary,
          flows: report.flows
        }
      });

    } catch (err: any) {
      socket.emit('run:error', { error: err.message });
    }
  }

  private listProjects(): any[] {
    const projects: any[] = [];

    if (!fs.existsSync(this.workspaceDir)) {
      return projects;
    }

    const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectDir = path.join(this.workspaceDir, entry.name);
        const suitePath = path.join(projectDir, 'suite.yaml');
        const flowsDir = path.join(projectDir, 'flows');

        // Check if it looks like a LiteQA project
        if (fs.existsSync(suitePath) || fs.existsSync(flowsDir)) {
          let displayName = entry.name;
          let description = '';
          let baseUrl = '';
          let flowCount = 0;

          // Try to read suite.yaml for more info
          if (fs.existsSync(suitePath)) {
            try {
              const content = fs.readFileSync(suitePath, 'utf-8');
              const suite: any = yaml.load(content);
              displayName = suite.name || entry.name;
              description = suite.description || '';
              baseUrl = suite.env?.BASE_URL || '';
              flowCount = suite.flows?.length || 0;
            } catch {
              // Use defaults
            }
          }

          // Count flows if not in suite
          if (flowCount === 0 && fs.existsSync(flowsDir)) {
            flowCount = fs.readdirSync(flowsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
          }

          projects.push({
            name: entry.name,
            displayName,
            description,
            baseUrl,
            path: projectDir,
            flowCount
          });
        }
      }
    }

    return projects;
  }

  private getProjectInfo(projectName: string): any {
    const projectDir = this.getProjectDir(projectName);
    const suitePath = path.join(projectDir, 'suite.yaml');

    let displayName = projectName;
    let description = '';
    let suiteInfo = null;

    if (fs.existsSync(suitePath)) {
      try {
        const suite: any = yaml.load(fs.readFileSync(suitePath, 'utf-8'));
        displayName = suite.name || projectName;
        description = suite.description || '';
        suiteInfo = {
          name: suite.name,
          flowCount: suite.flows?.length || 0
        };
      } catch {
        // Use defaults
      }
    }

    return {
      name: projectName,
      displayName,
      description,
      path: projectDir,
      suite: suiteInfo,
      flowCount: this.listFlows(projectDir).length,
      reportCount: this.listReports(projectDir).length
    };
  }

  private listFlows(projectDir: string): any[] {
    const flows: any[] = [];
    const flowsDir = path.join(projectDir, 'flows');

    if (fs.existsSync(flowsDir)) {
      const files = fs.readdirSync(flowsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        const filePath = path.join(flowsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const flow: any = yaml.load(content);
          flows.push({
            name: flow.name || file,
            file,
            path: filePath,
            runner: flow.runner || 'web',
            stepCount: flow.steps?.length || 0,
            description: flow.description
          });
        } catch {
          flows.push({ name: file, file, path: filePath, error: 'Parse error' });
        }
      }
    }

    return flows;
  }

  private findFlowPath(projectDir: string, name: string): string | null {
    const flowsDir = path.join(projectDir, 'flows');

    // Try exact match
    const exactPath = path.join(flowsDir, name);
    if (fs.existsSync(exactPath)) return exactPath;

    // Try with .yaml extension
    const yamlPath = path.join(flowsDir, `${name}.yaml`);
    if (fs.existsSync(yamlPath)) return yamlPath;

    // Try with .yml extension
    const ymlPath = path.join(flowsDir, `${name}.yml`);
    if (fs.existsSync(ymlPath)) return ymlPath;

    return null;
  }

  private listReports(projectDir: string): any[] {
    const reports: any[] = [];
    const reportsDir = path.join(projectDir, 'artifacts', 'reports');

    if (fs.existsSync(reportsDir)) {
      const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(reportsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const report = JSON.parse(content);
          reports.push({
            name: file,
            path: filePath,
            timestamp: report.timestamp,
            description: report.description || report.summary?.description || 'Test execution',
            duration: report.duration || report.summary?.duration || 0,
            summary: report.summary
          });
        } catch {
          reports.push({ name: file, path: filePath, error: 'Parse error' });
        }
      }
    }

    return reports.sort((a, b) =>
      new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
  }

  private listSuites(projectDir: string): any[] {
    const suites: any[] = [];

    if (!fs.existsSync(projectDir)) return suites;

    const files = fs.readdirSync(projectDir).filter(f =>
      (f.endsWith('.yaml') || f.endsWith('.yml')) && f.includes('suite')
    );

    for (const file of files) {
      const filePath = path.join(projectDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const suite: any = yaml.load(content);
        if (suite.flows) {
          suites.push({
            name: suite.name || file,
            file,
            path: filePath,
            flowCount: suite.flows.length,
            description: suite.description
          });
        }
      } catch {
        // Not a suite file
      }
    }

    return suites;
  }

  private importTestCasesFromExcel(buffer: Buffer, projectDir: string): any {
    // Parse Excel file
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (data.length < 2) {
      throw new Error('Excel file must have at least a header row and one data row');
    }

    // Get headers (first row)
    const headers = data[0].map((h: any) => String(h || '').toLowerCase().trim());

    // Find column indices
    const colMap = {
      id: this.findColumnIndex(headers, ['test case id', 'testcase id', 'tc id', 'id', 'test id']),
      name: this.findColumnIndex(headers, ['test case name', 'testcase name', 'name', 'title', 'test name']),
      description: this.findColumnIndex(headers, ['description', 'desc', 'test description']),
      steps: this.findColumnIndex(headers, ['test steps', 'steps', 'test step', 'procedure', 'actions']),
      expected: this.findColumnIndex(headers, ['expected result', 'expected', 'expected outcome', 'result']),
      url: this.findColumnIndex(headers, ['base url', 'url', 'baseurl', 'start url'])
    };

    if (colMap.steps === -1) {
      throw new Error('Could not find "Test Steps" column in Excel file');
    }

    const flowsDir = path.join(projectDir, 'flows');
    if (!fs.existsSync(flowsDir)) {
      fs.mkdirSync(flowsDir, { recursive: true });
    }

    const results = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: [] as string[],
      flows: [] as string[]
    };

    // Process each row (skip header)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      try {
        const testCaseId = colMap.id >= 0 ? String(row[colMap.id] || '').trim() : `TC${String(i).padStart(3, '0')}`;
        const testCaseName = colMap.name >= 0 ? String(row[colMap.name] || '').trim() : testCaseId;
        const description = colMap.description >= 0 ? String(row[colMap.description] || '').trim() : '';
        const stepsText = colMap.steps >= 0 ? String(row[colMap.steps] || '').trim() : '';
        const expected = colMap.expected >= 0 ? String(row[colMap.expected] || '').trim() : '';
        const baseUrl = colMap.url >= 0 ? String(row[colMap.url] || '').trim() : '';

        if (!stepsText) {
          results.skipped++;
          continue;
        }

        // Parse steps from text
        const steps = this.parseTestSteps(stepsText, baseUrl);

        if (steps.length === 0) {
          results.skipped++;
          continue;
        }

        // Generate YAML content
        const flowContent = this.generateFlowYaml(testCaseId, testCaseName, description, steps, expected);

        // Save flow file
        const filename = testCaseId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const flowPath = path.join(flowsDir, `${filename}.yaml`);

        fs.writeFileSync(flowPath, flowContent, 'utf-8');

        // Add to suite
        this.addFlowToSuite(projectDir, `flows/${filename}.yaml`);

        results.imported++;
        results.flows.push(`${filename}.yaml`);
      } catch (err: any) {
        results.errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    return results;
  }

  private findColumnIndex(headers: string[], possibleNames: string[]): number {
    for (const name of possibleNames) {
      const index = headers.findIndex(h => h.includes(name));
      if (index >= 0) return index;
    }
    return -1;
  }

  private parseTestSteps(stepsText: string, baseUrl: string): any[] {
    const steps: any[] = [];

    // Split by newlines, semicolons, or numbered patterns
    const lines = stepsText
      .split(/[\n\r;]+|(?=\d+\.\s)/)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 0);

    for (const line of lines) {
      const step = this.parseStepLine(line, baseUrl);
      if (step) {
        steps.push(step);
      }
    }

    return steps;
  }

  private parseStepLine(line: string, baseUrl: string): any {
    const lineLower = line.toLowerCase();

    // Navigate / Go to URL
    if (lineLower.startsWith('go to') || lineLower.startsWith('navigate to') || lineLower.startsWith('open')) {
      const urlMatch = line.match(/(?:go to|navigate to|open)\s+(.+)/i);
      let url = urlMatch ? urlMatch[1].trim() : baseUrl || 'https://example.com';

      // If it's not a full URL, try to make it one
      if (url && !url.startsWith('http')) {
        if (baseUrl) {
          url = baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
        } else {
          url = 'https://' + url;
        }
      }

      return {
        action: 'goto',
        url: url,
        description: line
      };
    }

    // Click
    if (lineLower.startsWith('click') || lineLower.includes('click on') || lineLower.includes('press')) {
      const match = line.match(/(?:click|click on|press)\s+(?:the\s+)?(?:on\s+)?["']?([^"']+)["']?/i);
      const target = match ? match[1].trim() : 'button';

      return {
        action: 'click',
        selector: this.generateSelector(target),
        description: line
      };
    }

    // Enter / Type / Fill
    if (lineLower.startsWith('enter') || lineLower.startsWith('type') || lineLower.startsWith('input') || lineLower.includes('fill in')) {
      const match = line.match(/(?:enter|type|input|fill in)\s+["']?([^"']+)["']?\s+(?:in|into|to)\s+(?:the\s+)?["']?([^"']+)["']?/i);
      if (match) {
        return {
          action: 'fill',
          selector: this.generateSelector(match[2].trim()),
          value: match[1].trim(),
          description: line
        };
      }

      // Try alternative pattern: "Enter username"
      const altMatch = line.match(/(?:enter|type|input)\s+(?:the\s+)?["']?([^"']+)["']?/i);
      if (altMatch) {
        return {
          action: 'fill',
          selector: this.generateSelector(altMatch[1].trim()),
          value: '${' + altMatch[1].trim().replace(/\s+/g, '_').toUpperCase() + '}',
          description: line
        };
      }
    }

    // Select / Choose
    if (lineLower.startsWith('select') || lineLower.startsWith('choose')) {
      const match = line.match(/(?:select|choose)\s+["']?([^"']+)["']?\s+(?:from|in)\s+(?:the\s+)?["']?([^"']+)["']?/i);
      if (match) {
        return {
          action: 'select',
          selector: this.generateSelector(match[2].trim()),
          value: match[1].trim(),
          description: line
        };
      }
    }

    // Verify / Check / Assert
    if (lineLower.startsWith('verify') || lineLower.startsWith('check') || lineLower.startsWith('assert') || lineLower.includes('should')) {
      const textMatch = line.match(/(?:verify|check|assert|should\s+(?:see|display|show))\s+(?:that\s+)?(?:the\s+)?["']?([^"']+)["']?/i);
      if (textMatch) {
        return {
          action: 'expectVisible',
          selector: this.generateSelector(textMatch[1].trim()),
          description: line
        };
      }
    }

    // Wait
    if (lineLower.startsWith('wait')) {
      const timeMatch = line.match(/wait\s+(?:for\s+)?(\d+)\s*(?:seconds?|secs?|s)/i);
      const duration = timeMatch ? parseInt(timeMatch[1]) * 1000 : 2000;

      return {
        action: 'wait',
        duration: duration,
        description: line
      };
    }

    // Screenshot
    if (lineLower.includes('screenshot') || lineLower.includes('capture')) {
      return {
        action: 'screenshot',
        name: 'step_screenshot',
        description: line
      };
    }

    // Default: treat as a click action
    return {
      action: 'click',
      selector: this.generateSelector(line),
      description: line
    };
  }

  private generateSelector(text: string): string {
    // Clean the text
    const clean = text.toLowerCase().trim();

    // Common element mappings
    const mappings: { [key: string]: string } = {
      'login button': 'button:has-text("Login")',
      'submit button': 'button[type="submit"]',
      'sign in': 'button:has-text("Sign In")',
      'sign up': 'button:has-text("Sign Up")',
      'username': 'input[name="username"], input[id="username"], input[placeholder*="username" i]',
      'password': 'input[type="password"], input[name="password"]',
      'email': 'input[type="email"], input[name="email"], input[placeholder*="email" i]',
      'search': 'input[type="search"], input[name="search"], input[placeholder*="search" i]',
      'submit': 'button[type="submit"], input[type="submit"]'
    };

    if (mappings[clean]) {
      return mappings[clean];
    }

    // Generate a generic selector
    if (clean.includes('button')) {
      return `button:has-text("${text}")`;
    }
    if (clean.includes('link')) {
      return `a:has-text("${text}")`;
    }
    if (clean.includes('field') || clean.includes('input') || clean.includes('textbox')) {
      return `input[placeholder*="${text}" i], input[name*="${text}" i]`;
    }

    // Default: text-based selector
    return `text="${text}"`;
  }

  private generateFlowYaml(id: string, name: string, description: string, steps: any[], expected: string): string {
    let yaml = `# ${name}\n`;
    yaml += `# ${'='.repeat(name.length)}\n\n`;
    yaml += `name: ${name}\n`;
    yaml += `description: ${description || 'Imported test case ' + id}\n`;
    yaml += `runner: web\n\n`;

    if (expected) {
      yaml += `# Expected Result: ${expected}\n\n`;
    }

    yaml += `steps:\n`;

    for (const step of steps) {
      yaml += `  - action: ${step.action}\n`;

      if (step.url) {
        yaml += `    url: ${step.url}\n`;
      }
      if (step.selector) {
        // Escape inner quotes and use single quotes for outer wrapper
        const escapedSelector = step.selector.replace(/"/g, '\\"');
        yaml += `    selector: "${escapedSelector}"\n`;
      }
      if (step.value !== undefined) {
        const escapedValue = String(step.value).replace(/"/g, '\\"');
        yaml += `    value: "${escapedValue}"\n`;
      }
      if (step.duration !== undefined) {
        yaml += `    duration: ${step.duration}\n`;
      }
      if (step.name) {
        yaml += `    name: ${step.name}\n`;
      }
      if (step.description) {
        yaml += `    description: ${step.description}\n`;
      }
      yaml += `\n`;
    }

    return yaml;
  }

  public start(): void {
    this.server.listen(this.port, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   LiteQA Web UI                                              ║
║   ────────────────────────────────────────────────────────   ║
║                                                              ║
║   Local:     http://localhost:${this.port}                        ║
║   Workspace: ${this.workspaceDir.substring(0, 42).padEnd(42)}   ║
║                                                              ║
║   Press Ctrl+C to stop                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });
  }

  public stop(): void {
    this.server.close();
  }
}

export function startServer(port: number = 3000, workspaceDir: string = process.cwd()): LiteQAServer {
  const server = new LiteQAServer(port, workspaceDir);
  server.start();
  return server;
}
