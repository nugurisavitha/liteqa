/**
 * Browser Recorder Service
 * Captures user interactions in a browser and converts them to test steps
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';

interface RecordedAction {
  action: string;
  selector?: string;
  url?: string;
  value?: string;
  text?: string;
  description?: string;
  timestamp: number;
}

export class BrowserRecorder {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private actions: RecordedAction[] = [];
  private isRecording: boolean = false;
  private onAction: ((action: RecordedAction) => void) | null = null;

  constructor() {}

  async start(url: string, onAction: (action: RecordedAction) => void): Promise<void> {
    this.onAction = onAction;
    this.actions = [];
    this.isRecording = true;

    try {
      // Launch browser in non-headless mode so user can interact
      this.browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized']
      });

      this.context = await this.browser.newContext({
        viewport: null // Use full window size
      });

      this.page = await this.context.newPage();

      // Inject recording scripts before page load
      await this.page.addInitScript(() => {
        // Recording state
        (window as any).__liteqa_recording = true;
        (window as any).__liteqa_actions = [];

        // Generate a robust selector for an element
        function getSelector(element: Element): string {
          // Try ID first
          if (element.id) {
            return `#${element.id}`;
          }

          // Try data-testid
          const testId = element.getAttribute('data-testid');
          if (testId) {
            return `[data-testid="${testId}"]`;
          }

          // Try aria-label
          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) {
            return `[aria-label="${ariaLabel}"]`;
          }

          // Try name attribute for form elements
          const name = element.getAttribute('name');
          if (name) {
            return `[name="${name}"]`;
          }

          // Try unique class combination
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(' ').filter(c => c && !c.includes(':'));
            if (classes.length > 0) {
              const selector = element.tagName.toLowerCase() + '.' + classes.slice(0, 2).join('.');
              if (document.querySelectorAll(selector).length === 1) {
                return selector;
              }
            }
          }

          // Try text content for buttons and links
          if ((element.tagName === 'BUTTON' || element.tagName === 'A') && element.textContent) {
            const text = element.textContent.trim().substring(0, 30);
            if (text) {
              return `${element.tagName.toLowerCase()}:has-text("${text}")`;
            }
          }

          // Build a path-based selector
          const path: string[] = [];
          let current: Element | null = element;
          while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
              selector = `#${current.id}`;
              path.unshift(selector);
              break;
            }

            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(
                c => c.tagName === current!.tagName
              );
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-child(${index})`;
              }
            }

            path.unshift(selector);
            current = parent;
          }

          return path.join(' > ');
        }

        // Click handler
        document.addEventListener('click', (e) => {
          if (!(window as any).__liteqa_recording) return;

          const target = e.target as Element;
          if (!target) return;

          // Ignore clicks on certain elements
          if (target.closest('script') || target.closest('style')) return;

          const action = {
            action: 'click',
            selector: getSelector(target),
            text: target.textContent?.trim().substring(0, 50),
            tagName: target.tagName,
            timestamp: Date.now()
          };

          (window as any).__liteqa_lastAction = action;

          // Send to parent
          if ((window as any).__liteqa_sendAction) {
            (window as any).__liteqa_sendAction(action);
          }
        }, true);

        // Input handler (for fill actions)
        document.addEventListener('input', (e) => {
          if (!(window as any).__liteqa_recording) return;

          const target = e.target as HTMLInputElement | HTMLTextAreaElement;
          if (!target) return;

          // Debounce input events
          clearTimeout((target as any).__liteqa_inputTimeout);
          (target as any).__liteqa_inputTimeout = setTimeout(() => {
            const action = {
              action: 'fill',
              selector: getSelector(target),
              value: target.value,
              inputType: target.type || 'text',
              timestamp: Date.now()
            };

            if ((window as any).__liteqa_sendAction) {
              (window as any).__liteqa_sendAction(action);
            }
          }, 500);
        }, true);

        // Change handler (for select elements)
        document.addEventListener('change', (e) => {
          if (!(window as any).__liteqa_recording) return;

          const target = e.target as HTMLSelectElement;
          if (target.tagName !== 'SELECT') return;

          const action = {
            action: 'select',
            selector: getSelector(target),
            value: target.value,
            text: target.options[target.selectedIndex]?.text,
            timestamp: Date.now()
          };

          if ((window as any).__liteqa_sendAction) {
            (window as any).__liteqa_sendAction(action);
          }
        }, true);

        console.log('[LiteQA] Recording initialized');
      });

      // Expose function to receive actions from page
      await this.page.exposeFunction('__liteqa_sendAction', (action: RecordedAction) => {
        this.handleAction(action);
      });

      // Listen for navigation
      this.page.on('framenavigated', (frame) => {
        if (frame === this.page?.mainFrame() && this.isRecording) {
          const url = frame.url();
          // Don't record about:blank
          if (url && url !== 'about:blank') {
            this.handleAction({
              action: 'goto',
              url: url,
              timestamp: Date.now()
            });
          }
        }
      });

      // Navigate to the starting URL
      await this.page.goto(url, { waitUntil: 'load' });

      // Record the initial navigation
      this.handleAction({
        action: 'goto',
        url: url,
        description: 'Navigate to starting URL',
        timestamp: Date.now()
      });

    } catch (error: any) {
      await this.cleanup();
      throw error;
    }
  }

  private handleAction(action: RecordedAction): void {
    // Skip duplicate navigations
    if (action.action === 'goto') {
      const lastAction = this.actions[this.actions.length - 1];
      if (lastAction?.action === 'goto' && lastAction.url === action.url) {
        return;
      }
    }

    // Skip duplicate fills (debounced on client, but double check)
    if (action.action === 'fill') {
      const lastAction = this.actions[this.actions.length - 1];
      if (lastAction?.action === 'fill' &&
          lastAction.selector === action.selector &&
          lastAction.value === action.value) {
        return;
      }
    }

    this.actions.push(action);

    if (this.onAction) {
      this.onAction(action);
    }
  }

  async stop(): Promise<RecordedAction[]> {
    this.isRecording = false;

    // Stop recording in page
    if (this.page) {
      try {
        await this.page.evaluate(() => {
          (window as any).__liteqa_recording = false;
        });
      } catch {
        // Page might be closed
      }
    }

    await this.cleanup();

    return this.actions;
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {
      // Ignore cleanup errors
    }

    this.browser = null;
    this.context = null;
    this.page = null;
  }

  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  isActive(): boolean {
    return this.isRecording && this.browser !== null;
  }
}
