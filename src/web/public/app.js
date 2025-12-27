/**
 * LiteQA Web UI Application
 */

class LiteQAApp {
  constructor() {
    this.socket = null;
    this.currentView = 'dashboard';
    this.flows = [];
    this.suites = [];
    this.reports = [];
    this.projects = [];
    this.currentProject = null;
    this.isRunning = false;
    this.totalSteps = 0;
    this.completedSteps = 0;

    this.init();
  }

  init() {
    this.connectSocket();
    this.setupNavigation();
    this.loadInitialData();
  }

  // Socket Connection
  connectSocket() {
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.updateConnectionStatus(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.updateConnectionStatus(false);
    });

    // Run events
    this.socket.on('run:started', (data) => {
      this.isRunning = true;
      this.log('info', `Starting execution: ${data.flowPath || data.suitePath}`);
      this.updateRunButton();
    });

    this.socket.on('run:flow:started', (data) => {
      this.totalSteps = data.stepCount;
      this.completedSteps = 0;
      this.log('info', `Running flow: ${data.name} (${data.stepCount} steps)`);
      this.updateProgress();
      document.getElementById('step-results').innerHTML = '';
    });

    this.socket.on('run:step:started', (data) => {
      this.log('running', `Step ${data.index + 1}: ${data.action} - ${data.description}`);
      this.addStepResult(data.index, data.action, data.description, 'running');
    });

    this.socket.on('run:step:completed', (data) => {
      this.completedSteps++;
      const status = data.status;
      const icon = status === 'passed' ? '✓' : '✗';
      this.log(status === 'passed' ? 'success' : 'error',
        `${icon} Step ${data.index + 1}: ${status} (${data.duration}ms)`);
      if (data.error) {
        this.log('error', `  Error: ${data.error}`);
      }
      this.updateStepResult(data.index, status, data.duration);
      this.updateProgress();
    });

    this.socket.on('run:flow:completed', (data) => {
      const result = data.result;
      const icon = result.status === 'passed' ? '✓' : '✗';
      this.log(result.status === 'passed' ? 'success' : 'error',
        `${icon} Flow "${result.name}" ${result.status} in ${result.duration}ms`);
    });

    this.socket.on('run:completed', (data) => {
      this.isRunning = false;
      this.log('info', '═══════════════════════════════════════');
      this.log('info', 'Execution completed');

      if (data.result.summary) {
        const s = data.result.summary;
        this.log('info', `Total: ${s.total} | Passed: ${s.passed} | Failed: ${s.failed}`);
      }

      this.updateRunButton();
      this.showToast('Test execution completed', data.result.status === 'passed' ? 'success' : 'error');
      this.loadReports();
      this.loadDashboard();
    });

    this.socket.on('run:error', (data) => {
      this.isRunning = false;
      this.log('error', `Execution error: ${data.error}`);
      this.updateRunButton();
      this.showToast('Execution failed', 'error');
    });

    this.socket.on('run:stopped', () => {
      this.isRunning = false;
      this.log('info', 'Execution stopped');
      this.updateRunButton();
    });
  }

  updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (connected) {
      statusEl.classList.add('connected');
      statusEl.querySelector('span:last-child').textContent = 'Connected';
    } else {
      statusEl.classList.remove('connected');
      statusEl.querySelector('span:last-child').textContent = 'Disconnected';
    }
  }

  // Navigation
  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        this.showView(view);
      });
    });
  }

  showView(viewName) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('active', view.id === `view-${viewName}`);
    });

    this.currentView = viewName;

    // Load view-specific data
    switch (viewName) {
      case 'projects':
        this.loadProjects();
        break;
      case 'dashboard':
        this.loadDashboard();
        break;
      case 'flows':
        this.loadFlows();
        break;
      case 'runner':
        this.loadRunnerOptions();
        break;
      case 'reports':
        this.loadReports();
        break;
      case 'performance':
        this.loadPerformanceReports();
        break;
      case 'repository':
        this.loadRepository();
        break;
      case 'editor':
        this.loadEditorOptions();
        break;
      case 'settings':
        this.loadSettings();
        break;
      case 'builder':
        this.initBuilder();
        break;
    }
  }

  // Data Loading
  async loadInitialData() {
    // Load projects first
    await this.loadProjects();

    // If there's a project, load its data
    if (this.currentProject) {
      await Promise.all([
        this.loadDashboard(),
        this.loadFlows(),
        this.loadReports()
      ]);
    }
  }

  async loadDashboard() {
    if (!this.currentProject) {
      document.getElementById('stat-flows').textContent = '0';
      document.getElementById('stat-reports').textContent = '0';
      document.getElementById('stat-passed').textContent = '0';
      document.getElementById('stat-failed').textContent = '0';
      document.getElementById('recent-runs').innerHTML = '<p class="empty-state">Select a project first</p>';
      return;
    }

    try {
      const [project, reports] = await Promise.all([
        fetch(`/api/projects/${this.currentProject}`).then(r => r.json()),
        fetch(`/api/projects/${this.currentProject}/reports`).then(r => r.json())
      ]);

      document.getElementById('stat-flows').textContent = project.flowCount;
      document.getElementById('stat-reports').textContent = reports.length;

      // Calculate passed/failed from latest report
      if (reports.length > 0 && reports[0].summary) {
        document.getElementById('stat-passed').textContent = reports[0].summary.passed || 0;
        document.getElementById('stat-failed').textContent = reports[0].summary.failed || 0;
      } else {
        document.getElementById('stat-passed').textContent = '0';
        document.getElementById('stat-failed').textContent = '0';
      }

      // Render recent runs
      this.renderRecentRuns(reports.slice(0, 5));
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  renderRecentRuns(reports) {
    const container = document.getElementById('recent-runs');
    if (reports.length === 0) {
      container.innerHTML = '<p class="empty-state">No recent test runs</p>';
      return;
    }

    container.innerHTML = reports.map(report => {
      const passed = report.summary?.failed === 0;
      const date = new Date(report.timestamp).toLocaleString();
      return `
        <div class="run-item">
          <div class="run-item-info">
            <div class="run-status-icon ${passed ? 'passed' : 'failed'}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                ${passed
                  ? '<polyline points="20 6 9 17 4 12"></polyline>'
                  : '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'
                }
              </svg>
            </div>
            <div class="run-details">
              <h4>${report.name}</h4>
              <span>${date}</span>
            </div>
          </div>
          <span class="run-duration">${report.summary?.total || 0} flows</span>
        </div>
      `;
    }).join('');
  }

  async loadFlows() {
    if (!this.currentProject) {
      this.flows = [];
      this.renderFlows();
      return;
    }

    try {
      this.flows = await fetch(`/api/projects/${this.currentProject}/flows`).then(r => r.json());
      this.renderFlows();
    } catch (err) {
      console.error('Failed to load flows:', err);
    }
  }

  renderFlows() {
    const container = document.getElementById('flows-list');
    if (this.flows.length === 0) {
      container.innerHTML = '<p class="empty-state">No test flows found. Create one to get started!</p>';
      return;
    }

    container.innerHTML = this.flows.map(flow => `
      <div class="flow-card" onclick="app.showFlowDetail('${flow.file}')">
        <div class="flow-card-header">
          <span class="flow-card-title">${flow.name}</span>
          <span class="flow-card-runner">${flow.runner}</span>
        </div>
        ${flow.description ? `<p class="flow-card-description">${flow.description}</p>` : ''}
        <div class="flow-card-meta">
          <span>${flow.stepCount} steps</span>
          <span>${flow.file}</span>
        </div>
        <div class="flow-card-actions">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); app.runFlow('${flow.path}')">
            Run
          </button>
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.editFlow('${flow.file}')">
            Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); app.deleteFlow('${flow.file}')">
            Delete
          </button>
        </div>
      </div>
    `).join('');
  }

  async loadRunnerOptions() {
    try {
      const [flows, suites] = await Promise.all([
        fetch('/api/flows').then(r => r.json()),
        fetch('/api/suites').then(r => r.json())
      ]);

      const select = document.getElementById('runner-select');
      let options = '<option value="">Select a flow or suite...</option>';

      if (suites.length > 0) {
        options += '<optgroup label="Suites">';
        suites.forEach(suite => {
          options += `<option value="suite:${suite.path}">${suite.name} (${suite.flowCount} flows)</option>`;
        });
        options += '</optgroup>';
      }

      if (flows.length > 0) {
        options += '<optgroup label="Flows">';
        flows.forEach(flow => {
          options += `<option value="flow:${flow.path}">${flow.name} (${flow.runner})</option>`;
        });
        options += '</optgroup>';
      }

      select.innerHTML = options;
    } catch (err) {
      console.error('Failed to load runner options:', err);
    }
  }

  async loadReports() {
    if (!this.currentProject) {
      this.reports = [];
      this.allReports = [];
      this.renderReports();
      return;
    }

    try {
      this.allReports = await fetch(`/api/projects/${this.currentProject}/reports`).then(r => r.json());
      this.reports = [...this.allReports];
      this.renderReports();
      this.updateReportsSummary();
    } catch (err) {
      console.error('Failed to load reports:', err);
      this.reports = [];
      this.allReports = [];
      this.renderReports();
    }
  }

  updateReportsSummary() {
    const total = this.allReports.length;
    const passed = this.allReports.filter(r => r.summary?.failed === 0).length;
    const failed = this.allReports.filter(r => r.summary?.failed > 0).length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    document.getElementById('total-reports').textContent = total;
    document.getElementById('passed-reports').textContent = passed;
    document.getElementById('failed-reports').textContent = failed;
    document.getElementById('pass-rate').textContent = `${passRate}%`;
    document.getElementById('reports-count').textContent = `${this.reports.length} reports`;
  }

  filterReports(filter) {
    if (filter === 'all') {
      this.reports = [...this.allReports];
    } else if (filter === 'passed') {
      this.reports = this.allReports.filter(r => r.summary?.failed === 0);
    } else if (filter === 'failed') {
      this.reports = this.allReports.filter(r => r.summary?.failed > 0);
    }
    this.renderReports();
    document.getElementById('reports-count').textContent = `${this.reports.length} reports`;
  }

  renderReports() {
    const container = document.getElementById('reports-list');

    if (this.reports.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="7" class="empty-cell">
            <div style="padding: 40px 20px; text-align: center;">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <p style="font-weight: 600; margin-bottom: 8px;">No reports found</p>
              <p style="color: var(--text-muted);">Run some tests to generate reports</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    container.innerHTML = this.reports.map(report => {
      const passed = report.summary?.failed === 0;
      const status = passed ? 'passed' : 'failed';
      const timestamp = new Date(report.timestamp);
      const date = timestamp.toLocaleDateString();
      const time = timestamp.toLocaleTimeString();
      const totalTests = (report.summary?.passed || 0) + (report.summary?.failed || 0);
      const duration = report.summary?.duration || report.duration || 0;
      const description = report.description || report.summary?.description || 'Test execution';
      const testName = report.name?.replace('.json', '') || 'Unknown Test';

      return `
        <tr onclick="app.viewReport('${report.name}')" style="cursor: pointer;">
          <td>
            <span class="status-badge ${status}">
              ${passed
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
              }
              ${status}
            </span>
          </td>
          <td>
            <strong>${testName}</strong>
          </td>
          <td style="color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${description}
          </td>
          <td>
            <div class="test-cases-count">
              <span class="count-passed">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                ${report.summary?.passed || 0}
              </span>
              <span class="count-failed">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                ${report.summary?.failed || 0}
              </span>
            </div>
          </td>
          <td class="duration-cell">
            ${this.formatDuration(duration)}
          </td>
          <td class="executed-cell">
            <div class="date">${date}</div>
            <div class="time">${time}</div>
          </td>
          <td>
            <div class="report-actions">
              <button class="btn-icon" onclick="event.stopPropagation(); app.viewReport('${report.name}')" title="View Details">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button class="btn-icon delete" onclick="event.stopPropagation(); app.deleteReport('${report.name}')" title="Delete">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  async viewReport(name) {
    try {
      const report = await fetch(`/api/projects/${this.currentProject}/reports/${name}`).then(r => r.json());
      this.renderReportDetail(report, name);
      document.getElementById('report-detail-modal').style.display = 'flex';
    } catch (err) {
      this.showToast('Failed to load report', 'error');
    }
  }

  renderReportDetail(report, name) {
    const container = document.getElementById('report-content');
    const title = document.getElementById('report-detail-title');
    const summary = report.summary || {};
    const total = (summary.passed || 0) + (summary.failed || 0);
    const passRate = total > 0 ? Math.round((summary.passed || 0) / total * 100) : 0;
    const timestamp = new Date(report.timestamp);

    title.textContent = name?.replace('.json', '') || 'Report Details';

    container.innerHTML = `
      <div class="report-detail-summary">
        <div class="report-detail-stat">
          <div class="stat-value">${total}</div>
          <div class="stat-label">Total Tests</div>
        </div>
        <div class="report-detail-stat passed">
          <div class="stat-value">${summary.passed || 0}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="report-detail-stat failed">
          <div class="stat-value">${summary.failed || 0}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="report-detail-stat">
          <div class="stat-value">${passRate}%</div>
          <div class="stat-label">Pass Rate</div>
        </div>
      </div>

      <div style="display: flex; gap: 24px; margin-bottom: 24px; padding: 16px; background: var(--bg-input); border-radius: var(--radius-md);">
        <div>
          <span style="color: var(--text-muted); font-size: 0.75rem;">EXECUTED</span>
          <div style="font-weight: 600;">${timestamp.toLocaleDateString()} at ${timestamp.toLocaleTimeString()}</div>
        </div>
        <div>
          <span style="color: var(--text-muted); font-size: 0.75rem;">DURATION</span>
          <div style="font-weight: 600;">${this.formatDuration(report.duration || summary.duration || 0)}</div>
        </div>
        ${report.description ? `
        <div>
          <span style="color: var(--text-muted); font-size: 0.75rem;">DESCRIPTION</span>
          <div style="font-weight: 600;">${report.description}</div>
        </div>
        ` : ''}
      </div>

      <div class="test-case-results">
        <h4>Test Cases</h4>
        ${(report.flows || report.tests || []).map((flow, index) => `
          <div class="test-case-item" onclick="this.classList.toggle('expanded')">
            <div class="test-case-header">
              <div class="test-case-info">
                <div class="test-case-status ${flow.status}">
                  ${flow.status === 'passed'
                    ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
                    : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
                  }
                </div>
                <div>
                  <div class="test-case-name">${flow.name || `Test Case ${index + 1}`}</div>
                  <div class="test-case-desc">${flow.description || ''}</div>
                </div>
              </div>
              <div class="test-case-meta">
                <span>${flow.steps?.length || 0} steps</span>
                <span>${this.formatDuration(flow.duration || 0)}</span>
              </div>
            </div>
            <div class="test-case-steps">
              ${(flow.steps || []).map((step, i) => `
                <div class="step-result ${step.status}">
                  <div class="step-result-icon">
                    ${step.status === 'passed' ? '✓' : '✗'}
                  </div>
                  <div class="step-result-info">
                    <div class="step-result-action">
                      <strong>${step.action}</strong>: ${step.description || step.selector || ''}
                    </div>
                    <div class="step-result-duration">${step.duration || 0}ms</div>
                  </div>
                </div>
                ${step.error ? `<div class="step-result-error">${step.error}</div>` : ''}
              `).join('')}
            </div>
          </div>
        `).join('')}
        ${(!report.flows && !report.tests) || (report.flows?.length === 0 && report.tests?.length === 0) ? `
          <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            No test case details available
          </div>
        ` : ''}
      </div>
    `;
  }

  closeReportDetail() {
    document.getElementById('report-detail-modal').style.display = 'none';
  }

  async deleteReport(name) {
    if (!confirm(`Delete report "${name}"?`)) return;

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/reports/${name}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        this.showToast('Report deleted', 'success');
        this.loadReports();
      } else {
        throw new Error('Failed to delete');
      }
    } catch (err) {
      this.showToast('Failed to delete report', 'error');
    }
  }

  async loadRepository() {
    try {
      const repo = await fetch('/api/repository').then(r => r.json());
      const yaml = this.objectToYaml(repo);
      document.getElementById('repository-content').value = yaml;
    } catch (err) {
      console.error('Failed to load repository:', err);
    }
  }

  async saveRepository() {
    try {
      const content = document.getElementById('repository-content').value;
      // Simple YAML to object conversion (basic)
      const data = this.yamlToObject(content);

      await fetch('/api/repository', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      this.showToast('Repository saved', 'success');
    } catch (err) {
      this.showToast('Failed to save repository', 'error');
    }
  }

  async loadEditorOptions() {
    try {
      const flows = await fetch('/api/flows').then(r => r.json());
      const select = document.getElementById('editor-select');

      let options = '<option value="">Select a flow to edit...</option>';
      flows.forEach(flow => {
        options += `<option value="${flow.file}">${flow.name} (${flow.file})</option>`;
      });

      select.innerHTML = options;
    } catch (err) {
      console.error('Failed to load editor options:', err);
    }
  }

  async loadFlowForEdit() {
    const select = document.getElementById('editor-select');
    const flowFile = select.value;

    if (!flowFile) {
      document.getElementById('flow-editor').value = '';
      document.getElementById('flow-preview').innerHTML = '';
      return;
    }

    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/flows/${flowFile}`);
      if (!response.ok) {
        throw new Error('Flow not found');
      }
      const flow = await response.json();
      document.getElementById('flow-editor').value = flow.content;
      this.updateFlowPreview(flow.parsed);
    } catch (err) {
      this.showToast('Failed to load flow', 'error');
      console.error('Error loading flow:', err);
    }
  }

  updateFlowPreview(flow) {
    if (!flow) {
      document.getElementById('flow-preview').innerHTML = '';
      return;
    }

    const preview = document.getElementById('flow-preview');
    preview.innerHTML = `
      <div style="margin-bottom: 16px;">
        <h4 style="margin-bottom: 8px;">${flow.name || 'Unnamed Flow'}</h4>
        <p style="color: var(--text-secondary); font-size: 0.875rem;">${flow.description || 'No description'}</p>
        <span class="flow-card-runner" style="margin-top: 8px; display: inline-block;">
          ${flow.runner || 'web'}
        </span>
      </div>
      <div>
        <h5 style="margin-bottom: 8px;">Steps (${flow.steps?.length || 0})</h5>
        ${(flow.steps || []).map((step, i) => `
          <div style="padding: 8px 12px; background: var(--bg-tertiary); border-radius: 4px; margin-bottom: 4px; font-size: 0.875rem;">
            <strong>${i + 1}.</strong> ${step.action}
            ${step.description ? `<span style="color: var(--text-muted);"> - ${step.description}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  async saveFlow() {
    const select = document.getElementById('editor-select');
    const flowFile = select.value;
    const content = document.getElementById('flow-editor').value;

    if (!flowFile) {
      this.showToast('Select a flow to save', 'error');
      return;
    }

    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/flows/${flowFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        throw new Error('Failed to save');
      }

      this.showToast('Flow saved', 'success');
      this.loadFlows();

      // Update preview
      try {
        const parsed = this.yamlToObject(content);
        this.updateFlowPreview(parsed);
      } catch (e) {
        // Invalid YAML, skip preview update
      }
    } catch (err) {
      this.showToast('Failed to save flow', 'error');
    }
  }

  async loadSettings() {
    try {
      const project = await fetch('/api/project').then(r => r.json());
      document.getElementById('setting-project-path').value = project.path;
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  // ==========================================
  // Visual Flow Editor
  // ==========================================

  editorMode = 'visual';
  editorSteps = [];
  editorStepId = 0;
  editingStepIndex = -1;

  // Action icons mapping
  actionIcons = {
    goto: '🌐',
    click: '👆',
    fill: '✏️',
    select: '📋',
    hover: '🖱️',
    expectVisible: '👁️',
    expectText: '📝',
    wait: '⏱️',
    screenshot: '📷',
    waitForLoadState: '⏳',
    scroll: '📜',
    check: '☑️',
    uncheck: '⬜',
    press: '⌨️',
    request: '🔗'
  };

  // Action labels
  actionLabels = {
    goto: 'Go to URL',
    click: 'Click Element',
    fill: 'Fill Input',
    select: 'Select Option',
    hover: 'Hover Element',
    expectVisible: 'Check Visible',
    expectText: 'Check Text',
    wait: 'Wait',
    screenshot: 'Take Screenshot',
    waitForLoadState: 'Wait for Load',
    scroll: 'Scroll',
    check: 'Check Checkbox',
    uncheck: 'Uncheck',
    press: 'Press Key',
    request: 'HTTP Request'
  };

  setEditorMode(mode) {
    this.editorMode = mode;

    document.getElementById('btn-visual-mode').classList.toggle('active', mode === 'visual');
    document.getElementById('btn-yaml-mode').classList.toggle('active', mode === 'yaml');
    document.getElementById('editor-visual-mode').style.display = mode === 'visual' ? 'block' : 'none';
    document.getElementById('editor-yaml-mode').style.display = mode === 'yaml' ? 'block' : 'none';

    if (mode === 'yaml') {
      this.editorUpdateYaml();
    } else {
      this.editorParseYaml();
    }
  }

  editorParseYaml() {
    const yamlContent = document.getElementById('flow-editor').value;
    if (!yamlContent.trim()) {
      this.editorSteps = [];
      this.editorRenderSteps();
      return;
    }

    try {
      const parsed = this.yamlToObject(yamlContent);

      document.getElementById('editor-flow-name').value = parsed.name || '';
      document.getElementById('editor-flow-desc').value = parsed.description || '';
      document.getElementById('editor-flow-runner').value = parsed.runner || 'web';

      this.editorSteps = (parsed.steps || []).map((step, index) => ({
        id: ++this.editorStepId,
        action: step.action || 'click',
        ...step
      }));

      this.editorRenderSteps();
    } catch (err) {
      console.error('Failed to parse YAML:', err);
      this.showToast('Invalid YAML format', 'error');
    }
  }

  editorUpdateYaml() {
    const name = document.getElementById('editor-flow-name').value || 'Untitled Flow';
    const desc = document.getElementById('editor-flow-desc').value;
    const runner = document.getElementById('editor-flow-runner').value;

    let yaml = `# ${name}\n`;
    yaml += `# ${'='.repeat(name.length)}\n\n`;
    yaml += `name: ${name}\n`;
    if (desc) yaml += `description: ${desc}\n`;
    yaml += `runner: ${runner}\n\n`;
    yaml += `steps:\n`;

    if (this.editorSteps.length === 0) {
      yaml += `  # Add steps using the visual editor\n`;
    } else {
      this.editorSteps.forEach(step => {
        yaml += `  - action: ${step.action}\n`;

        if (step.description) yaml += `    description: "${step.description}"\n`;
        if (step.url) yaml += `    url: "${step.url}"\n`;
        if (step.selector) yaml += `    selector: "${step.selector}"\n`;
        if (step.value) yaml += `    value: "${step.value}"\n`;
        if (step.text) yaml += `    text: "${step.text}"\n`;
        if (step.duration) yaml += `    duration: ${step.duration}\n`;
        if (step.name) yaml += `    name: "${step.name}"\n`;
        if (step.state) yaml += `    state: "${step.state}"\n`;
        if (step.waitUntil) yaml += `    waitUntil: "${step.waitUntil}"\n`;
        if (step.fullPage !== undefined) yaml += `    fullPage: ${step.fullPage}\n`;
        yaml += `\n`;
      });
    }

    document.getElementById('flow-editor').value = yaml;
    this.updateFlowPreview(this.yamlToObject(yaml));
  }

  editorRenderSteps() {
    const container = document.getElementById('editor-steps-list');
    const emptyState = document.getElementById('editor-empty-steps');
    const countEl = document.getElementById('editor-steps-count');

    countEl.textContent = `(${this.editorSteps.length} steps)`;

    if (this.editorSteps.length === 0) {
      container.innerHTML = '';
      if (emptyState) {
        emptyState.style.display = 'block';
        container.appendChild(emptyState);
      }
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = this.editorSteps.map((step, index) => {
      const icon = this.actionIcons[step.action] || '⚡';
      const label = this.actionLabels[step.action] || step.action;
      const desc = step.description || this.getStepSummary(step);

      return `
        <div class="editor-step-item" data-index="${index}" draggable="true"
             ondragstart="app.editorDragStart(event, ${index})"
             ondragover="app.editorDragOver(event)"
             ondrop="app.editorDrop(event, ${index})">
          <div class="editor-step-header">
            <div class="editor-step-drag" title="Drag to reorder">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"></circle>
                <circle cx="15" cy="6" r="1.5"></circle>
                <circle cx="9" cy="12" r="1.5"></circle>
                <circle cx="15" cy="12" r="1.5"></circle>
                <circle cx="9" cy="18" r="1.5"></circle>
                <circle cx="15" cy="18" r="1.5"></circle>
              </svg>
            </div>
            <div class="editor-step-number">${index + 1}</div>
            <div class="editor-step-info">
              <div class="editor-step-action">
                <span class="action-icon">${icon}</span>
                ${label}
              </div>
              <div class="editor-step-desc">${desc}</div>
            </div>
            <div class="editor-step-actions">
              <button class="edit" onclick="app.editorEditStep(${index})" title="Edit">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button onclick="app.editorMoveStep(${index}, -1)" title="Move Up">↑</button>
              <button onclick="app.editorMoveStep(${index}, 1)" title="Move Down">↓</button>
              <button class="delete" onclick="app.editorDeleteStep(${index})" title="Delete">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  getStepSummary(step) {
    switch (step.action) {
      case 'goto': return step.url || 'Navigate to URL';
      case 'click': return step.selector || 'Click element';
      case 'fill': return step.selector ? `${step.selector} = "${step.value || ''}"` : 'Fill input';
      case 'select': return step.selector ? `${step.selector} → ${step.value || ''}` : 'Select option';
      case 'hover': return step.selector || 'Hover element';
      case 'expectVisible': return step.selector || 'Check element visible';
      case 'expectText': return step.text ? `"${step.text}"` : 'Check text content';
      case 'wait': return step.duration ? `${step.duration}ms` : 'Wait';
      case 'screenshot': return step.name || 'Capture screenshot';
      case 'waitForLoadState': return step.state || 'Wait for page load';
      default: return step.selector || step.value || '';
    }
  }

  editorQuickAdd(action) {
    const step = {
      id: ++this.editorStepId,
      action: action
    };

    // Set defaults based on action
    switch (action) {
      case 'goto':
        step.url = 'https://';
        step.waitUntil = 'load';
        break;
      case 'wait':
        step.duration = 1000;
        break;
      case 'waitForLoadState':
        step.state = 'load';
        break;
      case 'screenshot':
        step.name = 'screenshot';
        step.fullPage = false;
        break;
    }

    this.editorSteps.push(step);
    this.editorRenderSteps();
    this.editorUpdateYaml();
    this.showToast(`Added: ${this.actionLabels[action] || action}`, 'success');
  }

  editorAddStep() {
    this.editingStepIndex = -1;
    this.showStepEditModal(null);
  }

  editorEditStep(index) {
    this.editingStepIndex = index;
    this.showStepEditModal(this.editorSteps[index]);
  }

  showStepEditModal(step) {
    const modal = document.getElementById('step-edit-modal');
    const title = document.getElementById('step-edit-title');
    const content = document.getElementById('step-edit-content');

    title.textContent = step ? 'Edit Step' : 'Add New Step';

    const currentAction = step?.action || 'click';

    content.innerHTML = `
      <div class="form-row">
        <label>Action Type *</label>
        <select id="step-edit-action" onchange="app.updateStepEditFields()">
          <option value="goto" ${currentAction === 'goto' ? 'selected' : ''}>🌐 Go to URL</option>
          <option value="click" ${currentAction === 'click' ? 'selected' : ''}>👆 Click Element</option>
          <option value="fill" ${currentAction === 'fill' ? 'selected' : ''}>✏️ Fill Input</option>
          <option value="select" ${currentAction === 'select' ? 'selected' : ''}>📋 Select Option</option>
          <option value="hover" ${currentAction === 'hover' ? 'selected' : ''}>🖱️ Hover Element</option>
          <option value="expectVisible" ${currentAction === 'expectVisible' ? 'selected' : ''}>👁️ Check Visible</option>
          <option value="expectText" ${currentAction === 'expectText' ? 'selected' : ''}>📝 Check Text</option>
          <option value="wait" ${currentAction === 'wait' ? 'selected' : ''}>⏱️ Wait</option>
          <option value="screenshot" ${currentAction === 'screenshot' ? 'selected' : ''}>📷 Screenshot</option>
          <option value="waitForLoadState" ${currentAction === 'waitForLoadState' ? 'selected' : ''}>⏳ Wait for Load</option>
        </select>
      </div>
      <div id="step-edit-fields"></div>
      <div class="form-row">
        <label>Description (optional)</label>
        <input type="text" id="step-edit-description" value="${step?.description || ''}" placeholder="Describe what this step does">
      </div>
    `;

    this.currentEditStep = step;
    this.updateStepEditFields();
    modal.style.display = 'flex';
  }

  updateStepEditFields() {
    const action = document.getElementById('step-edit-action').value;
    const container = document.getElementById('step-edit-fields');
    const step = this.currentEditStep || {};

    let fields = '';

    switch (action) {
      case 'goto':
        fields = `
          <div class="form-row">
            <label>URL *</label>
            <input type="text" id="step-edit-url" value="${step.url || ''}" placeholder="https://www.example.com">
          </div>
          <div class="form-row">
            <label>Wait Until</label>
            <select id="step-edit-waitUntil">
              <option value="load" ${step.waitUntil === 'load' ? 'selected' : ''}>Page Loaded</option>
              <option value="domcontentloaded" ${step.waitUntil === 'domcontentloaded' ? 'selected' : ''}>DOM Ready</option>
              <option value="networkidle" ${step.waitUntil === 'networkidle' ? 'selected' : ''}>Network Idle</option>
            </select>
          </div>
        `;
        break;

      case 'click':
      case 'hover':
      case 'expectVisible':
        fields = `
          <div class="form-row">
            <label>Element Selector *</label>
            <input type="text" id="step-edit-selector" value="${step.selector || ''}" placeholder="button, #submit, .login-btn">
            <div class="form-hint">CSS selector, button text, or element ID</div>
          </div>
        `;
        break;

      case 'fill':
        fields = `
          <div class="form-row">
            <label>Input Selector *</label>
            <input type="text" id="step-edit-selector" value="${step.selector || ''}" placeholder="#email, input[name='username']">
          </div>
          <div class="form-row">
            <label>Value to Enter *</label>
            <input type="text" id="step-edit-value" value="${step.value || ''}" placeholder="test@example.com">
          </div>
        `;
        break;

      case 'select':
        fields = `
          <div class="form-row">
            <label>Dropdown Selector *</label>
            <input type="text" id="step-edit-selector" value="${step.selector || ''}" placeholder="select#country, .dropdown">
          </div>
          <div class="form-row">
            <label>Option to Select *</label>
            <input type="text" id="step-edit-value" value="${step.value || ''}" placeholder="United States">
          </div>
        `;
        break;

      case 'expectText':
        fields = `
          <div class="form-row">
            <label>Element Selector *</label>
            <input type="text" id="step-edit-selector" value="${step.selector || ''}" placeholder="h1, .title, #message">
          </div>
          <div class="form-row">
            <label>Expected Text *</label>
            <input type="text" id="step-edit-text" value="${step.text || ''}" placeholder="Welcome!">
          </div>
        `;
        break;

      case 'wait':
        fields = `
          <div class="form-row">
            <label>Duration (milliseconds) *</label>
            <input type="number" id="step-edit-duration" value="${step.duration || 1000}" placeholder="1000">
            <div class="form-hint">1000 = 1 second, 2000 = 2 seconds</div>
          </div>
        `;
        break;

      case 'screenshot':
        fields = `
          <div class="form-row">
            <label>Screenshot Name *</label>
            <input type="text" id="step-edit-name" value="${step.name || ''}" placeholder="homepage">
          </div>
          <div class="form-row">
            <label>Full Page?</label>
            <select id="step-edit-fullPage">
              <option value="false" ${!step.fullPage ? 'selected' : ''}>No - Visible area only</option>
              <option value="true" ${step.fullPage ? 'selected' : ''}>Yes - Capture full page</option>
            </select>
          </div>
        `;
        break;

      case 'waitForLoadState':
        fields = `
          <div class="form-row">
            <label>Wait For</label>
            <select id="step-edit-state">
              <option value="load" ${step.state === 'load' ? 'selected' : ''}>Page Loaded</option>
              <option value="domcontentloaded" ${step.state === 'domcontentloaded' ? 'selected' : ''}>DOM Ready</option>
              <option value="networkidle" ${step.state === 'networkidle' ? 'selected' : ''}>Network Idle</option>
            </select>
          </div>
        `;
        break;
    }

    container.innerHTML = fields;
  }

  saveStepEdit() {
    const action = document.getElementById('step-edit-action').value;
    const description = document.getElementById('step-edit-description').value;

    const step = {
      id: this.editingStepIndex >= 0 ? this.editorSteps[this.editingStepIndex].id : ++this.editorStepId,
      action: action,
      description: description || undefined
    };

    // Collect field values based on action
    const getVal = (id) => document.getElementById(id)?.value;

    switch (action) {
      case 'goto':
        step.url = getVal('step-edit-url');
        step.waitUntil = getVal('step-edit-waitUntil');
        if (!step.url) {
          this.showToast('URL is required', 'error');
          return;
        }
        break;

      case 'click':
      case 'hover':
      case 'expectVisible':
        step.selector = getVal('step-edit-selector');
        if (!step.selector) {
          this.showToast('Selector is required', 'error');
          return;
        }
        break;

      case 'fill':
      case 'select':
        step.selector = getVal('step-edit-selector');
        step.value = getVal('step-edit-value');
        if (!step.selector || !step.value) {
          this.showToast('Selector and value are required', 'error');
          return;
        }
        break;

      case 'expectText':
        step.selector = getVal('step-edit-selector');
        step.text = getVal('step-edit-text');
        if (!step.selector || !step.text) {
          this.showToast('Selector and text are required', 'error');
          return;
        }
        break;

      case 'wait':
        step.duration = parseInt(getVal('step-edit-duration')) || 1000;
        break;

      case 'screenshot':
        step.name = getVal('step-edit-name');
        step.fullPage = getVal('step-edit-fullPage') === 'true';
        if (!step.name) {
          this.showToast('Screenshot name is required', 'error');
          return;
        }
        break;

      case 'waitForLoadState':
        step.state = getVal('step-edit-state');
        break;
    }

    if (this.editingStepIndex >= 0) {
      this.editorSteps[this.editingStepIndex] = step;
      this.showToast('Step updated', 'success');
    } else {
      this.editorSteps.push(step);
      this.showToast(`Added: ${this.actionLabels[action]}`, 'success');
    }

    this.closeStepEditModal();
    this.editorRenderSteps();
    this.editorUpdateYaml();
  }

  closeStepEditModal() {
    document.getElementById('step-edit-modal').style.display = 'none';
    this.currentEditStep = null;
    this.editingStepIndex = -1;
  }

  editorMoveStep(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.editorSteps.length) return;

    const temp = this.editorSteps[index];
    this.editorSteps[index] = this.editorSteps[newIndex];
    this.editorSteps[newIndex] = temp;

    this.editorRenderSteps();
    this.editorUpdateYaml();
  }

  editorDeleteStep(index) {
    if (!confirm('Delete this step?')) return;

    this.editorSteps.splice(index, 1);
    this.editorRenderSteps();
    this.editorUpdateYaml();
    this.showToast('Step deleted', 'info');
  }

  // Drag and drop
  editorDragStart(event, index) {
    event.dataTransfer.setData('text/plain', index);
    event.target.classList.add('dragging');
  }

  editorDragOver(event) {
    event.preventDefault();
  }

  editorDrop(event, targetIndex) {
    event.preventDefault();
    const sourceIndex = parseInt(event.dataTransfer.getData('text/plain'));

    if (sourceIndex === targetIndex) return;

    const step = this.editorSteps.splice(sourceIndex, 1)[0];
    this.editorSteps.splice(targetIndex, 0, step);

    this.editorRenderSteps();
    this.editorUpdateYaml();
  }

  // Actions
  runFlow(flowPath) {
    if (this.isRunning) {
      this.showToast('A test is already running', 'error');
      return;
    }

    this.showView('runner');
    this.clearLog();
    this.socket.emit('run:flow', { flowPath });
  }

  runSuite(suitePath) {
    if (this.isRunning) {
      this.showToast('A test is already running', 'error');
      return;
    }

    this.showView('runner');
    this.clearLog();
    this.socket.emit('run:suite', { suitePath });
  }

  runSelected() {
    const select = document.getElementById('runner-select');
    const value = select.value;

    if (!value) {
      this.showToast('Select a flow or suite to run', 'error');
      return;
    }

    const [type, path] = value.split(':');
    if (type === 'suite') {
      this.runSuite(path);
    } else {
      this.runFlow(path);
    }
  }

  runAllTests() {
    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    // Try to find and run the main suite
    fetch(`/api/projects/${this.currentProject}/suites`)
      .then(r => r.json())
      .then(suites => {
        if (suites.length > 0) {
          this.runSuite(suites[0].path);
        } else {
          this.showToast('No test suite found', 'error');
        }
      });
  }

  editFlow(flowFile) {
    this.showView('editor');
    setTimeout(() => {
      document.getElementById('editor-select').value = flowFile;
      this.loadFlowForEdit();
    }, 100);
  }

  async deleteFlow(flowFile) {
    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${flowFile}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/flows/${flowFile}`, { method: 'DELETE' });
      if (response.ok) {
        this.showToast('Flow deleted', 'success');
        this.loadFlows();
        this.loadDashboard();
      } else {
        const result = await response.json();
        this.showToast(result.error || 'Failed to delete flow', 'error');
      }
    } catch (err) {
      this.showToast('Failed to delete flow', 'error');
    }
  }

  showFlowDetail(flowFile) {
    this.editFlow(flowFile);
  }

  // Modal
  showNewFlowModal() {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('new-flow-name').value = '';
    document.getElementById('new-flow-description').value = '';
  }

  closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
  }

  async createNewFlow() {
    const name = document.getElementById('new-flow-name').value.trim();
    const runner = document.getElementById('new-flow-runner').value;
    const description = document.getElementById('new-flow-description').value.trim();

    if (!name) {
      this.showToast('Flow name is required', 'error');
      return;
    }

    const content = `# ${name}
# ${'='.repeat(name.length)}

name: ${name}
description: ${description || 'Test flow'}
runner: ${runner}

steps:
  # Add your test steps here
  - action: ${runner === 'api' ? 'request' : 'goto'}
    ${runner === 'api' ? 'method: GET\n    url: https://example.com/api' : 'url: https://example.com'}
    description: First step
`;

    try {
      await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content })
      });

      this.showToast('Flow created', 'success');
      this.closeModal();
      this.loadFlows();
      this.editFlow(`${name}.yaml`);
    } catch (err) {
      this.showToast('Failed to create flow', 'error');
    }
  }

  // Logging
  log(type, message) {
    const container = document.getElementById('execution-log');
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  clearLog() {
    const container = document.getElementById('execution-log');
    container.innerHTML = '<p class="log-entry info">Ready to run tests...</p>';
    document.getElementById('step-results').innerHTML = '';
    this.totalSteps = 0;
    this.completedSteps = 0;
    this.updateProgress();
  }

  // Progress
  updateProgress() {
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    const status = document.getElementById('progress-status');

    const percent = this.totalSteps > 0 ? (this.completedSteps / this.totalSteps) * 100 : 0;
    fill.style.width = `${percent}%`;
    text.textContent = `${this.completedSteps} / ${this.totalSteps} steps`;
    status.textContent = this.isRunning ? 'Running' : 'Idle';
  }

  addStepResult(index, action, description, status) {
    const container = document.getElementById('step-results');
    const existing = document.getElementById(`step-${index}`);

    if (existing) {
      existing.className = `step-result ${status}`;
      return;
    }

    const div = document.createElement('div');
    div.id = `step-${index}`;
    div.className = `step-result ${status}`;
    div.innerHTML = `
      <span class="step-result-icon">${status === 'running' ? '⋯' : status === 'passed' ? '✓' : '✗'}</span>
      <div class="step-result-info">
        <div class="step-result-action">${action}: ${description || ''}</div>
        <div class="step-result-duration">-</div>
      </div>
    `;
    container.appendChild(div);
  }

  updateStepResult(index, status, duration) {
    const div = document.getElementById(`step-${index}`);
    if (div) {
      div.className = `step-result ${status}`;
      div.querySelector('.step-result-icon').textContent = status === 'passed' ? '✓' : '✗';
      div.querySelector('.step-result-duration').textContent = `${duration}ms`;
    }
  }

  updateRunButton() {
    const btn = document.getElementById('run-btn');
    if (this.isRunning) {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Running...
      `;
      btn.disabled = true;
    } else {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Run
      `;
      btn.disabled = false;
    }
  }

  // Toast
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // Utilities
  objectToYaml(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    let result = '';

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;

      if (typeof value === 'object' && !Array.isArray(value)) {
        result += `${spaces}${key}:\n`;
        result += this.objectToYaml(value, indent + 1);
      } else if (Array.isArray(value)) {
        result += `${spaces}${key}:\n`;
        value.forEach(item => {
          if (typeof item === 'object') {
            result += `${spaces}  -\n`;
            result += this.objectToYaml(item, indent + 2);
          } else {
            result += `${spaces}  - ${item}\n`;
          }
        });
      } else {
        result += `${spaces}${key}: ${value}\n`;
      }
    }

    return result;
  }

  yamlToObject(yaml) {
    // Basic YAML parser (for simple structures)
    const lines = yaml.split('\n');
    const result = {};
    let currentKey = null;
    let currentIndent = 0;

    for (const line of lines) {
      if (line.trim().startsWith('#') || !line.trim()) continue;

      const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
      if (match) {
        const [, indent, key, value] = match;
        if (value) {
          result[key.trim()] = value.trim();
        } else {
          result[key.trim()] = {};
          currentKey = key.trim();
        }
      }
    }

    return result;
  }

  // ==========================================
  // Project Management
  // ==========================================

  async loadProjects() {
    try {
      this.projects = await fetch('/api/projects').then(r => r.json());

      // Update project dropdown
      const select = document.getElementById('project-select');
      select.innerHTML = '<option value="">Select a project...</option>';

      // Add existing projects
      this.projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.name;
        option.textContent = project.displayName;
        if (this.currentProject === project.name) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      // Add separator and "Create New Project" option
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.textContent = '──────────────';
      select.appendChild(separator);

      const createOption = document.createElement('option');
      createOption.value = '__create__';
      createOption.textContent = '+ Create New Project';
      createOption.style.fontWeight = 'bold';
      select.appendChild(createOption);

      // Auto-select first project if none selected
      if (!this.currentProject && this.projects.length > 0) {
        this.currentProject = this.projects[0].name;
        select.value = this.currentProject;
      }

      // Render projects grid (if view exists)
      if (document.getElementById('projects-grid')) {
        this.renderProjects();
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }

  renderProjects() {
    const container = document.getElementById('projects-list');
    if (!container) return;

    if (this.projects.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 60px 20px; grid-column: 1 / -1;">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; color: var(--text-muted);">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <h3 style="margin-bottom: 8px;">No Projects Yet</h3>
          <p style="color: var(--text-muted); margin-bottom: 20px;">Create your first project to get started</p>
          <button class="btn btn-primary" onclick="app.showNewProjectModal()">Create Project</button>
        </div>
      `;
      return;
    }

    container.innerHTML = this.projects.map(project => `
      <div class="project-card" onclick="app.selectProject('${project.name}')">
        <div class="project-card-header">
          <div class="project-card-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="project-card-title">
            <h3>${project.displayName}</h3>
            <span class="url">${project.baseUrl || 'No URL set'}</span>
          </div>
        </div>
        <p class="project-card-desc">${project.description || 'No description'}</p>
        <div class="project-card-stats">
          <div class="project-card-stat">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            </svg>
            <strong>${project.flowCount}</strong> flows
          </div>
        </div>
        <div class="project-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-sm btn-secondary" onclick="app.selectProject('${project.name}')">Open</button>
          <a href="/builder.html?project=${project.name}" class="btn btn-sm btn-primary">Record Test</a>
          <button class="btn btn-sm btn-danger" onclick="app.deleteProject('${project.name}')" style="margin-left: auto;">Delete</button>
        </div>
      </div>
    `).join('');
  }

  selectProject(projectName) {
    this.currentProject = projectName;
    document.getElementById('project-select').value = projectName;

    // Update dashboard title
    const project = this.projects.find(p => p.name === projectName);
    if (project) {
      this.showToast(`Switched to ${project.displayName}`, 'success');
    }

    // Reload data for new project
    this.loadDashboard();
    this.loadFlows();
    this.loadReports();

    // Go to dashboard
    this.showView('dashboard');
  }

  switchProject(projectName) {
    if (projectName === '__create__') {
      // Reset dropdown to current project
      const dropdown = document.getElementById('project-select');
      dropdown.value = this.currentProject || '';
      // Show create project modal
      this.showNewProjectModal();
      return;
    }
    if (projectName) {
      this.selectProject(projectName);
    }
  }

  showNewProjectModal() {
    document.getElementById('project-modal-overlay').style.display = 'flex';
    document.getElementById('new-project-name').value = '';
    document.getElementById('new-project-url').value = '';
    document.getElementById('new-project-description').value = '';
  }

  closeProjectModal() {
    document.getElementById('project-modal-overlay').style.display = 'none';
  }

  async createNewProject() {
    const name = document.getElementById('new-project-name').value.trim();
    const baseUrl = document.getElementById('new-project-url').value.trim();
    const description = document.getElementById('new-project-description').value.trim();

    if (!name) {
      this.showToast('Project name is required', 'error');
      return;
    }

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, baseUrl, description })
      });

      const result = await response.json();

      if (result.success) {
        this.showToast(`Project "${name}" created!`, 'success');
        this.closeProjectModal();
        this.currentProject = result.project.name;
        await this.loadProjects();
        this.selectProject(result.project.name);
      } else {
        this.showToast(result.error || 'Failed to create project', 'error');
      }
    } catch (err) {
      this.showToast('Failed to create project', 'error');
    }
  }

  async deleteProject(projectName) {
    const project = this.projects.find(p => p.name === projectName);
    if (!confirm(`Are you sure you want to delete "${project?.displayName || projectName}"?\n\nThis will delete all flows and reports.`)) {
      return;
    }

    try {
      await fetch(`/api/projects/${projectName}`, { method: 'DELETE' });
      this.showToast('Project deleted', 'success');

      // If deleted current project, switch to another
      if (this.currentProject === projectName) {
        this.currentProject = null;
      }

      await this.loadProjects();

      // Switch to first available project
      if (this.projects.length > 0 && !this.currentProject) {
        this.selectProject(this.projects[0].name);
      }
    } catch (err) {
      this.showToast('Failed to delete project', 'error');
    }
  }

  // ==========================================
  // Excel Import
  // ==========================================

  showImportModal() {
    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    // Reset modal state
    document.getElementById('import-modal-overlay').style.display = 'flex';
    document.getElementById('file-upload-area').style.display = 'block';
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('import-results').style.display = 'none';
    document.getElementById('import-btn').disabled = true;
    document.getElementById('excel-file-input').value = '';
    this.selectedFile = null;

    // Setup drag and drop
    const uploadArea = document.getElementById('file-upload-area');
    uploadArea.ondragover = (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    };
    uploadArea.ondragleave = () => {
      uploadArea.classList.remove('dragover');
    };
    uploadArea.ondrop = (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0 && (files[0].name.endsWith('.xlsx') || files[0].name.endsWith('.xls'))) {
        this.selectedFile = files[0];
        this.showSelectedFile(files[0]);
      } else {
        this.showToast('Please select a valid Excel file (.xlsx)', 'error');
      }
    };
  }

  closeImportModal() {
    document.getElementById('import-modal-overlay').style.display = 'none';
    this.selectedFile = null;
  }

  handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.showSelectedFile(file);
    }
  }

  showSelectedFile(file) {
    document.getElementById('file-upload-area').style.display = 'none';
    document.getElementById('import-preview').style.display = 'block';
    document.getElementById('selected-file-name').textContent = file.name;
    document.getElementById('import-btn').disabled = false;
  }

  clearFileSelection() {
    this.selectedFile = null;
    document.getElementById('excel-file-input').value = '';
    document.getElementById('file-upload-area').style.display = 'block';
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('import-btn').disabled = true;
  }

  async importExcel() {
    if (!this.selectedFile || !this.currentProject) {
      this.showToast('Please select a file', 'error');
      return;
    }

    // Show progress
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('import-progress').style.display = 'block';
    document.getElementById('import-btn').disabled = true;
    document.getElementById('import-progress-fill').style.width = '30%';
    document.getElementById('import-status').textContent = 'Uploading file...';

    try {
      const formData = new FormData();
      formData.append('file', this.selectedFile);

      document.getElementById('import-progress-fill').style.width = '60%';
      document.getElementById('import-status').textContent = 'Processing test cases...';

      const response = await fetch(`/api/projects/${this.currentProject}/import`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      document.getElementById('import-progress-fill').style.width = '100%';

      if (response.ok) {
        // Show results
        document.getElementById('import-progress').style.display = 'none';
        document.getElementById('import-results').style.display = 'block';
        document.getElementById('import-success-count').textContent = result.imported || 0;
        document.getElementById('import-error-count').textContent = result.errors?.length || 0;

        if (result.errors && result.errors.length > 0) {
          document.getElementById('import-error-list').style.display = 'block';
          document.getElementById('import-errors').innerHTML = result.errors
            .map(e => `<div style="padding: 4px 0;">${e}</div>`)
            .join('');
        } else {
          document.getElementById('import-error-list').style.display = 'none';
        }

        this.showToast(`Successfully imported ${result.imported} test case(s)`, 'success');

        // Reload flows
        this.loadFlows();
        this.loadDashboard();

        // Auto-close after 2 seconds if no errors
        if (!result.errors || result.errors.length === 0) {
          setTimeout(() => {
            this.closeImportModal();
          }, 2000);
        }
      } else {
        throw new Error(result.error || 'Import failed');
      }
    } catch (err) {
      document.getElementById('import-progress').style.display = 'none';
      document.getElementById('import-preview').style.display = 'block';
      document.getElementById('import-btn').disabled = false;
      this.showToast(`Import failed: ${err.message}`, 'error');
    }
  }

  // ==========================================
  // Visual Builder
  // ==========================================

  builderSteps = [];
  builderStepId = 0;
  builderIsRecording = false;
  builderRecordedActions = [];

  // Action configurations
  builderActionConfigs = {
    goto: {
      label: 'Go to URL',
      icon: '1',
      fields: [
        { name: 'url', label: 'URL', type: 'text', placeholder: 'https://www.example.com', required: true, hint: 'The web address to navigate to' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Navigate to homepage', hint: 'Describe what this step does' }
      ]
    },
    waitForLoadState: {
      label: 'Wait for Page Load',
      icon: '2',
      fields: [
        { name: 'state', label: 'Wait Until', type: 'select', options: [
          { value: 'load', label: 'Page Loaded' },
          { value: 'domcontentloaded', label: 'DOM Ready' },
          { value: 'networkidle', label: 'Network Idle (slowest but safest)' }
        ], hint: 'When to consider the page loaded' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Wait for page to load' }
      ]
    },
    click: {
      label: 'Click Element',
      icon: '3',
      fields: [
        { name: 'selector', label: 'Element to Click', type: 'text', placeholder: 'button, #submit-btn, .login-button', required: true, hint: 'CSS selector, button text, or element ID' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Click login button' }
      ]
    },
    fill: {
      label: 'Fill Text Field',
      icon: '4',
      fields: [
        { name: 'selector', label: 'Input Field', type: 'text', placeholder: '#email, input[name="username"]', required: true, hint: 'The input field to fill' },
        { name: 'value', label: 'Text to Enter', type: 'text', placeholder: 'test@example.com', required: true, hint: 'The text to type in the field' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Enter email address' }
      ]
    },
    select: {
      label: 'Select Dropdown',
      icon: '5',
      fields: [
        { name: 'selector', label: 'Dropdown Element', type: 'text', placeholder: '#country, select[name="state"]', required: true },
        { name: 'value', label: 'Option to Select', type: 'text', placeholder: 'United States', required: true, hint: 'The option value or text' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Select country' }
      ]
    },
    hover: {
      label: 'Hover Over Element',
      icon: '6',
      fields: [
        { name: 'selector', label: 'Element to Hover', type: 'text', placeholder: '.menu-item, #dropdown-trigger', required: true },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Hover over menu' }
      ]
    },
    expectVisible: {
      label: 'Check Element Visible',
      icon: '7',
      fields: [
        { name: 'selector', label: 'Element to Check', type: 'text', placeholder: '.success-message, #welcome-banner', required: true, hint: 'Verify this element is visible on page' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Verify success message appears' }
      ]
    },
    expectText: {
      label: 'Check Text Content',
      icon: '8',
      fields: [
        { name: 'selector', label: 'Element to Check', type: 'text', placeholder: 'h1, .title, #message', required: true },
        { name: 'text', label: 'Expected Text', type: 'text', placeholder: 'Welcome!', required: true, hint: 'The text that should be in the element' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Verify welcome message' }
      ]
    },
    wait: {
      label: 'Wait (Pause)',
      icon: '9',
      fields: [
        { name: 'duration', label: 'Wait Time (milliseconds)', type: 'number', placeholder: '1000', required: true, hint: '1000 = 1 second, 2000 = 2 seconds' },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Wait for animation' }
      ]
    },
    screenshot: {
      label: 'Take Screenshot',
      icon: '10',
      fields: [
        { name: 'name', label: 'Screenshot Name', type: 'text', placeholder: 'homepage', required: true, hint: 'Name for the screenshot file' },
        { name: 'fullPage', label: 'Capture Full Page?', type: 'select', options: [
          { value: 'true', label: 'Yes - Capture entire page' },
          { value: 'false', label: 'No - Only visible area' }
        ] },
        { name: 'description', label: 'Description', type: 'text', placeholder: 'Capture homepage screenshot' }
      ]
    }
  };

  initBuilder() {
    this.builderSteps = [];
    this.builderStepId = 0;
    this.builderRenderSteps();
    this.builderUpdatePreview();
    this.builderUpdateStepCount();
  }

  builderAddStep(action, values = {}) {
    const config = this.builderActionConfigs[action];
    if (!config) return;

    const step = {
      id: ++this.builderStepId,
      action: action,
      config: config,
      values: values
    };

    this.builderSteps.push(step);
    this.builderRenderSteps();
    this.builderUpdatePreview();
    this.builderUpdateStepCount();
    this.showToast(`Added: ${config.label}`, 'success');
  }

  builderRenderSteps() {
    const container = document.getElementById('builder-steps-list');
    const emptyState = document.getElementById('builder-empty-steps');
    if (!container) return;

    if (this.builderSteps.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      container.innerHTML = '';
      container.appendChild(emptyState);
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const stepsHtml = this.builderSteps.map((step, index) => {
      const config = step.config;
      const desc = step.values.description || this.builderGetDefaultDescription(step);

      return `
        <div class="step-item just-added" data-id="${step.id}">
          <div class="step-item-header" onclick="app.builderToggleStep(${step.id})">
            <span class="step-number">${index + 1}</span>
            <div class="step-info">
              <div class="step-action">${config.label}</div>
              <div class="step-desc">${desc}</div>
            </div>
            <div class="step-actions">
              <button onclick="event.stopPropagation(); app.builderMoveStep(${step.id}, -1)" title="Move Up">↑</button>
              <button onclick="event.stopPropagation(); app.builderMoveStep(${step.id}, 1)" title="Move Down">↓</button>
              <button onclick="event.stopPropagation(); app.builderDuplicateStep(${step.id})" title="Duplicate">⧉</button>
              <button class="delete" onclick="event.stopPropagation(); app.builderDeleteStep(${step.id})" title="Delete">×</button>
            </div>
          </div>
          <div class="step-item-body">
            ${this.builderRenderStepFields(step)}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = stepsHtml;

    // Remove animation class after animation
    setTimeout(() => {
      document.querySelectorAll('.just-added').forEach(el => el.classList.remove('just-added'));
    }, 300);
  }

  builderRenderStepFields(step) {
    const config = step.config;
    return config.fields.map(field => {
      const value = step.values[field.name] || '';

      if (field.type === 'select') {
        const options = field.options.map(opt =>
          `<option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>${opt.label}</option>`
        ).join('');
        return `
          <div class="form-row">
            <label>${field.label}</label>
            <select onchange="app.builderUpdateStepValue(${step.id}, '${field.name}', this.value)">
              ${options}
            </select>
            ${field.hint ? `<div class="form-hint">${field.hint}</div>` : ''}
          </div>
        `;
      }

      return `
        <div class="form-row">
          <label>${field.label}${field.required ? ' *' : ''}</label>
          <input type="${field.type || 'text'}"
                 value="${value}"
                 placeholder="${field.placeholder || ''}"
                 onchange="app.builderUpdateStepValue(${step.id}, '${field.name}', this.value)">
          ${field.hint ? `<div class="form-hint">${field.hint}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  builderGetDefaultDescription(step) {
    const v = step.values;
    switch (step.action) {
      case 'goto': return v.url || 'Navigate to URL';
      case 'click': return v.selector || 'Click element';
      case 'fill': return v.selector ? `Fill ${v.selector}` : 'Fill input';
      case 'expectVisible': return v.selector || 'Check element visible';
      case 'expectText': return v.text ? `Verify "${v.text}"` : 'Check text';
      case 'wait': return v.duration ? `Wait ${v.duration}ms` : 'Wait';
      case 'screenshot': return v.name || 'Take screenshot';
      default: return step.config.label;
    }
  }

  builderToggleStep(id) {
    const stepEl = document.querySelector(`.step-item[data-id="${id}"]`);
    if (stepEl) {
      stepEl.classList.toggle('expanded');
    }
  }

  builderUpdateStepValue(id, field, value) {
    const step = this.builderSteps.find(s => s.id === id);
    if (step) {
      step.values[field] = value;
      this.builderUpdatePreview();
      // Update description display
      const stepEl = document.querySelector(`.step-item[data-id="${id}"] .step-desc`);
      if (stepEl) {
        stepEl.textContent = step.values.description || this.builderGetDefaultDescription(step);
      }
    }
  }

  builderMoveStep(id, direction) {
    const index = this.builderSteps.findIndex(s => s.id === id);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.builderSteps.length) return;

    const temp = this.builderSteps[index];
    this.builderSteps[index] = this.builderSteps[newIndex];
    this.builderSteps[newIndex] = temp;

    this.builderRenderSteps();
    this.builderUpdatePreview();
  }

  builderDuplicateStep(id) {
    const step = this.builderSteps.find(s => s.id === id);
    if (step) {
      this.builderAddStep(step.action, { ...step.values });
    }
  }

  builderDeleteStep(id) {
    this.builderSteps = this.builderSteps.filter(s => s.id !== id);
    this.builderRenderSteps();
    this.builderUpdatePreview();
    this.builderUpdateStepCount();
    this.showToast('Step deleted', 'info');
  }

  builderUpdateStepCount() {
    const countEl = document.getElementById('builder-step-count');
    if (countEl) {
      countEl.textContent = `(${this.builderSteps.length} steps)`;
    }
  }

  builderClearAll() {
    if (this.builderSteps.length === 0) return;

    if (confirm('Are you sure you want to clear all steps?')) {
      this.builderSteps = [];
      this.builderRenderSteps();
      this.builderUpdatePreview();
      this.builderUpdateStepCount();
      this.showToast('All steps cleared', 'info');
    }
  }

  builderUpdatePreview() {
    const preview = document.getElementById('builder-yaml-preview');
    if (!preview) return;

    const nameEl = document.getElementById('builder-test-name');
    const descEl = document.getElementById('builder-test-desc');
    const name = nameEl ? nameEl.value : 'My New Test';
    const description = descEl ? descEl.value : '';

    let yaml = `# ${name}\n`;
    yaml += `# ${'='.repeat(name.length)}\n\n`;
    yaml += `name: ${name}\n`;
    if (description) yaml += `description: ${description}\n`;
    yaml += `runner: web\n\n`;
    yaml += `steps:\n`;

    if (this.builderSteps.length === 0) {
      yaml += `  # Add steps using the visual builder\n`;
    } else {
      this.builderSteps.forEach(step => {
        yaml += this.builderStepToYaml(step);
      });
    }

    preview.textContent = yaml;
  }

  builderStepToYaml(step) {
    const v = step.values;
    let yaml = `  - action: ${step.action}\n`;

    switch (step.action) {
      case 'goto':
        yaml += `    url: ${v.url || 'https://example.com'}\n`;
        yaml += `    waitUntil: load\n`;
        break;
      case 'waitForLoadState':
        yaml += `    state: ${v.state || 'load'}\n`;
        break;
      case 'click':
      case 'hover':
      case 'expectVisible':
        yaml += `    selector: '${v.selector || 'element'}'\n`;
        break;
      case 'fill':
        yaml += `    selector: '${v.selector || 'input'}'\n`;
        yaml += `    value: '${v.value || ''}'\n`;
        break;
      case 'select':
        yaml += `    selector: '${v.selector || 'select'}'\n`;
        yaml += `    value: '${v.value || ''}'\n`;
        break;
      case 'expectText':
        yaml += `    selector: '${v.selector || 'element'}'\n`;
        yaml += `    text: '${v.text || ''}'\n`;
        break;
      case 'wait':
        yaml += `    duration: ${v.duration || 1000}\n`;
        break;
      case 'screenshot':
        yaml += `    name: ${v.name || 'screenshot'}\n`;
        yaml += `    fullPage: ${v.fullPage === 'true'}\n`;
        break;
    }

    if (v.description) {
      yaml += `    description: ${v.description}\n`;
    }

    yaml += `\n`;
    return yaml;
  }

  async builderSaveTest() {
    const nameEl = document.getElementById('builder-test-name');
    const name = nameEl ? nameEl.value.trim() : '';

    if (!name) {
      this.showToast('Please enter a test name', 'error');
      return;
    }

    if (this.builderSteps.length === 0) {
      this.showToast('Please add at least one step', 'error');
      return;
    }

    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const yaml = document.getElementById('builder-yaml-preview').textContent;

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: filename, content: yaml })
      });

      if (response.ok) {
        this.showToast(`Test saved: ${filename}.yaml`, 'success');
        this.builderSteps = [];
        this.builderRenderSteps();
        this.builderUpdatePreview();
        this.builderUpdateStepCount();
        this.loadFlows();
      } else {
        const error = await response.json();
        this.showToast(error.error || 'Failed to save', 'error');
      }
    } catch (err) {
      this.showToast('Failed to save test', 'error');
    }
  }

  async builderRunTest() {
    if (this.builderSteps.length === 0) {
      this.showToast('Please add steps first', 'error');
      return;
    }

    await this.builderSaveTest();

    const nameEl = document.getElementById('builder-test-name');
    const name = nameEl ? nameEl.value.trim() : 'test';
    const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    this.showView('runner');
    this.showToast(`Ready to run ${filename}.yaml`, 'info');
  }

  async builderLoadExisting() {
    try {
      const response = await fetch(`/api/projects/${this.currentProject}/flows`);
      const flows = await response.json();

      if (flows.length === 0) {
        this.showToast('No existing tests found', 'info');
        return;
      }

      const flowList = flows.map(f => `${f.name} (${f.file})`).join('\n');
      const selected = prompt(`Enter the filename to load:\n\n${flowList}`);

      if (selected) {
        this.showView('editor');
        this.showToast('Use the Editor to modify existing tests', 'info');
      }
    } catch (err) {
      this.showToast('Failed to load flows', 'error');
    }
  }

  // Quick Add Modal
  builderShowQuickAdd() {
    document.getElementById('builder-quick-add-backdrop').classList.add('active');
    document.getElementById('builder-quick-add-modal').classList.add('active');
    document.getElementById('builder-quick-action-type').value = '';
    document.getElementById('builder-quick-add-fields').innerHTML = '';
  }

  builderHideQuickAdd() {
    document.getElementById('builder-quick-add-backdrop').classList.remove('active');
    document.getElementById('builder-quick-add-modal').classList.remove('active');
  }

  builderUpdateQuickAddForm() {
    const action = document.getElementById('builder-quick-action-type').value;
    const fieldsContainer = document.getElementById('builder-quick-add-fields');

    if (!action) {
      fieldsContainer.innerHTML = '';
      return;
    }

    const config = this.builderActionConfigs[action];
    fieldsContainer.innerHTML = config.fields.map(field => {
      if (field.type === 'select') {
        const options = field.options.map(opt =>
          `<option value="${opt.value}">${opt.label}</option>`
        ).join('');
        return `
          <div class="form-row">
            <label>${field.label}</label>
            <select id="builder-quick-${field.name}">
              ${options}
            </select>
            ${field.hint ? `<div class="form-hint">${field.hint}</div>` : ''}
          </div>
        `;
      }
      return `
        <div class="form-row">
          <label>${field.label}${field.required ? ' *' : ''}</label>
          <input type="${field.type || 'text'}"
                 id="builder-quick-${field.name}"
                 placeholder="${field.placeholder || ''}">
          ${field.hint ? `<div class="form-hint">${field.hint}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  builderConfirmQuickAdd() {
    const action = document.getElementById('builder-quick-action-type').value;
    if (!action) {
      this.showToast('Please select an action', 'error');
      return;
    }

    const config = this.builderActionConfigs[action];
    const values = {};

    for (const field of config.fields) {
      const input = document.getElementById(`builder-quick-${field.name}`);
      if (input) {
        values[field.name] = input.value;
      }

      if (field.required && !values[field.name]) {
        this.showToast(`${field.label} is required`, 'error');
        return;
      }
    }

    this.builderAddStep(action, values);
    this.builderHideQuickAdd();
  }

  // Method Tabs
  builderSwitchMethod(method) {
    const tabs = document.querySelectorAll('.method-tab');
    tabs.forEach((tab, index) => {
      if ((method === 'record' && index === 0) || (method === 'manual' && index === 1)) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    const recordingPanel = document.getElementById('builder-recording-panel');
    if (recordingPanel) {
      recordingPanel.style.display = method === 'record' ? 'block' : 'none';
    }
  }

  // Recording Methods
  builderStartRecording() {
    const url = document.getElementById('builder-record-url').value.trim();
    if (!url) {
      this.showToast('Please enter a URL to record', 'error');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.showToast('Please enter a valid URL starting with http:// or https://', 'error');
      return;
    }

    this.builderIsRecording = true;
    this.builderRecordedActions = [];

    document.getElementById('btn-builder-start-record').style.display = 'none';
    document.getElementById('btn-builder-stop-record').style.display = 'inline-flex';
    document.getElementById('builder-recording-status').classList.add('active');
    document.getElementById('builder-record-url').disabled = true;
    document.getElementById('builder-recorded-step-count').textContent = '0 actions captured';
    document.getElementById('builder-last-recorded-action').innerHTML = '';

    if (this.builderSteps.length > 0) {
      if (confirm('Clear existing steps before recording?')) {
        this.builderSteps = [];
        this.builderRenderSteps();
        this.builderUpdatePreview();
        this.builderUpdateStepCount();
      }
    }

    this.socket.emit('record:start', { url });
    this.showToast('Opening browser... Please wait', 'info');
  }

  builderStopRecording() {
    if (!this.builderIsRecording) return;

    this.socket.emit('record:stop');
    this.showToast('Stopping recording...', 'info');
  }

  builderHandleRecordedAction(data) {
    this.builderRecordedActions.push(data);

    document.getElementById('builder-recorded-step-count').textContent =
      `${this.builderRecordedActions.length} action${this.builderRecordedActions.length > 1 ? 's' : ''} captured`;

    const lastActionDiv = document.getElementById('builder-last-recorded-action');
    lastActionDiv.innerHTML = `
      <div class="recorded-action">
        Last: <strong>${data.action}</strong> - ${data.description || data.selector || data.url || ''}
      </div>
    `;

    this.builderAddRecordedStep(data);
  }

  builderAddRecordedStep(data) {
    const actionMap = {
      'goto': 'goto',
      'click': 'click',
      'fill': 'fill',
      'type': 'fill',
      'select': 'select',
      'hover': 'hover',
      'navigation': 'goto'
    };

    const action = actionMap[data.action] || data.action;
    if (!this.builderActionConfigs[action]) {
      console.log('Unknown action:', data.action);
      return;
    }

    const values = {};

    switch (action) {
      case 'goto':
        values.url = data.url;
        values.description = `Navigate to ${new URL(data.url).pathname || '/'}`;
        break;
      case 'click':
        values.selector = data.selector;
        values.description = data.description || `Click on ${data.text || data.selector}`;
        break;
      case 'fill':
        values.selector = data.selector;
        values.value = data.value;
        values.description = `Enter "${data.value}" in ${data.selector}`;
        break;
      case 'select':
        values.selector = data.selector;
        values.value = data.value;
        values.description = `Select "${data.value}"`;
        break;
      case 'hover':
        values.selector = data.selector;
        values.description = `Hover over ${data.selector}`;
        break;
    }

    this.builderAddStep(action, values);
  }

  builderHandleRecordingStopped(data) {
    this.builderIsRecording = false;
    this.builderResetRecordingUI();

    if (data.actions && data.actions.length > 0) {
      this.showToast(`Recording complete! ${data.actions.length} actions captured.`, 'success');
    } else if (this.builderRecordedActions.length > 0) {
      this.showToast(`Recording complete! ${this.builderRecordedActions.length} actions captured.`, 'success');
    } else {
      this.showToast('Recording complete. No actions were captured.', 'info');
    }
  }

  builderResetRecordingUI() {
    document.getElementById('btn-builder-start-record').style.display = 'inline-flex';
    document.getElementById('btn-builder-stop-record').style.display = 'none';
    document.getElementById('builder-recording-status').classList.remove('active');
    document.getElementById('builder-record-url').disabled = false;
  }

  // ============================================================================
  // Performance Testing Methods
  // ============================================================================

  switchPerfTab(tabName) {
    document.querySelectorAll('.perf-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('.perf-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `perf-${tabName}`);
    });
    if (tabName === 'history') {
      this.loadPerformanceReports();
    }
  }

  async loadPerformanceReports() {
    if (!this.currentProject) {
      document.getElementById('perf-history-list').innerHTML = '<p class="perf-history-empty">Select a project first</p>';
      return;
    }
    try {
      const response = await fetch(`/api/projects/${this.currentProject}/performance/reports`);
      const reports = await response.json();
      const container = document.getElementById('perf-history-list');

      if (reports.length === 0) {
        container.innerHTML = '<p class="perf-history-empty">No performance tests recorded yet</p>';
        return;
      }

      container.innerHTML = reports.map(report => `
        <div class="perf-history-item" onclick="app.viewPerfReport('${report.name}')">
          <div class="perf-history-info">
            <div class="perf-history-name">${report.displayName || report.name}</div>
            <div class="perf-history-meta">${report.description || ''} - ${new Date(report.timestamp).toLocaleString()}</div>
          </div>
          <span class="perf-history-type ${report.type}">${report.type}</span>
        </div>
      `).join('');
      container.classList.remove('perf-history-empty');
      container.classList.add('perf-history-list');
    } catch (err) {
      console.error('Failed to load performance reports:', err);
    }
  }

  async runLoadTest() {
    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }
    const targetUrl = document.getElementById('load-target-url').value;
    const method = document.getElementById('load-method').value;
    const virtualUsers = parseInt(document.getElementById('load-users').value);
    const duration = parseInt(document.getElementById('load-duration').value);
    const rampUp = parseInt(document.getElementById('load-rampup').value);

    if (!targetUrl) {
      this.showToast('Please enter a target URL', 'error');
      return;
    }

    const btn = document.getElementById('btn-run-load-test');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running...';

    const resultsEl = document.getElementById('load-test-results');
    resultsEl.innerHTML = `<div class="perf-loading"><div class="spinner"></div><p>Running load test with ${virtualUsers} users for ${duration}s...</p></div>`;

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/performance/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl, method, virtualUsers, duration, rampUp })
      });
      const result = await response.json();
      if (response.ok) {
        this.renderLoadTestResults(result);
        this.showToast('Load test completed', 'success');
      } else {
        throw new Error(result.error || 'Load test failed');
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="perf-results-empty"><p style="color: var(--color-error);">Error: ${err.message}</p></div>`;
      this.showToast('Load test failed', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  renderLoadTestResults(result) {
    const m = result.metrics;
    const errorClass = m.errorRate < 1 ? 'success' : m.errorRate < 5 ? 'warning' : 'error';
    const avgClass = m.avgResponseTime < 500 ? 'success' : m.avgResponseTime < 2000 ? 'warning' : 'error';

    document.getElementById('load-test-results').innerHTML = `
      <div class="perf-metrics-grid">
        <div class="perf-metric-card"><div class="perf-metric-value">${result.totalRequests}</div><div class="perf-metric-label">Total Requests</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value ${avgClass}">${Math.round(m.avgResponseTime)}ms</div><div class="perf-metric-label">Avg Response</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${m.throughput.toFixed(1)}</div><div class="perf-metric-label">Req/sec</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value ${errorClass}">${m.errorRate.toFixed(1)}%</div><div class="perf-metric-label">Error Rate</div></div>
      </div>
      <h4 style="margin: 16px 0 12px; color: var(--text-secondary);">Response Time Distribution</h4>
      <div class="perf-metrics-grid">
        <div class="perf-metric-card"><div class="perf-metric-value">${m.minResponseTime}ms</div><div class="perf-metric-label">Min</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${m.p50}ms</div><div class="perf-metric-label">P50</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${m.p95}ms</div><div class="perf-metric-label">P95</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${m.p99}ms</div><div class="perf-metric-label">P99</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${m.maxResponseTime}ms</div><div class="perf-metric-label">Max</div></div>
      </div>`;
  }

  async runPagePerformance() {
    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }
    const urlsText = document.getElementById('page-urls').value;
    const urls = urlsText.split('\n').map(u => u.trim()).filter(u => u && u.startsWith('http'));
    if (urls.length === 0) {
      this.showToast('Please enter at least one URL', 'error');
      return;
    }

    const btn = document.getElementById('btn-run-page-perf');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Measuring...';

    const resultsEl = document.getElementById('page-perf-results');
    resultsEl.innerHTML = `<div class="perf-loading"><div class="spinner"></div><p>Measuring Web Vitals for ${urls.length} URL(s)...</p></div>`;

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/performance/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });
      const data = await response.json();
      if (response.ok) {
        this.renderPagePerfResults(data.results);
        this.showToast('Web Vitals measurement complete', 'success');
      } else {
        throw new Error(data.error || 'Measurement failed');
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="perf-results-empty"><p style="color: var(--color-error);">Error: ${err.message}</p></div>`;
      this.showToast('Measurement failed', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  renderPagePerfResults(results) {
    const getClass = (metric, val) => {
      if (val == null) return '';
      const t = { lcp: [2500, 4000], fcp: [1800, 3000], ttfb: [800, 1800], cls: [0.1, 0.25] };
      const [g, p] = t[metric] || [0, 0];
      return val <= g ? 'good' : val <= p ? 'needs-improvement' : 'poor';
    };
    const fmt = (v, u = 'ms') => v == null ? 'N/A' : u === 'ms' ? `${Math.round(v)}ms` : v.toFixed(3);

    document.getElementById('page-perf-results').innerHTML = results.map(r => `
      <div style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 12px; color: var(--text-secondary); font-size: 0.875rem;">${r.url}</h4>
        <div class="vitals-grid">
          <div class="vital-card ${getClass('lcp', r.lcp)}"><div class="vital-name">LCP</div><div class="vital-value">${fmt(r.lcp)}</div><div class="vital-threshold">Largest Contentful Paint</div></div>
          <div class="vital-card ${getClass('fcp', r.fcp)}"><div class="vital-name">FCP</div><div class="vital-value">${fmt(r.fcp)}</div><div class="vital-threshold">First Contentful Paint</div></div>
          <div class="vital-card ${getClass('ttfb', r.ttfb)}"><div class="vital-name">TTFB</div><div class="vital-value">${fmt(r.ttfb)}</div><div class="vital-threshold">Time to First Byte</div></div>
          <div class="vital-card ${getClass('cls', r.cls)}"><div class="vital-name">CLS</div><div class="vital-value">${fmt(r.cls, '')}</div><div class="vital-threshold">Cumulative Layout Shift</div></div>
        </div>
        <div style="margin-top: 12px; font-size: 0.8125rem; color: var(--text-tertiary);">
          DOM Load: ${fmt(r.domLoad)} | Full Load: ${fmt(r.fullLoad)} | Resources: ${r.resourceCount} (${(r.transferSize / 1024).toFixed(1)} KB)
        </div>
      </div>
    `).join('');
  }

  async runApiPerformance() {
    if (!this.currentProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }
    const url = document.getElementById('api-url').value;
    const method = document.getElementById('api-method').value;
    const iterations = parseInt(document.getElementById('api-iterations').value);
    if (!url) {
      this.showToast('Please enter an API URL', 'error');
      return;
    }

    const btn = document.getElementById('btn-run-api-perf');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Testing...';

    const resultsEl = document.getElementById('api-perf-results');
    resultsEl.innerHTML = `<div class="perf-loading"><div class="spinner"></div><p>Running ${iterations} API requests...</p></div>`;

    try {
      const response = await fetch(`/api/projects/${this.currentProject}/performance/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, iterations })
      });
      const result = await response.json();
      if (response.ok) {
        this.renderApiPerfResults(result);
        this.showToast('API performance test complete', 'success');
      } else {
        throw new Error(result.error || 'Test failed');
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="perf-results-empty"><p style="color: var(--color-error);">Error: ${err.message}</p></div>`;
      this.showToast('API test failed', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  renderApiPerfResults(result) {
    const m = result.metrics;
    const errorClass = m.errorRate < 1 ? 'success' : m.errorRate < 5 ? 'warning' : 'error';
    const avgClass = m.avgResponseTime < 200 ? 'success' : m.avgResponseTime < 500 ? 'warning' : 'error';

    document.getElementById('api-perf-results').innerHTML = `
      <div class="perf-metrics-grid">
        <div class="perf-metric-card"><div class="perf-metric-value">${result.iterations}</div><div class="perf-metric-label">Iterations</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value ${avgClass}">${Math.round(m.avgResponseTime)}ms</div><div class="perf-metric-label">Avg Response</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value success">${m.successCount}</div><div class="perf-metric-label">Success</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value ${errorClass}">${m.errorCount}</div><div class="perf-metric-label">Errors</div></div>
      </div>
      <h4 style="margin: 16px 0 12px; color: var(--text-secondary);">Response Time Distribution</h4>
      <div class="perf-metrics-grid">
        <div class="perf-metric-card"><div class="perf-metric-value">${Math.round(m.minResponseTime)}ms</div><div class="perf-metric-label">Min</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${Math.round(m.p95)}ms</div><div class="perf-metric-label">P95</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${Math.round(m.p99)}ms</div><div class="perf-metric-label">P99</div></div>
        <div class="perf-metric-card"><div class="perf-metric-value">${Math.round(m.maxResponseTime)}ms</div><div class="perf-metric-label">Max</div></div>
      </div>
      <div style="margin-top: 16px; padding: 12px; background: var(--bg-input); border-radius: var(--radius-sm);">
        <div style="font-size: 0.875rem; color: var(--text-tertiary);">
          Error Rate: <strong style="color: var(--color-${errorClass === 'success' ? 'success' : errorClass === 'warning' ? 'warning' : 'error'})">${m.errorRate.toFixed(1)}%</strong>
        </div>
      </div>`;
  }

  async viewPerfReport(reportName) {
    try {
      const response = await fetch(`/api/projects/${this.currentProject}/reports/${reportName}`);
      const report = await response.json();
      this.currentPerfReport = report;
      this.showPerfReportModal(report);
    } catch (err) {
      console.error('Failed to load report:', err);
      this.showToast('Failed to load report', 'error');
    }
  }

  showPerfReportModal(report) {
    const modal = document.getElementById('perf-report-modal');
    const title = document.getElementById('perf-report-title');
    const content = document.getElementById('perf-report-content');

    title.textContent = report.name || 'Performance Report';

    let html = '';

    if (report.type === 'load') {
      html = this.renderLoadReportDetails(report);
    } else if (report.type === 'page') {
      html = this.renderPageReportDetails(report);
    } else if (report.type === 'api') {
      html = this.renderApiReportDetails(report);
    } else {
      html = `<pre>${JSON.stringify(report, null, 2)}</pre>`;
    }

    content.innerHTML = html;
    modal.style.display = 'flex';
  }

  renderLoadReportDetails(report) {
    const m = report.metrics || {};
    return `
      <div class="perf-report-details">
        <div class="perf-report-section">
          <h4>Test Configuration</h4>
          <div class="perf-report-grid">
            <div class="perf-report-item">
              <span class="label">Target URL</span>
              <span class="value">${report.config?.targetUrl || 'N/A'}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Method</span>
              <span class="value">${report.config?.method || 'GET'}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Virtual Users</span>
              <span class="value">${report.config?.virtualUsers || 0}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Duration</span>
              <span class="value">${report.config?.duration || 0}s</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Ramp-up</span>
              <span class="value">${report.config?.rampUp || 0}s</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Executed</span>
              <span class="value">${new Date(report.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div class="perf-report-section">
          <h4>Request Summary</h4>
          <div class="perf-report-grid">
            <div class="perf-report-item highlight">
              <span class="label">Total Requests</span>
              <span class="value">${report.totalRequests || 0}</span>
            </div>
            <div class="perf-report-item success">
              <span class="label">Successful</span>
              <span class="value">${report.successfulRequests || 0}</span>
            </div>
            <div class="perf-report-item ${(report.failedRequests || 0) > 0 ? 'error' : ''}">
              <span class="label">Failed</span>
              <span class="value">${report.failedRequests || 0}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Throughput</span>
              <span class="value">${(m.throughput || 0).toFixed(2)} req/s</span>
            </div>
            <div class="perf-report-item ${(m.errorRate || 0) > 1 ? 'error' : ''}">
              <span class="label">Error Rate</span>
              <span class="value">${(m.errorRate || 0).toFixed(2)}%</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Test Duration</span>
              <span class="value">${(report.duration || 0).toFixed(1)}s</span>
            </div>
          </div>
        </div>

        <div class="perf-report-section">
          <h4>Response Times</h4>
          <div class="perf-report-grid">
            <div class="perf-report-item">
              <span class="label">Average</span>
              <span class="value">${Math.round(m.avgResponseTime || 0)}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Min</span>
              <span class="value">${m.minResponseTime || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Max</span>
              <span class="value">${m.maxResponseTime || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">P50 (Median)</span>
              <span class="value">${m.p50 || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">P90</span>
              <span class="value">${m.p90 || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">P95</span>
              <span class="value">${m.p95 || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">P99</span>
              <span class="value">${m.p99 || 0}ms</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderPageReportDetails(report) {
    const vitals = report.metrics || {};
    return `
      <div class="perf-report-details">
        <div class="perf-report-section">
          <h4>Page Information</h4>
          <div class="perf-report-grid">
            <div class="perf-report-item" style="grid-column: span 2;">
              <span class="label">URL</span>
              <span class="value">${report.config?.url || 'N/A'}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Executed</span>
              <span class="value">${new Date(report.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div class="perf-report-section">
          <h4>Core Web Vitals</h4>
          <div class="perf-report-grid vitals-grid">
            <div class="perf-report-item vital-card ${this.getVitalClass('lcp', vitals.lcp)}">
              <span class="label">LCP (Largest Contentful Paint)</span>
              <span class="value">${vitals.lcp || 0}ms</span>
              <span class="threshold">Good: &lt;2500ms</span>
            </div>
            <div class="perf-report-item vital-card ${this.getVitalClass('fcp', vitals.fcp)}">
              <span class="label">FCP (First Contentful Paint)</span>
              <span class="value">${vitals.fcp || 0}ms</span>
              <span class="threshold">Good: &lt;1800ms</span>
            </div>
            <div class="perf-report-item vital-card ${this.getVitalClass('ttfb', vitals.ttfb)}">
              <span class="label">TTFB (Time to First Byte)</span>
              <span class="value">${vitals.ttfb || 0}ms</span>
              <span class="threshold">Good: &lt;800ms</span>
            </div>
            <div class="perf-report-item vital-card ${this.getVitalClass('cls', vitals.cls)}">
              <span class="label">CLS (Cumulative Layout Shift)</span>
              <span class="value">${(vitals.cls || 0).toFixed(3)}</span>
              <span class="threshold">Good: &lt;0.1</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderApiReportDetails(report) {
    const m = report.metrics || {};
    return `
      <div class="perf-report-details">
        <div class="perf-report-section">
          <h4>API Configuration</h4>
          <div class="perf-report-grid">
            <div class="perf-report-item" style="grid-column: span 2;">
              <span class="label">URL</span>
              <span class="value">${report.config?.url || 'N/A'}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Method</span>
              <span class="value">${report.config?.method || 'GET'}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Iterations</span>
              <span class="value">${report.config?.iterations || 0}</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Executed</span>
              <span class="value">${new Date(report.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div class="perf-report-section">
          <h4>Response Times</h4>
          <div class="perf-report-grid">
            <div class="perf-report-item highlight">
              <span class="label">Average</span>
              <span class="value">${Math.round(m.avgResponseTime || 0)}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Min</span>
              <span class="value">${m.minResponseTime || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Max</span>
              <span class="value">${m.maxResponseTime || 0}ms</span>
            </div>
            <div class="perf-report-item">
              <span class="label">P95</span>
              <span class="value">${m.p95 || 0}ms</span>
            </div>
            <div class="perf-report-item ${(m.errorRate || 0) > 0 ? 'error' : 'success'}">
              <span class="label">Error Rate</span>
              <span class="value">${(m.errorRate || 0).toFixed(2)}%</span>
            </div>
            <div class="perf-report-item">
              <span class="label">Throughput</span>
              <span class="value">${(m.throughput || 0).toFixed(2)} req/s</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getVitalClass(metric, value) {
    const thresholds = {
      lcp: { good: 2500, poor: 4000 },
      fcp: { good: 1800, poor: 3000 },
      ttfb: { good: 800, poor: 1800 },
      cls: { good: 0.1, poor: 0.25 }
    };
    const t = thresholds[metric];
    if (!t || value === undefined) return '';
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'warning';
    return 'poor';
  }

  closePerfReportModal() {
    document.getElementById('perf-report-modal').style.display = 'none';
  }

  downloadPerfReportXls() {
    if (!this.currentPerfReport) {
      this.showToast('No report loaded', 'error');
      return;
    }

    const report = this.currentPerfReport;
    let csvContent = '';

    if (report.type === 'load') {
      csvContent = this.generateLoadReportCsv(report);
    } else if (report.type === 'page') {
      csvContent = this.generatePageReportCsv(report);
    } else if (report.type === 'api') {
      csvContent = this.generateApiReportCsv(report);
    }

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.name || 'performance-report'}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast('Report downloaded successfully', 'success');
  }

  generateLoadReportCsv(report) {
    const m = report.metrics || {};
    const c = report.config || {};

    let csv = 'Load Test Report\n\n';
    csv += 'Configuration\n';
    csv += `Target URL\t${c.targetUrl || 'N/A'}\n`;
    csv += `Method\t${c.method || 'GET'}\n`;
    csv += `Virtual Users\t${c.virtualUsers || 0}\n`;
    csv += `Duration\t${c.duration || 0}s\n`;
    csv += `Ramp-up\t${c.rampUp || 0}s\n`;
    csv += `Executed\t${new Date(report.timestamp).toLocaleString()}\n\n`;

    csv += 'Request Summary\n';
    csv += `Total Requests\t${report.totalRequests || 0}\n`;
    csv += `Successful\t${report.successfulRequests || 0}\n`;
    csv += `Failed\t${report.failedRequests || 0}\n`;
    csv += `Throughput\t${(m.throughput || 0).toFixed(2)} req/s\n`;
    csv += `Error Rate\t${(m.errorRate || 0).toFixed(2)}%\n`;
    csv += `Test Duration\t${(report.duration || 0).toFixed(1)}s\n\n`;

    csv += 'Response Times\n';
    csv += `Average\t${Math.round(m.avgResponseTime || 0)}ms\n`;
    csv += `Min\t${m.minResponseTime || 0}ms\n`;
    csv += `Max\t${m.maxResponseTime || 0}ms\n`;
    csv += `P50 (Median)\t${m.p50 || 0}ms\n`;
    csv += `P90\t${m.p90 || 0}ms\n`;
    csv += `P95\t${m.p95 || 0}ms\n`;
    csv += `P99\t${m.p99 || 0}ms\n\n`;

    // Add timeline data if available
    if (report.timeline && report.timeline.length > 0) {
      csv += 'Timeline Data\n';
      csv += 'Timestamp\tActive Users\tRequests/Second\tAvg Response Time (ms)\tErrors\n';
      report.timeline.forEach(t => {
        if (t.requestsPerSecond > 0) {
          csv += `${new Date(t.timestamp).toLocaleTimeString()}\t${t.activeUsers}\t${t.requestsPerSecond}\t${Math.round(t.avgResponseTime)}\t${t.errorCount}\n`;
        }
      });
    }

    return csv;
  }

  generatePageReportCsv(report) {
    const v = report.metrics || {};
    const c = report.config || {};

    let csv = 'Page Performance Report\n\n';
    csv += 'Page Information\n';
    csv += `URL\t${c.url || 'N/A'}\n`;
    csv += `Executed\t${new Date(report.timestamp).toLocaleString()}\n\n`;

    csv += 'Core Web Vitals\n';
    csv += `Metric\tValue\tThreshold (Good)\tStatus\n`;
    csv += `LCP (Largest Contentful Paint)\t${v.lcp || 0}ms\t<2500ms\t${this.getVitalStatus('lcp', v.lcp)}\n`;
    csv += `FCP (First Contentful Paint)\t${v.fcp || 0}ms\t<1800ms\t${this.getVitalStatus('fcp', v.fcp)}\n`;
    csv += `TTFB (Time to First Byte)\t${v.ttfb || 0}ms\t<800ms\t${this.getVitalStatus('ttfb', v.ttfb)}\n`;
    csv += `CLS (Cumulative Layout Shift)\t${(v.cls || 0).toFixed(3)}\t<0.1\t${this.getVitalStatus('cls', v.cls)}\n`;

    return csv;
  }

  generateApiReportCsv(report) {
    const m = report.metrics || {};
    const c = report.config || {};

    let csv = 'API Performance Report\n\n';
    csv += 'Configuration\n';
    csv += `URL\t${c.url || 'N/A'}\n`;
    csv += `Method\t${c.method || 'GET'}\n`;
    csv += `Iterations\t${c.iterations || 0}\n`;
    csv += `Executed\t${new Date(report.timestamp).toLocaleString()}\n\n`;

    csv += 'Response Times\n';
    csv += `Average\t${Math.round(m.avgResponseTime || 0)}ms\n`;
    csv += `Min\t${m.minResponseTime || 0}ms\n`;
    csv += `Max\t${m.maxResponseTime || 0}ms\n`;
    csv += `P95\t${m.p95 || 0}ms\n`;
    csv += `Error Rate\t${(m.errorRate || 0).toFixed(2)}%\n`;
    csv += `Throughput\t${(m.throughput || 0).toFixed(2)} req/s\n`;

    return csv;
  }

  getVitalStatus(metric, value) {
    const cls = this.getVitalClass(metric, value);
    if (cls === 'good') return 'Good';
    if (cls === 'warning') return 'Needs Improvement';
    if (cls === 'poor') return 'Poor';
    return 'N/A';
  }
}

// Initialize app
const app = new LiteQAApp();
