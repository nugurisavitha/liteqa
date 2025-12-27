# LiteQA

**AI-Assisted Test Automation Platform**

A free, open-source test automation platform combining features from enterprise tools like **Tricentis Tosca** and **Appvance** - including Model-Based Testing, AI Test Generation, Self-Healing, Record & Playback, Visual Testing, and Performance Testing.

## Features

| Feature | Description |
|---------|-------------|
| **Model-Based Testing** | Generate tests from state machine models with coverage analysis |
| **AI Test Generation** | Crawl applications and auto-generate tests |
| **Self-Healing** | Heuristic-based locator recovery (no API keys required) |
| **Record & Playback** | Record browser interactions, generate YAML/TypeScript |
| **Codeless Testing** | Write tests in YAML, no programming required |
| **Script-Based Testing** | Custom JavaScript/TypeScript with full Playwright access |
| **API Testing** | REST API testing with JSON path validation |
| **Performance Testing** | Load testing and Web Core Vitals measurement |
| **Visual Testing** | Pixel-by-pixel screenshot comparison |
| **Cross-Browser** | Chromium, Firefox, WebKit support |
| **Object Repository** | Centralized element definitions (Tosca-style) |
| **Test Data Management** | CSV/JSON data-driven testing with generators |
| **Desktop Testing** | Windows automation via pywinauto |
| **Mobile Testing** | Android testing via Appium |

## Installation

```bash
# Clone repository
git clone https://github.com/your-org/liteqa.git
cd liteqa

# Install dependencies
npm install

# Build
npm run build

# Install Playwright browsers
npx playwright install

# Link globally (optional)
npm link
```

## Quick Start

```bash
# Initialize project
liteqa init my-tests
cd my-tests

# Run tests
liteqa run suite.yaml

# Record a test
liteqa record https://example.com -n my-test

# Auto-generate tests
liteqa generate https://example.com -o ./generated

# Run performance test
liteqa perf load https://api.example.com -u 50 -d 60

# Measure Web Vitals
liteqa perf vitals https://example.com
```

## CLI Commands

### Basic Commands

```bash
liteqa init [directory]          # Initialize project
liteqa run <target>              # Run test suite/flow
liteqa script <file>             # Run custom script
liteqa report                    # Generate report
```

### AI & Automation Commands

```bash
liteqa generate <url>            # AI-generate tests from crawl
liteqa scan <url>                # Scan app, create blueprint
liteqa record <url>              # Record browser interactions
liteqa model <file>              # Generate tests from state machine
```

### Performance Commands

```bash
liteqa perf load <url>           # Run HTTP load test
liteqa perf vitals <url>         # Measure Web Core Vitals
```

### Visual Testing Commands

```bash
liteqa visual compare <name>     # Compare against baseline
liteqa visual update [name]      # Update baseline(s)
liteqa visual list               # List all baselines
```

## Test Formats

### 1. YAML Flows (Codeless)

```yaml
name: Login Test
runner: web

steps:
  - action: goto
    url: https://example.com/login

  - action: fill
    selector: "#username"
    value: testuser

  - action: fill
    selector: "#password"
    value: secret123

  - action: click
    selector: button[type="submit"]

  - action: expectText
    selector: ".welcome"
    text: Welcome
```

### 2. Custom Scripts (JavaScript)

```javascript
// my-test.js
await liteqa.goto('https://example.com');
await liteqa.fill('#search', 'test query');
await liteqa.click('button.search');

await liteqa.expectVisible('.results');
expect(await page.title()).toContain('Search Results');

await liteqa.screenshot('search-results');
```

### 3. State Machine Models

```yaml
name: Shopping Cart
states:
  - id: empty
    name: Empty Cart
    initial: true
  - id: with_items
    name: Cart With Items
  - id: checkout
    name: Checkout
    final: true

transitions:
  - id: add_item
    from: empty
    to: with_items
    actions:
      - action: click
        selector: ".add-to-cart"
  - id: proceed
    from: with_items
    to: checkout
    actions:
      - action: click
        selector: ".checkout-btn"
```

## Key Features Explained

### Self-Healing Locators

LiteQA automatically recovers from broken selectors using heuristics:

1. **Stable Selectors** - `data-testid`, `aria-label`, `role`
2. **Text Similarity** - Fuzzy matching element text
3. **Role + Name** - Accessibility attributes
4. **CSS Contains** - `:has-text()` fallback

```yaml
# If #old-button-id breaks, LiteQA tries alternatives
- action: click
  selector: "#old-button-id"
  # Auto-healed to: button:has-text("Submit")
```

### AI Test Generation

Crawl your application and auto-generate tests:

```bash
liteqa generate https://myapp.com -o ./generated
```

Generates:
- Smoke tests
- Form tests (positive + validation)
- Navigation tests
- Link validation tests
- Login flow detection

### Record & Playback

```bash
liteqa record https://example.com -n login-test
```

- Opens browser for manual interaction
- Records clicks, inputs, navigation
- Generates YAML or TypeScript
- Smart selector generation

### Visual Regression Testing

```yaml
# In your test flow
- action: visualCompare
  name: homepage
  threshold: 0.1
  fullPage: true
```

- Pixel-by-pixel comparison
- Configurable threshold
- Diff image generation
- Ignore regions support

### Performance Testing

```bash
# Load test
liteqa perf load https://api.example.com/users \
  -u 100 \
  -d 60 \
  --report report.html

# Web Vitals
liteqa perf vitals https://example.com
```

Measures:
- Response times (avg, p50, p95, p99)
- Throughput (req/sec)
- LCP, FID, CLS, TTFB

### Model-Based Testing

```bash
liteqa model app-model.yaml \
  --coverage transition \
  --output ./generated
```

Coverage options:
- `state` - All states coverage
- `transition` - All transitions coverage
- `n-switch` - N consecutive transitions

### Data-Driven Testing

```yaml
# test-data.yaml
dataSets:
  users:
    type: csv
    path: ./data/users.csv
  products:
    type: json
    path: ./data/products.json

# In flow
- action: fill
  selector: "#email"
  value: ${users.email}
```

### Object Repository

```yaml
# object-repository.yaml
pages:
  login:
    name: Login Page
    elements:
      username:
        id: username_field
        type: input
        selectors:
          - strategy: testid
            value: username
          - strategy: css
            value: "#username"
```

## Project Structure

```
liteqa/
├── src/
│   ├── cli/              # CLI commands
│   ├── core/             # Core framework
│   │   ├── types.ts
│   │   ├── flow-loader.ts
│   │   ├── self-heal.ts
│   │   ├── object-repository.ts
│   │   └── test-data.ts
│   ├── runners/          # Test runners
│   │   ├── web-runner.ts
│   │   ├── api-runner.ts
│   │   ├── script-runner.ts
│   │   ├── desktop-runner.ts
│   │   └── mobile-runner.ts
│   ├── ai/               # AI features
│   │   └── test-generator.ts
│   ├── recorder/         # Record & Playback
│   │   └── browser-recorder.ts
│   ├── visual/           # Visual testing
│   │   └── visual-tester.ts
│   ├── performance/      # Performance testing
│   │   └── load-tester.ts
│   ├── model/            # Model-based testing
│   │   └── state-machine.ts
│   └── reporters/        # Report generation
├── templates/            # Sample files
├── package.json
└── README.md
```

## Configuration

```yaml
# liteqa.config.yaml
browser: chromium
headless: true
viewport:
  width: 1280
  height: 720
defaultTimeout: 30000

selfHeal: true
selfHealThreshold: 0.6

artifactsDir: ./artifacts
screenshotsDir: ./artifacts/screenshots
reportsDir: ./artifacts/reports

# Visual testing
visual:
  baselineDir: ./visual-baselines
  threshold: 0.1

# Performance
performance:
  defaultUsers: 10
  defaultDuration: 30

# Mobile (optional)
mobile:
  appiumUrl: http://127.0.0.1:4723
```

## Comparison with Enterprise Tools

| Feature | LiteQA | Tosca | Appvance |
|---------|--------|-------|----------|
| Model-Based Testing | Yes | Yes | No |
| AI Test Generation | Yes | No | Yes |
| Self-Healing | Yes (Free) | Yes ($) | Yes ($) |
| Record & Playback | Yes | Yes | Yes |
| Visual Testing | Yes | Yes | Yes |
| Performance Testing | Yes | No | Yes |
| Object Repository | Yes | Yes | No |
| Low-Code | Yes | Yes | Yes |
| Script Support | Yes | Yes | Limited |
| Price | **Free** | $$$ | $$$ |

## Angular SSR Support

LiteQA handles Angular SSR apps with:

- Automatic hydration detection
- Zone.js stability checks
- Recommended wait strategies

```yaml
- action: goto
  url: https://angular-app.com
  waitUntil: networkidle

- action: waitForLoadState
  state: networkidle
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Submit pull request

## License

MIT License - free for personal and commercial use.

## Roadmap

- [ ] iOS mobile support
- [ ] Parallel execution
- [ ] Cloud execution
- [ ] LLM-powered test suggestions
- [ ] Test impact analysis
- [ ] CI/CD integrations
