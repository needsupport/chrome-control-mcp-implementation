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

/**
 * Main API class for Chrome Control MCP
 */
export class ChromeAPI {
  private logger: Logger;
  private tabManager: TabManager;
  private domObserver: DOMObserver;
  private cacheSystem: CacheSystem;

  constructor() {
    this.logger = new Logger('chrome-api');
    this.tabManager = new TabManager();
    this.domObserver = new DOMObserver();
    this.cacheSystem = new CacheSystem();
    
    // Connect the DOM observer to the cache system
    this.cacheSystem.connectDOMObserver(this.domObserver);
  }

  /**
   * Initialize the Chrome API
   */
  async initialize(): Promise<{ status: string }> {
    this.logger.info('Initializing Chrome API');
    
    try {
      // Initialize the tab manager
      await this.tabManager.initialize();
      
      this.logger.info('Chrome API initialized successfully');
      return { status: 'initialized' };
    } catch (error) {
      this.logger.error('Failed to initialize Chrome API', error);
      throw new Error(`Initialization error: ${error.message}`);
    }
  }

  /**
   * Navigate to a URL in a new tab
   */
  async navigate(url: string): Promise<{ tabId: string; status: string }> {
    this.logger.info('Navigating to URL', { url });
    
    try {
      // Create a new tab via the tab manager
      const tabId = await this.tabManager.createTab(url);
      
      // Get the client for this tab
      const client = this.tabManager.getTabClient(tabId);
      
      // Start observing DOM mutations for this tab
      await this.domObserver.observeTab(tabId, client);
      
      this.logger.info('Navigation successful', { tabId, url });
      return { tabId, status: 'loaded' };
    } catch (error) {
      this.logger.error('Navigation error', { url, error });
      throw new Error(`Failed to navigate to ${url}: ${error.message}`);
    }
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
    
    try {
      // Verify tab exists
      if (!this.tabManager.hasTab(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // Get content via Runtime.evaluate
      const { result } = await client.Runtime.evaluate({
        expression: 'document.documentElement.outerHTML',
        returnByValue: true
      });
      
      const content = result.value as string;
      
      // Cache the content
      this.cacheSystem.set(cacheKey, content, { tabId });
      
      return { content };
    } catch (error) {
      this.logger.error('Error getting content', { tabId, error });
      throw new Error(`Failed to get page content: ${error.message}`);
    }
  }

  /**
   * Execute JavaScript code in a tab
   */
  async executeScript(tabId: string, script: string): Promise<{ result: unknown }> {
    this.logger.debug('Executing script', { tabId, scriptLength: script.length });
    
    try {
      // Verify tab exists
      if (!this.tabManager.hasTab(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // Execute the script
      const { result } = await client.Runtime.evaluate({
        expression: script,
        returnByValue: true,
        awaitPromise: true
      });
      
      return { result: result.value };
    } catch (error) {
      this.logger.error('Script execution error', { tabId, error });
      throw new Error(`Failed to execute script: ${error.message}`);
    }
  }

  /**
   * Click on an element matching a CSS selector
   */
  async clickElement(tabId: string, selector: string): Promise<{ success: boolean }> {
    this.logger.debug('Clicking element', { tabId, selector });
    
    try {
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
    } catch (error) {
      this.logger.error('Click error', { tabId, selector, error });
      throw new Error(`Failed to click element: ${error.message}`);
    }
  }

  /**
   * Capture a screenshot of the page
   */
  async takeScreenshot(tabId: string): Promise<{ data: string }> {
    this.logger.debug('Taking screenshot', { tabId });
    
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
    this.logger.debug('Getting structured content', { tabId });
    
    // Check cache first
    const cacheKey = `structured-content:${tabId}`;
    const cachedContent = this.cacheSystem.get<PageContent>(cacheKey);
    
    if (cachedContent) {
      this.logger.debug('Returning cached structured content', { tabId });
      return { content: cachedContent };
    }
    
    try {
      // Verify tab exists
      if (!this.tabManager.hasTab(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // Extract structured content (placeholder)
      // In a real implementation, this would use ContentExtractor and SemanticAnalyzer
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const title = document.title;
            const url = window.location.href;
            const meta = {};
            
            // Extract metadata
            document.querySelectorAll('meta').forEach(metaEl => {
              const name = metaEl.getAttribute('name') || metaEl.getAttribute('property');
              const content = metaEl.getAttribute('content');
              if (name && content) meta[name] = content;
            });
            
            // Extract main content (simple implementation)
            const mainEl = document.querySelector('main') || document.querySelector('article') || document.body;
            const mainText = mainEl.textContent.trim();
            
            return {
              title,
              url,
              metaData: meta,
              mainContent: {
                type: 'text',
                text: mainText,
                importance: 90,
                children: []
              }
            };
          })()
        `,
        returnByValue: true
      });
      
      const content = result.value as PageContent;
      
      // Cache the content
      this.cacheSystem.set(cacheKey, content, { tabId });
      
      return { content };
    } catch (error) {
      this.logger.error('Structured content error', { tabId, error });
      throw new Error(`Failed to get structured content: ${error.message}`);
    }
  }

  /**
   * Analyze the page and build a semantic DOM model
   */
  async analyzePageSemantics(tabId: string): Promise<{ semanticModel: SemanticElement[] }> {
    this.logger.debug('Analyzing page semantics', { tabId });
    
    // Check cache first
    const cacheKey = `semantic-model:${tabId}`;
    const cachedModel = this.cacheSystem.get<SemanticElement[]>(cacheKey);
    
    if (cachedModel) {
      this.logger.debug('Returning cached semantic model', { tabId });
      return { semanticModel: cachedModel };
    }
    
    try {
      // Verify tab exists
      if (!this.tabManager.hasTab(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // Extract semantic model (placeholder)
      // In a real implementation, this would use SemanticAnalyzer
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const semanticElements = [];
            const idCounter = 0;
            
            // Process interactive elements
            document.querySelectorAll('a, button, input, select, textarea').forEach(el => {
              const id = 'semantic-' + (idCounter++);
              const tagName = el.tagName.toLowerCase();
              const text = el.textContent.trim() || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
              
              let type = 'other';
              if (tagName === 'a') type = 'link';
              else if (tagName === 'button') type = 'button';
              else if (tagName === 'input') {
                const inputType = el.type;
                if (inputType === 'button' || inputType === 'submit') type = 'button';
                else if (inputType === 'checkbox') type = 'checkbox';
                else if (inputType === 'radio') type = 'radio';
                else type = 'input';
              }
              else if (tagName === 'select') type = 'select';
              else if (tagName === 'textarea') type = 'input';
              
              // Gather attributes
              const attrs = {};
              Array.from(el.attributes).forEach(attr => {
                attrs[attr.name] = attr.value;
              });
              
              // Create semantic element
              semanticElements.push({
                semanticId: id,
                elementType: type,
                nodeId: 0, // Placeholder (CDP IDs aren't available in pure JS)
                backendNodeId: 0, // Placeholder
                text,
                importance: type === 'link' || type === 'button' ? 80 : 50,
                childIds: [],
                attributes: attrs,
                role: el.getAttribute('role') || ''
              });
            });
            
            return semanticElements;
          })()
        `,
        returnByValue: true
      });
      
      const semanticModel = result.value as SemanticElement[];
      
      // Cache the model
      this.cacheSystem.set(cacheKey, semanticModel, { tabId });
      
      return { semanticModel };
    } catch (error) {
      this.logger.error('Semantic analysis error', { tabId, error });
      throw new Error(`Failed to analyze page semantics: ${error.message}`);
    }
  }

  /**
   * Find elements containing specific text
   */
  async findElementsByText(tabId: string, text: string): Promise<{ elements: SemanticElement[] }> {
    this.logger.debug('Finding elements by text', { tabId, text });
    
    try {
      // First, get the semantic model (or generate it if not cached)
      const { semanticModel } = await this.analyzePageSemantics(tabId);
      
      // Filter for elements containing the specified text
      const elements = semanticModel.filter(element => 
        element.text.toLowerCase().includes(text.toLowerCase())
      );
      
      return { elements };
    } catch (error) {
      this.logger.error('Find elements by text error', { tabId, text, error });
      throw new Error(`Failed to find elements by text: ${error.message}`);
    }
  }

  /**
   * Find all interactive elements on the page
   */
  async findClickableElements(tabId: string): Promise<{ elements: SemanticElement[] }> {
    this.logger.debug('Finding clickable elements', { tabId });
    
    try {
      // First, get the semantic model (or generate it if not cached)
      const { semanticModel } = await this.analyzePageSemantics(tabId);
      
      // Define clickable element types
      const clickableTypes = ['button', 'link', 'checkbox', 'radio', 'select'];
      
      // Filter for clickable elements
      const elements = semanticModel.filter(element => 
        clickableTypes.includes(element.elementType)
      );
      
      return { elements };
    } catch (error) {
      this.logger.error('Find clickable elements error', { tabId, error });
      throw new Error(`Failed to find clickable elements: ${error.message}`);
    }
  }

  /**
   * Click an element by its semantic ID
   */
  async clickSemanticElement(tabId: string, semanticId: string): Promise<{ success: boolean }> {
    this.logger.debug('Clicking semantic element', { tabId, semanticId });
    
    try {
      // First, get the semantic model (or generate it if not cached)
      const { semanticModel } = await this.analyzePageSemantics(tabId);
      
      // Find the target element
      const element = semanticModel.find(el => el.semanticId === semanticId);
      
      if (!element) {
        throw new Error(`Element with semantic ID ${semanticId} not found`);
      }
      
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // Create a css selector to find the element (based on attributes if possible)
      let selector = '';
      if (element.attributes.id) {
        selector = `#${element.attributes.id}`;
      } else if (element.attributes.class) {
        const classes = element.attributes.class.split(' ').map(c => `.${c}`).join('');
        selector = `${element.elementType}${classes}`;
      } else {
        // Custom selector that contains text (less reliable)
        selector = `//*[contains(text(),'${element.text}')]`;
      }
      
      // Click the element using existing method
      const result = await this.clickElement(tabId, selector);
      
      // Invalidate cache since page state has changed
      this.cacheSystem.invalidateTabCache(tabId);
      
      return result;
    } catch (error) {
      this.logger.error('Click semantic element error', { tabId, semanticId, error });
      throw new Error(`Failed to click semantic element: ${error.message}`);
    }
  }

  /**
   * Fill a form field by its semantic ID
   */
  async fillFormField(tabId: string, semanticId: string, value: string): Promise<{ success: boolean }> {
    this.logger.debug('Filling form field', { tabId, semanticId, valueLength: value.length });
    
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
      
      // Create a selector for this element (similar to clickSemanticElement)
      let selector = '';
      if (element.attributes.id) {
        selector = `#${element.attributes.id}`;
      } else if (element.attributes.name) {
        selector = `[name="${element.attributes.name}"]`;
      } else if (element.attributes.class) {
        const classes = element.attributes.class.split(' ').map(c => `.${c}`).join('');
        selector = `${element.elementType}${classes}`;
      } else {
        throw new Error(`Cannot create reliable selector for element ${semanticId}`);
      }
      
      // Fill the field
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
      
      return { success: true };
    } catch (error) {
      this.logger.error('Fill form field error', { tabId, semanticId, error });
      throw new Error(`Failed to fill form field: ${error.message}`);
    }
  }

  /**
   * Use the page's search functionality
   */
  async performSearch(tabId: string, query: string): Promise<{ success: boolean }> {
    this.logger.debug('Performing search', { tabId, query });
    
    try {
      // Get the client
      const client = this.tabManager.getTabClient(tabId);
      
      // Simple implementation: find a search input and submit with query
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
              searchInput.value = ${JSON.stringify(query)};
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
      
      // Wait for navigation to complete
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(); // Don't reject on timeout, the search might not navigate
        }, 5000);
        
        client.Page.loadEventFired(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      // Invalidate cache since page has changed
      this.cacheSystem.invalidateTabCache(tabId);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Search error', { tabId, query, error });
      throw new Error(`Failed to perform search: ${error.message}`);
    }
  }
}
