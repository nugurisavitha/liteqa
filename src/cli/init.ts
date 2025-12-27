// ============================================================================
// LiteQA - CLI Init Command
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

const TEMPLATES = {
  'liteqa.config.yaml': `# LiteQA Configuration
# ==================

# Artifacts configuration
artifactsDir: ./artifacts
screenshotsDir: ./artifacts/screenshots
reportsDir: ./artifacts/reports

# Browser settings
browser: chromium  # chromium, firefox, webkit
headless: true
slowMo: 0
viewport:
  width: 1280
  height: 720

# Timeouts
defaultTimeout: 30000

# Self-healing
selfHeal: true
selfHealThreshold: 0.6

# Retries
retries: 0

# Mobile settings (optional)
# mobile:
#   appiumUrl: http://127.0.0.1:4723
#   capabilities:
#     platformName: Android
#     appium:automationName: UiAutomator2
#     appium:deviceName: Android Emulator
`,

  'suite.yaml': `# LiteQA Test Suite
# =================

name: Sample Test Suite
description: Example test suite demonstrating LiteQA features

# List of flow files to run
flows:
  - flows/web_smoke.yaml
  - flows/api_healthcheck.yaml

# Environment variables (optional)
env:
  BASE_URL: https://example.com
  API_URL: https://jsonplaceholder.typicode.com
`,

  'flows/web_smoke.yaml': `# Web Smoke Test
# ==============

name: Web Smoke Test
description: Basic web smoke test using Playwright
runner: web

steps:
  # Navigate to homepage
  - action: goto
    url: https://example.com
    description: Navigate to Example.com

  # Wait for page to load
  - action: waitForLoadState
    state: networkidle
    description: Wait for network idle

  # Verify page title element exists
  - action: expectVisible
    selector: h1
    description: Verify main heading is visible

  # Verify expected text
  - action: expectText
    selector: h1
    text: Example Domain
    description: Verify heading text

  # Take a screenshot
  - action: screenshot
    name: homepage
    fullPage: true
    description: Capture homepage screenshot
`,

  'flows/api_healthcheck.yaml': `# API Health Check
# ================

name: API Health Check
description: Basic API connectivity and response validation
runner: api

steps:
  # GET request to fetch posts
  - action: request
    method: GET
    url: https://jsonplaceholder.typicode.com/posts/1
    description: Fetch a single post

  # Verify status code
  - action: expectStatus
    status: 200
    description: Verify 200 OK response

  # Verify response structure
  - action: expectJsonPath
    path: $.id
    value: 1
    description: Verify post ID

  - action: expectJsonPath
    path: $.userId
    value: 1
    description: Verify user ID

  # GET request to fetch users
  - action: request
    method: GET
    url: https://jsonplaceholder.typicode.com/users
    description: Fetch all users

  - action: expectStatus
    status: 200
    description: Verify 200 OK response

  # POST request example
  - action: request
    method: POST
    url: https://jsonplaceholder.typicode.com/posts
    headers:
      Content-Type: application/json
    body:
      title: Test Post
      body: This is a test post
      userId: 1
    saveResponse: newPost
    description: Create a new post

  - action: expectStatus
    status: 201
    description: Verify 201 Created response

  - action: expectJsonPath
    path: $.title
    value: Test Post
    description: Verify post title
`,

  'flows/web_login.yaml': `# Web Login Flow
# ==============

name: Web Login Flow
description: Example login flow with reusable module
runner: web
baseUrl: https://example.com

setup:
  - action: goto
    url: https://the-internet.herokuapp.com/login
    description: Navigate to login page

steps:
  # Include the login module
  - action: include
    module: common_login
    params:
      username: tomsmith
      password: SuperSecretPassword!
    description: Execute login steps

  # Verify successful login
  - action: expectVisible
    selector: "#flash.success"
    description: Verify success message

  - action: expectText
    selector: "#flash"
    text: You logged into a secure area
    description: Verify login success text

  - action: screenshot
    name: logged-in
    description: Capture logged-in state

teardown:
  # Logout
  - action: click
    selector: 'a[href="/logout"]'
    description: Click logout button
    continueOnError: true
`,

  'modules/common_login.yaml': `# Common Login Module
# ==================

name: Common Login
description: Reusable login steps
params:
  - username
  - password

steps:
  # Enter username
  - action: fill
    selector: "#username"
    value: \${username}
    description: Enter username

  # Enter password
  - action: fill
    selector: "#password"
    value: \${password}
    description: Enter password

  # Click login button
  - action: click
    selector: 'button[type="submit"]'
    description: Click Login button

  # Wait for navigation
  - action: waitForLoadState
    state: networkidle
    description: Wait for login to complete
`,

  '.gitignore': `# LiteQA
node_modules/
dist/
artifacts/
*.log

# OS
.DS_Store
Thumbs.db
`,
};

export async function initProject(targetDir: string): Promise<void> {
  logger.banner();
  logger.info(`Initializing LiteQA project in: ${targetDir}`);

  // Create directories
  const dirs = [
    '',
    'flows',
    'modules',
    'artifacts',
    'artifacts/screenshots',
    'artifacts/reports',
  ];

  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      logger.debug(`Created directory: ${fullPath}`);
    }
  }

  // Create template files
  for (const [filename, content] of Object.entries(TEMPLATES)) {
    const fullPath = path.join(targetDir, filename);
    const dirPath = path.dirname(fullPath);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content, 'utf-8');
      logger.success(`Created: ${filename}`);
    } else {
      logger.warn(`Skipped (exists): ${filename}`);
    }
  }

  logger.success('\nLiteQA project initialized successfully!');

  console.log(`
Next steps:

  1. Install dependencies:
     ${path.basename(targetDir) !== '.' ? `cd ${path.basename(targetDir)} && ` : ''}npm install

  2. Run sample tests:
     npx liteqa run suite.yaml

  3. Run a single flow:
     npx liteqa run flows/web_smoke.yaml

  4. View reports in:
     ./artifacts/reports/

For more information, see the README.md
`);
}
