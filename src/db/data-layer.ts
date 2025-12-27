/**
 * LiteQA Data Access Layer
 * Abstracts storage to work with both file system and MongoDB
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  isDatabaseConnected,
  Project,
  Flow,
  Report,
  Repository,
  Suite,
  IProject,
  IFlow,
  IReport,
} from './database';

// ============================================================================
// Project Operations
// ============================================================================

export async function listProjects(workspaceDir: string): Promise<any[]> {
  if (isDatabaseConnected()) {
    const projects = await Project.find().sort({ updatedAt: -1 });
    return projects.map(p => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      baseUrl: p.baseUrl,
      path: path.join(workspaceDir, p.name),
    }));
  }

  // File-based fallback
  if (!fs.existsSync(workspaceDir)) return [];

  const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
  const projects: any[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const projectPath = path.join(workspaceDir, entry.name);
      const suitePath = path.join(projectPath, 'suite.yaml');
      const configPath = path.join(projectPath, 'liteqa.config.yaml');

      if (fs.existsSync(suitePath) || fs.existsSync(configPath) || fs.existsSync(path.join(projectPath, 'flows'))) {
        let displayName = entry.name;
        let description = '';

        if (fs.existsSync(suitePath)) {
          try {
            const suite = yaml.load(fs.readFileSync(suitePath, 'utf-8')) as any;
            displayName = suite?.name || entry.name;
            description = suite?.description || '';
          } catch {}
        }

        projects.push({
          name: entry.name,
          displayName,
          description,
          path: projectPath,
        });
      }
    }
  }

  return projects;
}

export async function getProject(workspaceDir: string, projectName: string): Promise<any | null> {
  if (isDatabaseConnected()) {
    const project = await Project.findOne({ name: projectName });
    if (!project) return null;
    return {
      name: project.name,
      displayName: project.displayName,
      description: project.description,
      baseUrl: project.baseUrl,
      path: path.join(workspaceDir, project.name),
    };
  }

  const projectPath = path.join(workspaceDir, projectName);
  if (!fs.existsSync(projectPath)) return null;

  return { name: projectName, path: projectPath };
}

export async function createProject(workspaceDir: string, name: string, displayName: string, description?: string, baseUrl?: string): Promise<any> {
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  if (isDatabaseConnected()) {
    const project = new Project({
      name: safeName,
      displayName: displayName || name,
      description,
      baseUrl,
    });
    await project.save();

    // Also create empty suite
    const suite = new Suite({
      projectName: safeName,
      name: displayName || name,
      description,
      flows: [],
      env: { BASE_URL: baseUrl || 'https://example.com' },
    });
    await suite.save();

    return {
      name: safeName,
      displayName: displayName || name,
      description,
      baseUrl,
      path: path.join(workspaceDir, safeName),
    };
  }

  // File-based
  const projectDir = path.join(workspaceDir, safeName);
  if (fs.existsSync(projectDir)) {
    throw new Error('Project already exists');
  }

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'flows'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'artifacts', 'reports'), { recursive: true });

  const suiteContent = `name: ${displayName || name}\ndescription: ${description || ''}\nflows: []\nenv:\n  BASE_URL: ${baseUrl || 'https://example.com'}\n`;
  fs.writeFileSync(path.join(projectDir, 'suite.yaml'), suiteContent);

  return { name: safeName, displayName: displayName || name, path: projectDir };
}

export async function deleteProject(workspaceDir: string, projectName: string): Promise<void> {
  if (isDatabaseConnected()) {
    await Project.deleteOne({ name: projectName });
    await Flow.deleteMany({ projectName });
    await Report.deleteMany({ projectName });
    await Repository.deleteOne({ projectName });
    await Suite.deleteOne({ projectName });
    return;
  }

  const projectDir = path.join(workspaceDir, projectName);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Flow Operations
// ============================================================================

export async function listFlows(workspaceDir: string, projectName: string): Promise<any[]> {
  if (isDatabaseConnected()) {
    const flows = await Flow.find({ projectName }).sort({ updatedAt: -1 });
    return flows.map(f => ({
      name: f.name,
      file: f.fileName,
      path: path.join(workspaceDir, projectName, 'flows', f.fileName),
      runner: f.runner,
      stepCount: f.steps?.length || 0,
      description: f.description,
    }));
  }

  // File-based
  const flowsDir = path.join(workspaceDir, projectName, 'flows');
  if (!fs.existsSync(flowsDir)) return [];

  const files = fs.readdirSync(flowsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const flows: any[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(flowsDir, file), 'utf-8');
      const flow = yaml.load(content) as any;
      flows.push({
        name: flow?.name || file.replace(/\.ya?ml$/, ''),
        file,
        path: path.join(flowsDir, file),
        runner: flow?.runner || 'web',
        stepCount: flow?.steps?.length || 0,
        description: flow?.description || '',
      });
    } catch {}
  }

  return flows;
}

export async function getFlow(workspaceDir: string, projectName: string, fileName: string): Promise<any | null> {
  if (isDatabaseConnected()) {
    const flow = await Flow.findOne({ projectName, fileName });
    if (!flow) return null;
    return {
      name: flow.name,
      fileName: flow.fileName,
      content: flow.content,
      runner: flow.runner,
      steps: flow.steps,
      description: flow.description,
    };
  }

  const flowPath = path.join(workspaceDir, projectName, 'flows', fileName);
  if (!fs.existsSync(flowPath)) return null;

  const content = fs.readFileSync(flowPath, 'utf-8');
  const flow = yaml.load(content) as any;
  return { ...flow, content, fileName };
}

export async function saveFlow(workspaceDir: string, projectName: string, fileName: string, content: string): Promise<void> {
  const flow = yaml.load(content) as any;

  if (isDatabaseConnected()) {
    await Flow.findOneAndUpdate(
      { projectName, fileName },
      {
        projectName,
        fileName,
        name: flow?.name || fileName.replace(/\.ya?ml$/, ''),
        description: flow?.description,
        runner: flow?.runner || 'web',
        content,
        steps: flow?.steps || [],
      },
      { upsert: true, new: true }
    );
    return;
  }

  const flowsDir = path.join(workspaceDir, projectName, 'flows');
  fs.mkdirSync(flowsDir, { recursive: true });
  fs.writeFileSync(path.join(flowsDir, fileName), content);
}

export async function deleteFlow(workspaceDir: string, projectName: string, fileName: string): Promise<void> {
  if (isDatabaseConnected()) {
    await Flow.deleteOne({ projectName, fileName });
    return;
  }

  const flowPath = path.join(workspaceDir, projectName, 'flows', fileName);
  if (fs.existsSync(flowPath)) {
    fs.unlinkSync(flowPath);
  }
}

// ============================================================================
// Report Operations
// ============================================================================

export async function listReports(workspaceDir: string, projectName: string, type?: string): Promise<any[]> {
  if (isDatabaseConnected()) {
    const query: any = { projectName };
    if (type) query.type = type;

    const reports = await Report.find(query).sort({ timestamp: -1 });
    return reports.map(r => ({
      name: r.fileName,
      displayName: r.name,
      type: r.type,
      status: r.status,
      description: r.description,
      timestamp: r.timestamp,
      duration: r.duration,
      path: path.join(workspaceDir, projectName, 'artifacts', 'reports', r.fileName),
    }));
  }

  // File-based
  const reportsDir = path.join(workspaceDir, projectName, 'artifacts', 'reports');
  if (!fs.existsSync(reportsDir)) return [];

  const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));
  const reports: any[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(reportsDir, file), 'utf-8');
      const report = JSON.parse(content);

      // Filter by type if specified
      if (type && report.type !== type) continue;

      reports.push({
        name: file,
        displayName: report.name || file,
        type: report.type || 'functional',
        status: report.status || 'passed',
        description: report.description,
        timestamp: report.timestamp,
        duration: report.duration,
        path: path.join(reportsDir, file),
      });
    } catch {}
  }

  return reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function getReport(workspaceDir: string, projectName: string, fileName: string): Promise<any | null> {
  if (isDatabaseConnected()) {
    const report = await Report.findOne({ projectName, fileName });
    if (!report) return null;
    return report.content;
  }

  const reportPath = path.join(workspaceDir, projectName, 'artifacts', 'reports', fileName);
  if (!fs.existsSync(reportPath)) return null;

  const content = fs.readFileSync(reportPath, 'utf-8');
  return JSON.parse(content);
}

export async function saveReport(workspaceDir: string, projectName: string, fileName: string, content: any): Promise<void> {
  if (isDatabaseConnected()) {
    await Report.findOneAndUpdate(
      { projectName, fileName },
      {
        projectName,
        fileName,
        type: content.type || 'functional',
        name: content.name || fileName,
        description: content.description,
        status: content.status || 'passed',
        content,
        timestamp: content.timestamp ? new Date(content.timestamp) : new Date(),
        duration: content.duration,
        totalSteps: content.summary?.totalSteps,
        passedSteps: content.summary?.passedSteps,
        failedSteps: content.summary?.failedSteps,
        metrics: content.metrics,
      },
      { upsert: true, new: true }
    );
    return;
  }

  const reportsDir = path.join(workspaceDir, projectName, 'artifacts', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, fileName), JSON.stringify(content, null, 2));
}

export async function deleteReport(workspaceDir: string, projectName: string, fileName: string): Promise<void> {
  if (isDatabaseConnected()) {
    await Report.deleteOne({ projectName, fileName });
    return;
  }

  const reportPath = path.join(workspaceDir, projectName, 'artifacts', 'reports', fileName);
  if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }
}

// ============================================================================
// Repository Operations
// ============================================================================

export async function getRepository(workspaceDir: string, projectName: string): Promise<string> {
  if (isDatabaseConnected()) {
    const repo = await Repository.findOne({ projectName });
    return repo?.content || '# Object Repository\npages: {}';
  }

  const repoPath = path.join(workspaceDir, projectName, 'repository.yaml');
  if (!fs.existsSync(repoPath)) return '# Object Repository\npages: {}';
  return fs.readFileSync(repoPath, 'utf-8');
}

export async function saveRepository(workspaceDir: string, projectName: string, content: string): Promise<void> {
  const pages = yaml.load(content) as any;

  if (isDatabaseConnected()) {
    await Repository.findOneAndUpdate(
      { projectName },
      { projectName, content, pages: pages?.pages || {} },
      { upsert: true }
    );
    return;
  }

  const repoPath = path.join(workspaceDir, projectName, 'repository.yaml');
  fs.writeFileSync(repoPath, content);
}

// ============================================================================
// Suite Operations
// ============================================================================

export async function getSuite(workspaceDir: string, projectName: string): Promise<any | null> {
  if (isDatabaseConnected()) {
    const suite = await Suite.findOne({ projectName });
    if (!suite) return null;
    return {
      name: suite.name,
      description: suite.description,
      flows: suite.flows,
      env: suite.env,
      content: suite.content,
    };
  }

  const suitePath = path.join(workspaceDir, projectName, 'suite.yaml');
  if (!fs.existsSync(suitePath)) return null;

  const content = fs.readFileSync(suitePath, 'utf-8');
  const suite = yaml.load(content) as any;
  return { ...suite, content };
}

export async function saveSuite(workspaceDir: string, projectName: string, content: string): Promise<void> {
  const suite = yaml.load(content) as any;

  if (isDatabaseConnected()) {
    await Suite.findOneAndUpdate(
      { projectName },
      {
        projectName,
        name: suite?.name || projectName,
        description: suite?.description,
        flows: suite?.flows || [],
        env: suite?.env || {},
        content,
      },
      { upsert: true }
    );
    return;
  }

  const suitePath = path.join(workspaceDir, projectName, 'suite.yaml');
  fs.writeFileSync(suitePath, content);
}
