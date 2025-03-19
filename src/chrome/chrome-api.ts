/**
 * Chrome API
 * 
 * Main implementation of the Chrome Control MCP API.
 * This class integrates all the components (TabManager, DOMObserver, CacheSystem, etc.)
 * to provide a comprehensive, efficient interface for controlling Chrome.
 */

import ChromeRemoteInterface from 'chrome-remote-interface';
import { TabInfo, PageContent, SemanticElement, ErrorInfo } from '../types.js';
import { TabManager } from '../core/tab-manager.js';
import { DOMObserver } from '../dom/dom-mutation-observer.js';
import { CacheSystem } from '../cache/cache-system.js';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { SemanticAnalyzer } from '../dom/semantic-analyzer.js';
import { ContentExtractor } from '../dom/content-extractor.js';
import { Mutex } from 'async-mutex';
import { withRetry, withTimeout, withMutex, retry } from '../utils/retry.js';
import { getAccessibilityTree, AccessibilityTreeResult } from '../dom/accessibility-tree.js';

/**
 * Main API class for Chrome Control MCP
 */
export class ChromeAPI {
  private logger: Logger;
  private tabManager: TabManager;
  private domObserver: DOMObserver;
  private cacheSystem: CacheSystem;
  private semanticAnalyzer: SemanticAnalyzer;
  private contentExtractor: ContentExtractor;
  private mutex: Mutex;

  constructor() {
    this.logger = new Logger('chrome-api');
    this.tabManager = new TabManager();
    this.domObserver = new DOMObserver();
    this.cacheSystem = new CacheSystem();
    this.mutex = new Mutex();
    
    // Initialize semantic analyzer and content extractor
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.contentExtractor = new ContentExtractor(this.semanticAnalyzer);
    
    // Connect the DOM observer to the cache system
    this.cacheSystem.connectDOMObserver(this.domObserver);
    
    // Listen for DOM mutations to invalidate cache
    this.domObserver.on('mutation', (event) => {
      this.logger.debug('DOM mutation detected', { tabId: event.tabId });
      this.cacheSystem.invalidateTabCache(event.tabId);
    });
  }

  /**
   * Initialize the Chrome API
   */
  async initialize(): Promise<{ status: string }> {
    this.logger.info('Initializing Chrome API');
    
    return await withRetry(async () => {
      // Initialize the tab manager
      await this.tabManager.initialize();
      
      this.logger.info('Chrome API initialized successfully');
      return { status: 'initialized' };
    }, {
      name: 'initialize Chrome API',
      maxRetries: 3
    });
  }

  /**
   * Navigate to a URL in a new tab
   */
  async navigate(url: string): Promise<{ tabId: string; status: string }> {
    this.logger.info('Navigating to URL', { url });
    
    return await withRetry(async () => {
      // Create a new tab via the tab manager
      const tabId = await this.tabManager.createTab(url);
      
      // Get the client for this tab
      const client = this.tabManager.getTabClient(tabId);
      
      // Start observing DOM mutations for this tab
      await this.domObserver.observeTab(tabId, client);
      
      this.logger.info('Navigation successful', { tabId, url });
      return { tabId, status: 'loaded' };
    }, {
      name: `navigate to ${url}`,
      maxRetries: 2
    });
  }

  /**
   * Get the raw HTML content of a page
   */
  async getContent(tabId: string): Promise<{ content: string }> {
    this.logger.debug('Getting page content', { tabId });
    
    // Check cache first
    const cacheKey = `content:${tabId}`;
    const cachedContent = this.cacheSystem.get<string>(cacheKey);
    
    if (cachedContent) {
      this.logger.debug('Returning cached content', { tabId });
      return { content: cachedContent };
    }
    
    return await withMutex(this.mutex, async (release) => {
      try {
        // Verify tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Get content via Runtime.evaluate with timeout
        return await withTimeout(async () => {
          const { result } = await client.Runtime.evaluate({
            expression: 'document.documentElement.outerHTML',
            returnByValue: true
          });
          
          if (!result.value) {
            throw new Error('Failed to get page content: Empty result');
          }
          
          const content = result.value as string;
          
          // Cache the content
          this.cacheSystem.set(cacheKey, content, { tabId });
          
          return { content };
        }, {
          name: `get content for tab ${tabId}`,
          timeoutMs: config.requestTimeout
        });
      } catch (error) {
        this.logger.error('Error getting content', { tabId, error });
        throw new Error(`Failed to get page content: ${error.message}`);
      }
    }, {
      name: `getContent for tab ${tabId}`
    });
  }

  /**
   * Execute JavaScript code in a tab with security enhancements
   */
  async executeScript(tabId: string, script: string): Promise<{ result: unknown }> {
    this.logger.debug('Executing script', { tabId, scriptLength: script.length });
    
    return await withMutex(this.mutex, async (release) => {
      try {
        // Verify tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Security: Sanitize and wrap script in try/catch to safely handle errors
        // and prevent client-side exceptions from breaking the CDP connection
        const wrappedScript = `
          (function() {
            try {
              // Script execution
              ${script}
            } catch (error) {
              // Capture and return any errors
              return {
                __error: true,
                name: error.name,
                message: error.message,
                stack: error.stack
              };
            }
          })();
        `;
        
        // Execute the script with timeout
        return await withTimeout(async () => {
          const { result } = await client.Runtime.evaluate({
            expression: wrappedScript,
            returnByValue: true,
            awaitPromise: true
          });
          
          // Check if script execution resulted in error
          const value = result.value;
          
          if (value && typeof value === 'object' && (value as any).__error === true) {
            const errorData = value as { __error: boolean, name: string, message: string, stack: string };
            throw new Error(`Script execution failed: ${errorData.message}`);
          }
          
          return { result: result.value };
        }, {
          name: `execute script in tab ${tabId}`,
          timeoutMs: config.requestTimeout
        });
      } catch (error) {
        this.logger.error('Script execution error', { tabId, error });
        throw new Error(`Failed to execute script: ${error.message}`);
      }
    }, {
      name: `executeScript for tab ${tabId}`
    });
  }

  /**
   * Click on an element matching a CSS selector
   */
  async clickElement(tabId: string, selector: string): Promise<{ success: boolean }> {
    this.logger.debug('Clicking element', { tabId, selector });
    
    return await withRetry(async () => {
      // Verify tab exists
      if (!this.tabManager.hasTab(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // First, try clicking via JavaScript
      const jsResult = await client.Runtime.evaluate({
        expression: `
          (function() {
            try {
              const element = document.querySelector(${JSON.stringify(selector)});
              if (!element) return { success: false, error: 'Element not found' };
              
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) {
                return { success: false, error: 'Element has zero dimensions' };
              }
              
              element.click();
              return { success: true };
            } catch (error) {
              return { success: false, error: error.message };
            }
          })()
        `,
        returnByValue: true
      });
      
      const jsClickResult = jsResult.result.value as { success: boolean, error?: string };
      
      if (jsClickResult.success) {
        // JavaScript click succeeded
        this.logger.debug('Element clicked via JavaScript', { tabId, selector });
        
        // Invalidate cache since page state has changed
        this.cacheSystem.invalidateTabCache(tabId);
        
        return { success: true };
      }
      
      // If JavaScript click failed, try CDP click
      this.logger.debug('JavaScript click failed, trying CDP', { error: jsClickResult.error });
      
      // Find the element
      const { nodeId } = await client.DOM.querySelector({
        selector,
        nodeId: 1 // document
      });
      
      if (nodeId === 0) {
        throw new Error(`Element not found: ${selector}`);
      }
      
      // Get element box model
      const { model } = await client.DOM.getBoxModel({ nodeId });
      
      if (!model) {
        throw new Error(`Failed to get box model for element: ${selector}`);
      }
      
      // Calculate center coordinates
      const x = (model.content[0] + model.content[2]) / 2;
      const y = (model.content[1] + model.content[5]) / 2;
      
      // Simulate mouse click
      await client.Input.dispatchMouseEvent({
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1
      });
      
      await client.Input.dispatchMouseEvent({
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1
      });
      
      this.logger.debug('Element clicked via CDP', { tabId, selector });
      
      // Invalidate cache since page state has changed
      this.cacheSystem.invalidateTabCache(tabId);
      
      return { success: true };
    }, {
      name: `click element ${selector} in tab ${tabId}`,
      maxRetries: 3
    });
  }

  /**
   * Capture a screenshot of the page
   */
  async takeScreenshot(tabId: string): Promise<{ data: string }> {
    this.logger.debug('Taking screenshot', { tabId });
    
    return await withTimeout(async () => {
      try {
        // Verify tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Take screenshot
        const { data } = await client.Page.captureScreenshot();
        
        return { data };
      } catch (error) {
        this.logger.error('Screenshot error', { tabId, error });
        throw new Error(`Failed to take screenshot: ${error.message}`);
      }
    }, {
      name: `take screenshot of tab ${tabId}`,
      timeoutMs: config.requestTimeout
    });
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<{ success: boolean }> {
    this.logger.debug('Closing tab', { tabId });
    
    try {
      // Stop DOM observation
      this.domObserver.stopObserving(tabId);
      
      // Close tab via tab manager
      await this.tabManager.closeTab(tabId);
      
      // Clear cache entries for this tab
      this.cacheSystem.invalidateTabCache(tabId);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Close tab error', { tabId, error });
      throw new Error(`Failed to close tab: ${error.message}`);
    }
  }

  /**
   * Get a structured representation of the page content
   */
  async getStructuredContent(tabId: string): Promise<{ content: PageContent }> {
    return await withMutex(this.mutex, async (release) => {
      try {
        this.logger.debug('Getting structured content', { tabId });
        
        // Check cache first
        const cacheKey = `structured-content:${tabId}`;
        const cachedContent = this.cacheSystem.get<PageContent>(cacheKey);
        
        if (cachedContent) {
          this.logger.debug('Returning cached structured content', { tabId });
          return { content: cachedContent };
        }
        
        // Verify tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Get the semantic model first (or use cached version)
        const { semanticModel } = await this.analyzePageSemantics(tabId);
        
        // Use ContentExtractor to extract structured content
        const content = await withTimeout(
          () => this.contentExtractor.extractContent(client, tabId, semanticModel),
          { name: `extract content for tab ${tabId}`, timeoutMs: config.requestTimeout }
        );
        
        // Cache the content
        this.cacheSystem.set(cacheKey, content, { tabId });
        
        return { content };
      } catch (error) {
        this.logger.error('Structured content error', { tabId, error });
        throw new Error(`Failed to get structured content: ${error.message}`);
      }
    }, {
      name: `getStructuredContent for tab ${tabId}`
    });
  }

  /**
   * Analyze the page and build a semantic DOM model
   */
  async analyzePageSemantics(tabId: string): Promise<{ semanticModel: SemanticElement[] }> {
    return await withMutex(this.mutex, async (release) => {
      try {
        this.logger.debug('Analyzing page semantics', { tabId });
        
        // Check cache first
        const cacheKey = `semantic-model:${tabId}`;
        const cachedModel = this.cacheSystem.get<SemanticElement[]>(cacheKey);
        
        if (cachedModel) {
          this.logger.debug('Returning cached semantic model', { tabId });
          return { semanticModel: cachedModel };
        }
        
        // Verify tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Use SemanticAnalyzer to analyze the page with timeout
        const semanticModel = await withTimeout(
          () => this.semanticAnalyzer.analyzePage(client, tabId),
          { name: `analyze page semantics for tab ${tabId}`, timeoutMs: config.requestTimeout }
        );
        
        // Cache the model
        this.cacheSystem.set(cacheKey, semanticModel, { tabId });
        
        return { semanticModel };
      } catch (error) {
        this.logger.error('Semantic analysis error', { tabId, error });
        throw new Error(`Failed to analyze page semantics: ${error.message}`);
      }
    }, {
      name: `analyzePageSemantics for tab ${tabId}`
    });
  }

  /**
   * Get the accessibility tree for a page
   */
  async getAccessibilityTree(tabId: string): Promise<{ accessibilityTree: AccessibilityTreeResult }> {
    this.logger.info(`Getting accessibility tree for tab ${tabId}`);
    
    return await withMutex(this.mutex, async (release) => {
      try {
        // Check cache first
        const cacheKey = `accessibility-tree:${tabId}`;
        const cachedTree = this.cacheSystem.get<AccessibilityTreeResult>(cacheKey);
        
        if (cachedTree) {
          this.logger.debug('Returning cached accessibility tree', { tabId });
          return { accessibilityTree: cachedTree };
        }
        
        // Validate the tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client for this tab
        const client = this.tabManager.getTabClient(tabId);
        
        // Enable Accessibility domain if needed
        await client.Accessibility.enable();
        
        // Get the accessibility tree with retry logic
        const accessibilityTree = await withTimeout(
          () => getAccessibilityTree(client, tabId),
          { 
            name: `get accessibility tree for tab ${tabId}`,
            timeoutMs: config.requestTimeout
          }
        );
        
        // Cache the tree
        this.cacheSystem.set(cacheKey, accessibilityTree, { tabId });
        
        return { accessibilityTree };
      } catch (error) {
        this.logger.error('Accessibility tree error', { tabId, error });
        throw new Error(`Failed to get accessibility tree: ${error.message}`);
      }
    }, {
      name: `getAccessibilityTree for tab ${tabId}`
    });
  }

  /**
   * Find elements containing specific text
   */
  async findElementsByText(tabId: string, text: string): Promise<{ elements: SemanticElement[] }> {
    this.logger.debug('Finding elements by text', { tabId, text });
    
    return await withRetry(async () => {
      // First, get the semantic model (or generate it if not cached)
      const { semanticModel } = await this.analyzePageSemantics(tabId);
      
      // Use the semantic analyzer to find elements by text
      const elements = await this.semanticAnalyzer.findElementsByText(semanticModel, text);
      
      return { elements };
    }, {
      name: `find elements containing "${text}" in tab ${tabId}`,
      maxRetries: 2
    });
  }

  /**
   * Find all interactive elements on the page
   */
  async findClickableElements(tabId: string): Promise<{ elements: SemanticElement[] }> {
    this.logger.debug('Finding clickable elements', { tabId });
    
    return await withRetry(async () => {
      // First, get the semantic model (or generate it if not cached)
      const { semanticModel } = await this.analyzePageSemantics(tabId);
      
      // Define clickable element types
      const clickableTypes = ['button', 'link', 'checkbox', 'radio', 'select'];
      
      // Use the semantic analyzer to find elements by type
      const elements = this.semanticAnalyzer.findElementsByType(
        semanticModel, 
        clickableTypes.map(type => type as any) // Cast to ElementType
      );
      
      return { elements };
    }, {
      name: `find clickable elements in tab ${tabId}`,
      maxRetries: 2
    });
  }

  /**
   * Click an element by its semantic ID
   */
  async clickSemanticElement(tabId: string, semanticId: string): Promise<{ success: boolean }> {
    this.logger.debug('Clicking semantic element', { tabId, semanticId });
    
    return await withRetry(async () => {
      // First, get the semantic model (or generate it if not cached)
      const { semanticModel } = await this.analyzePageSemantics(tabId);
      
      // Find the target element
      const element = semanticModel.find(el => el.semanticId === semanticId);
      
      if (!element) {
        throw new Error(`Element with semantic ID ${semanticId} not found`);
      }
      
      // Get a CSS selector for the element
      const selector = this.semanticAnalyzer.createSelector(element);
      
      // Click the element using existing method
      const result = await this.clickElement(tabId, selector);
      
      // Invalidate cache since page state has changed
      this.cacheSystem.invalidateTabCache(tabId);
      
      return result;
    }, {
      name: `click semantic element ${semanticId} in tab ${tabId}`,
      maxRetries: 3
    });
  }

  /**
   * Fill a form field by its semantic ID
   */
  async fillFormField(tabId: string, semanticId: string, value: string): Promise<{ success: boolean }> {
    this.logger.debug('Filling form field', { tabId, semanticId, valueLength: value.length });
    
    return await withRetry(async () => {
      try {
        // First, get the semantic model (or generate it if not cached)
        const { semanticModel } = await this.analyzePageSemantics(tabId);
        
        // Find the target element
        const element = semanticModel.find(el => el.semanticId === semanticId);
        
        if (!element) {
          throw new Error(`Element with semantic ID ${semanticId} not found`);
        }
        
        // Verify this is an input element
        if (!['input', 'select', 'textarea'].includes(element.elementType)) {
          throw new Error(`Element is not a form field: ${element.elementType}`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Get a CSS selector for the element
        const selector = this.semanticAnalyzer.createSelector(element);
        
        // Fill the field with security enhancements
        const result = await client.Runtime.evaluate({
          expression: `
            (function() {
              try {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) return { success: false, error: 'Element not found' };
                
                // Check if the element is a select
                if (element.tagName === 'SELECT') {
                  // Find option with matching text or value
                  let option = Array.from(element.options).find(opt => 
                    opt.text === ${JSON.stringify(value)} || opt.value === ${JSON.stringify(value)}
                  );
                  
                  if (option) {
                    element.value = option.value;
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    return { success: false, error: 'Option not found' };
                  }
                } else {
                  // For text inputs and textareas
                  element.value = ${JSON.stringify(value)};
                  element.dispatchEvent(new Event('input', { bubbles: true }));
                  element.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                return { success: true };
              } catch (error) {
                return { success: false, error: error.message };
              }
            })()
          `,
          returnByValue: true
        });
        
        const fillResult = result.result.value as { success: boolean, error?: string };
        
        if (!fillResult.success) {
          throw new Error(`Failed to fill form field: ${fillResult.error}`);
        }
        
        // Invalidate cache since form state has changed
        this.cacheSystem.invalidateTabCache(tabId);
        
        return { success: true };
      } catch (error) {
        this.logger.error('Fill form field error', { tabId, semanticId, error });
        throw new Error(`Failed to fill form field: ${error.message}`);
      }
    }, {
      name: `fill form field ${semanticId} in tab ${tabId}`,
      maxRetries: 2
    });
  }

  /**
   * Use the page's search functionality
   */
  async performSearch(tabId: string, query: string): Promise<{ success: boolean }> {
    this.logger.debug('Performing search', { tabId, query });
    
    return await withRetry(async () => {
      try {
        // Verify tab exists
        if (!this.tabManager.hasTab(tabId)) {
          throw new Error(`Tab ${tabId} not found`);
        }
        
        // Get the client
        const client = this.tabManager.getTabClient(tabId);
        
        // Enhanced security: Sanitize the search query
        const sanitizedQuery = query.replace(/[<>"'&]/g, '');
        
        // Simple implementation: find a search form or input and submit with query
        const result = await client.Runtime.evaluate({
          expression: `
            (function() {
              try {
                // Try to find a search form or input
                const searchInput = 
                  document.querySelector('input[type="search"]') || 
                  document.querySelector('input[name="q"]') ||
                  document.querySelector('input[name="query"]') ||
                  document.querySelector('input[name="search"]');
                
                if (!searchInput) {
                  return { success: false, error: 'No search input found' };
                }
                
                // Fill the search input
                searchInput.value = ${JSON.stringify(sanitizedQuery)};
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                
                // Find the form
                const form = searchInput.closest('form');
                
                if (form) {
                  // Submit the form
                  form.submit();
                } else {
                  // Try to simulate Enter key if no form
                  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }
                
                return { success: true };
              } catch (error) {
                return { success: false, error: error.message };
              }
            })()
          `,
          returnByValue: true
        });
        
        const searchResult = result.result.value as { success: boolean, error?: string };
        
        if (!searchResult.success) {
          throw new Error(`Failed to perform search: ${searchResult.error}`);
        }
        
        // Wait for navigation to complete with timeout
        await withTimeout(async () => {
          await new Promise<void>((resolve) => {
            const loadTimeout = setTimeout(() => {
              resolve(); // Don't reject on timeout, the search might not navigate
            }, 5000);
            
            client.Page.loadEventFired(() => {
              clearTimeout(loadTimeout);
              resolve();
            });
          });
        }, {
          name: `wait for search navigation in tab ${tabId}`,
          timeoutMs: 7000 // A bit longer than the internal timeout
        });
        
        // Invalidate cache since page has changed
        this.cacheSystem.invalidateTabCache(tabId);
        
        return { success: true };
      } catch (error) {
        this.logger.error('Search error', { tabId, query, error });
        throw new Error(`Failed to perform search: ${error.message}`);
      }
    }, {
      name: `perform search for "${query}" in tab ${tabId}`,
      maxRetries: 2
    });
  }
  
  /**
   * Clean up resources when shutting down
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Chrome API resources...');
    
    try {
      // Get all tabs
      const tabs = await this.tabManager.getAllTabs();
      
      // Close all tabs
      for (const tab of tabs) {
        try {
          this.logger.debug(`Closing tab ${tab.id} during cleanup`);
          await this.closeTab(tab.id);
        } catch (error) {
          this.logger.warn(`Error closing tab ${tab.id} during cleanup:`, error);
        }
      }
      
      // Additional cleanup
      this.cacheSystem.clear();
      
      this.logger.info('Chrome API resources cleaned up successfully');
    } catch (error) {
      this.logger.error('Error during Chrome API cleanup:', error);
      throw error;
    }
  }
}
