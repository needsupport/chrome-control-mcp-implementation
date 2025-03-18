/**
 * Chrome API
 * 
 * Main implementation of the Chrome Control MCP API.
 * This class integrates all the components (TabManager, DOMObserver, CacheSystem, etc.)
 * to provide a comprehensive, efficient interface for controlling Chrome.
 */

import ChromeRemoteInterface from 'chrome-remote-interface';
import { TabInfo, PageContent, SemanticElement, ElementType, ContentType, ContentBlock } from '../types.js';
import { TabManager } from '../core/tab-manager.js';
import { DOMObserver } from '../dom/dom-mutation-observer.js';
import { CacheSystem } from '../cache/cache-system.js';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { Mutex } from 'async-mutex';

/**
 * Main API class for Chrome Control MCP
 */
export class ChromeAPI {
  private logger: Logger;
  private tabManager: TabManager;
  private domObserver: DOMObserver;
  private cacheSystem: CacheSystem;
  private apiMutex: Mutex = new Mutex(); // Added mutex for API operations

  constructor() {
    this.logger = new Logger('chrome-api');
    this.tabManager = new TabManager();
    this.domObserver = new DOMObserver();
    this.cacheSystem = new CacheSystem();
    
    // Connect the DOM observer to the cache system
    this.cacheSystem.connectDOMObserver(this.domObserver);
    
    // Set up global error handlers
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception in ChromeAPI', error);
    });
    
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection in ChromeAPI', { reason });
    });
  }

  /**
   * Initialize the Chrome API
   */
  async initialize(): Promise<{ status: string }> {
    const release = await this.apiMutex.acquire();
    
    try {
      this.logger.info('Initializing Chrome API');
      
      // Initialize the tab manager
      await this.tabManager.initialize();
      
      this.logger.info('Chrome API initialized successfully');
      return { status: 'initialized' };
    } catch (error) {
      this.logger.error('Failed to initialize Chrome API', error);
      throw new Error(`Initialization error: ${error.message}`);
    } finally {
      release();
    }
  }

  /**
   * Safely clean up resources
   */
  async cleanup(): Promise<void> {
    const release = await this.apiMutex.acquire();
    
    try {
      // Clean up tabs
      await this.tabManager.cleanup();
      
      // Clean up DOM observers
      await this.domObserver.cleanupAllTabs();
      
      // Clean up cache
      this.cacheSystem.dispose();
      
      this.logger.info('Chrome API cleanup complete');
    } catch (error) {
      this.logger.error('Error during cleanup', error);
    } finally {
      release();
    }
  }

  /**
   * Navigate to a URL in a new tab
   */
  async navigate(url: string): Promise<{ tabId: string; status: string }> {
    this.logger.info('Navigating to URL', { url });
    
    try {
      // Validate URL
      try {
        new URL(url); // Will throw if invalid URL
      } catch {
        // If it doesn't have a protocol, assume http://
        if (!url.match(/^[a-zA-Z]+:\/\//)) {
          url = 'http://' + url;
        } else {
          throw new Error('Invalid URL format');
        }
      }
      
      // Create a new tab via the tab manager
      const tabId = await this.tabManager.createTab(url);
      
      // Get the client for this tab
      const client = await this.tabManager.getTabClient(tabId);
      
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
    const cachedContent = await this.cacheSystem.get<string>(cacheKey);
    
    if (cachedContent) {
      this.logger.debug('Returning cached content', { tabId });
      return { content: cachedContent };
    }
    
    try {
      // Verify tab exists
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Get content via Runtime.evaluate
      const { result } = await client.Runtime.evaluate({
        expression: 'document.documentElement.outerHTML',
        returnByValue: true
      });
      
      const content = result.value as string;
      
      // Cache the content
      await this.cacheSystem.set(cacheKey, content, { tabId });
      
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
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Use a timeout to prevent hanging scripts
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Script execution timed out')), config.scriptTimeout || 30000);
      });
      
      // Execute the script with a timeout
      const executePromise = client.Runtime.evaluate({
        expression: script,
        returnByValue: true,
        awaitPromise: true
      });
      
      const { result } = await Promise.race([executePromise, timeoutPromise]) as any;
      
      // Check for JavaScript exceptions
      if (result.exceptionDetails) {
        const error = result.exceptionDetails.exception || result.exceptionDetails;
        throw new Error(`Script error: ${error.description || error.text || 'Unknown script error'}`);
      }
      
      // Invalidate cache since script may have modified page
      await this.cacheSystem.invalidateTabCache(tabId);
      
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
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Sanitize selector to prevent JS injection
      const sanitizedSelector = selector.replace(/["']/g, '\\$&');
      
      // First, try clicking via JavaScript
      const jsResult = await client.Runtime.evaluate({
        expression: `
          (function() {
            try {
              let element = null;
              
              // Try standard querySelector first
              try {
                element = document.querySelector("${sanitizedSelector}");
              } catch (selectorError) {
                // If it fails (might be XPath), try evaluation
                try {
                  const xpathResult = document.evaluate("${sanitizedSelector}", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                  element = xpathResult.singleNodeValue;
                } catch (xpathError) {
                  return { success: false, error: 'Invalid selector format' };
                }
              }
              
              if (!element) return { success: false, error: 'Element not found' };
              
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) {
                return { success: false, error: 'Element has zero dimensions' };
              }
              
              if (!element.isConnected) {
                return { success: false, error: 'Element is not connected to the DOM' };
              }
              
              // Check if element is visible
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return { success: false, error: 'Element is not visible' };
              }
              
              // Check if element is clickable (not disabled)
              if (element.hasAttribute('disabled')) {
                return { success: false, error: 'Element is disabled' };
              }
              
              // Scroll element into view if needed
              element.scrollIntoView({ behavior: 'instant', block: 'center' });
              
              // Finally, click the element
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
        await this.cacheSystem.invalidateTabCache(tabId);
        
        return { success: true };
      }
      
      // If JavaScript click failed, try CDP click
      this.logger.debug('JavaScript click failed, trying CDP', { error: jsClickResult.error });
      
      // Wait a moment to ensure the page is stable
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Find the element
      const { nodeId } = await client.DOM.querySelector({
        selector: sanitizedSelector,
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
      
      // Scroll to ensure element is in view
      await client.Runtime.evaluate({
        expression: `window.scrollTo({
          left: ${Math.max(0, x - window.innerWidth / 2)},
          top: ${Math.max(0, y - window.innerHeight / 2)},
          behavior: 'instant'
        });`
      });
      
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
      await this.cacheSystem.invalidateTabCache(tabId);
      
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
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
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
      await this.domObserver.stopObserving(tabId);
      
      // Clear cache entries for this tab
      await this.cacheSystem.invalidateTabCache(tabId);
      
      // Close tab via tab manager
      await this.tabManager.closeTab(tabId);
      
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
    const cachedContent = await this.cacheSystem.get<PageContent>(cacheKey);
    
    if (cachedContent) {
      this.logger.debug('Returning cached structured content', { tabId });
      return { content: cachedContent };
    }
    
    try {
      // Verify tab exists
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Extract structured content
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const title = document.title;
            const url = window.location.href;
            const meta = {};
            const mainContentBlocks = [];
            
            // Extract metadata
            document.querySelectorAll('meta').forEach(metaEl => {
              const name = metaEl.getAttribute('name') || metaEl.getAttribute('property');
              const content = metaEl.getAttribute('content');
              if (name && content) meta[name] = content;
            });
            
            // Helper function to create content blocks
            function createContentBlock(element, depth = 0) {
              if (!element || !element.tagName || depth > 5) return null;
              
              const tagName = element.tagName.toLowerCase();
              
              // Skip hidden elements
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return null;
              }
              
              // Determine type
              let type = 'other';
              let importance = 30;
              
              if (tagName.match(/^h[1-6]$/)) {
                type = 'heading';
                // Higher importance for h1, lower for h6
                importance = 100 - (parseInt(tagName.substring(1)) * 10);
              } else if (tagName === 'p') {
                type = 'paragraph';
                importance = 60;
              } else if (tagName === 'ul' || tagName === 'ol') {
                type = 'list';
                importance = 50;
              } else if (tagName === 'li') {
                type = 'listItem';
                importance = 40;
              } else if (tagName === 'table') {
                type = 'table';
                importance = 70;
              } else if (tagName === 'img') {
                type = 'image';
                importance = 60;
              } else if (tagName === 'a') {
                type = 'link';
                importance = 40;
              } else if (tagName === 'code' || tagName === 'pre') {
                type = 'code';
                importance = 70;
              } else if (tagName === 'blockquote') {
                type = 'quote';
                importance = 60;
              }
              
              // Extract text
              const text = element.textContent.trim();
              
              // Create block
              const block = {
                type,
                text,
                importance,
                children: []
              };
              
              // Process children recursively
              if (element.children.length > 0) {
                for (const child of element.children) {
                  const childBlock = createContentBlock(child, depth + 1);
                  if (childBlock) {
                    block.children.push(childBlock);
                  }
                }
              }
              
              return block;
            }
            
            // Find main content area
            const mainEl = 
              document.querySelector('main') || 
              document.querySelector('article') || 
              document.querySelector('#content') || 
              document.querySelector('.content') || 
              document.body;
            
            const mainContentBlock = createContentBlock(mainEl);
            
            // Find navigation
            const navElements = document.querySelectorAll('nav, [role="navigation"], header');
            const navigation = {
              links: [],
              menus: []
            };
            
            navElements.forEach(nav => {
              const links = Array.from(nav.querySelectorAll('a')).map(a => ({
                text: a.textContent.trim(),
                url: a.href,
                importance: 70
              }));
              
              if (links.length > 0) {
                navigation.links.push(...links);
                navigation.menus.push({
                  title: nav.getAttribute('aria-label') || '',
                  links
                });
              }
            });
            
            // Find forms
            const formElements = document.querySelectorAll('form');
            const forms = Array.from(formElements).map(form => {
              const fields = Array.from(form.querySelectorAll('input, select, textarea')).map(field => {
                const label = form.querySelector(`label[for="${field.id}"]`)?.textContent.trim() || '';
                
                return {
                  name: field.name || '',
                  label,
                  type: field.type || field.tagName.toLowerCase(),
                  required: field.required || false
                };
              });
              
              return {
                name: form.getAttribute('name') || '',
                action: form.action || '',
                method: form.method || 'get',
                fields
              };
            });
            
            return {
              title,
              url,
              metaData: meta,
              mainContent: mainContentBlock,
              navigation: navigation.links.length > 0 ? navigation : undefined,
              forms: forms.length > 0 ? forms : undefined
            };
          })()
        `,
        returnByValue: true
      });
      
      const content = result.value as PageContent;
      
      // Cache the content
      await this.cacheSystem.set(cacheKey, content, { tabId });
      
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
    const cachedModel = await this.cacheSystem.get<SemanticElement[]>(cacheKey);
    
    if (cachedModel) {
      this.logger.debug('Returning cached semantic model', { tabId });
      return { semanticModel: cachedModel };
    }
    
    try {
      // Verify tab exists
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Extract semantic model with comprehensive analysis
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const semanticElements = [];
            let idCounter = 0;
            
            // Helper function to analyze element's importance
            function calculateImportance(element) {
              let importance = 50; // Default importance
              
              // Heading importance
              if (element.tagName.match(/^H[1-6]$/i)) {
                const level = parseInt(element.tagName.substring(1));
                importance = 100 - (level * 10); // H1 = 90, H2 = 80, etc.
              }
              
              // Link importance based on position and size
              if (element.tagName === 'A') {
                const rect = element.getBoundingClientRect();
                if (rect.top < window.innerHeight / 2) {
                  importance += 10; // Links in the top half are more important
                }
                if (rect.width > 100 || rect.height > 50) {
                  importance += 10; // Larger links are more important
                }
              }
              
              // Button importance
              if (element.tagName === 'BUTTON' || 
                 (element.tagName === 'INPUT' && (element.type === 'button' || element.type === 'submit'))) {
                if (element.textContent.toLowerCase().includes('submit') || 
                    element.textContent.toLowerCase().includes('search') ||
                    element.textContent.toLowerCase().includes('login')) {
                  importance += 20; // Key action buttons are more important
                }
              }
              
              // Form field importance
              if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
                // Required fields are more important
                if (element.required) {
                  importance += 15;
                }
                
                // Fields with labels are more important
                const id = element.id;
                if (id && document.querySelector(`label[for="${id}"]`)) {
                  importance += 10;
                }
              }
              
              // Adjust by visibility
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              const isVisible = rect.width > 0 && rect.height > 0 && 
                              style.display !== 'none' &&
                              style.visibility !== 'hidden' &&
                              style.opacity !== '0';
              
              if (!isVisible) {
                importance = 0; // Not visible = not important
              }
              
              return Math.min(100, Math.max(0, importance)); // Clamp between 0-100
            }
            
            // Process interactive and semantic elements
            const selectors = [
              // Interactive elements
              'a', 'button', 'input', 'select', 'textarea', 'form',
              // Role-based elements
              '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
              '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="combobox"]',
              // Structural elements
              'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nav', 'header', 'footer',
              'main', 'section', 'article', 'aside'
            ];
            
            // Find all matching elements
            const elements = document.querySelectorAll(selectors.join(','));
            
            elements.forEach(element => {
              const tagName = element.tagName.toLowerCase();
              const semanticId = 'semantic-' + (idCounter++);
              const text = element.textContent.trim() || 
                           element.getAttribute('placeholder') || 
                           element.getAttribute('aria-label') || 
                           element.getAttribute('title') || 
                           element.getAttribute('alt') || 
                           '';
              
              // Determine element type
              let elementType;
              
              // Determine based on tag
              if (tagName === 'a') elementType = 'link';
              else if (tagName === 'button') elementType = 'button';
              else if (tagName === 'input') {
                const inputType = element.type;
                if (inputType === 'button' || inputType === 'submit') elementType = 'button';
                else if (inputType === 'checkbox') elementType = 'checkbox';
                else if (inputType === 'radio') elementType = 'radio';
                else elementType = 'input';
              }
              else if (tagName === 'select') elementType = 'select';
              else if (tagName === 'textarea') elementType = 'input';
              else if (tagName.match(/^h[1-6]$/)) elementType = 'heading';
              else if (tagName === 'nav') elementType = 'navigation';
              else if (tagName === 'form') elementType = 'form';
              else if (tagName === 'img') elementType = 'image';
              
              // Override based on role
              const role = element.getAttribute('role');
              if (role === 'button') elementType = 'button';
              else if (role === 'link') elementType = 'link';
              else if (role === 'checkbox') elementType = 'checkbox';
              else if (role === 'radio') elementType = 'radio';
              else if (role === 'navigation') elementType = 'navigation';
              
              // Default to 'other' if still not determined
              if (!elementType) elementType = 'other';
              
              // Get bounding box
              const rect = element.getBoundingClientRect();
              const boundingBox = {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left
              };
              
              // Determine if element is visible and clickable
              const style = window.getComputedStyle(element);
              const isVisible = rect.width > 0 && rect.height > 0 && 
                              style.display !== 'none' &&
                              style.visibility !== 'hidden' &&
                              style.opacity !== '0';
              
              const isClickable = isVisible && !element.disabled;
              
              // Gather attributes
              const attrs = {};
              Array.from(element.attributes).forEach(attr => {
                attrs[attr.name] = attr.value;
              });
              
              // Calculate importance
              const importance = calculateImportance(element);
              
              // Create semantic element
              const semanticElement = {
                semanticId,
                elementType,
                nodeId: 0, // Placeholder (CDP IDs aren't available in pure JS)
                backendNodeId: 0, // Placeholder
                text,
                importance,
                childIds: [],
                parentId: null,
                attributes: attrs,
                role: role || '',
                boundingBox,
                isVisible,
                isClickable
              };
              
              // Process parent/child relationships
              if (element.parentElement) {
                const parentSemanticId = element.parentElement.getAttribute('data-semantic-id');
                if (parentSemanticId) {
                  semanticElement.parentId = parentSemanticId;
                  
                  // Find parent and add this element as child
                  const parentIndex = semanticElements.findIndex(el => el.semanticId === parentSemanticId);
                  if (parentIndex >= 0) {
                    semanticElements[parentIndex].childIds.push(semanticId);
                  }
                }
              }
              
              // Tag element for future parent/child references
              element.setAttribute('data-semantic-id', semanticId);
              
              semanticElements.push(semanticElement);
            });
            
            // Clean up - remove data-semantic-id attributes
            document.querySelectorAll('[data-semantic-id]').forEach(el => {
              el.removeAttribute('data-semantic-id');
            });
            
            return semanticElements;
          })()
        `,
        returnByValue: true
      });
      
      const semanticModel = result.value as SemanticElement[];
      
      // Cache the model
      await this.cacheSystem.set(cacheKey, semanticModel, { tabId });
      
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
      
      // Sort by importance
      elements.sort((a, b) => b.importance - a.importance);
      
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
        clickableTypes.includes(element.elementType) && element.isClickable !== false
      );
      
      // Sort by importance
      elements.sort((a, b) => b.importance - a.importance);
      
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
      
      // Check if element is clickable
      if (element.isClickable === false) {
        throw new Error(`Element with semantic ID ${semanticId} is not clickable`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Create a CSS selector to find the element (based on attributes if possible)
      let selector = '';
      
      if (element.attributes && typeof element.attributes === 'object') {
        if (element.attributes.id) {
          selector = `#${element.attributes.id}`;
        } else if (element.attributes.name) {
          selector = `${element.elementType}[name="${element.attributes.name}"]`;
        } else if (element.attributes.class) {
          const classes = element.attributes.class.split(' ')
            .filter(c => c)
            .map(c => `.${c}`)
            .join('');
          selector = `${element.elementType}${classes}`;
        } else if (element.text) {
          // Create XPath that contains text (less reliable)
          selector = `//*[contains(text(),'${element.text.replace(/'/g, "\\'").substring(0, 50)}')]`;
        } else {
          throw new Error(`Cannot create reliable selector for element ${semanticId}`);
        }
      } else {
        throw new Error(`Element ${semanticId} has invalid attributes`);
      }
      
      // Click the element using existing method
      const result = await this.clickElement(tabId, selector);
      
      // Invalidate cache since page state has changed
      await this.cacheSystem.invalidateTabCache(tabId);
      
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
      
      // Check if element is visible and not disabled
      if (element.isVisible === false) {
        throw new Error(`Element with semantic ID ${semanticId} is not visible`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Create a selector for this element
      let selector = '';
      
      if (element.attributes && typeof element.attributes === 'object') {
        if (element.attributes.id) {
          selector = `#${element.attributes.id}`;
        } else if (element.attributes.name) {
          selector = `[name="${element.attributes.name}"]`;
        } else if (element.attributes.class) {
          const classes = element.attributes.class.split(' ')
            .filter(c => c)
            .map(c => `.${c}`)
            .join('');
          selector = `${element.elementType}${classes}`;
        } else {
          throw new Error(`Cannot create reliable selector for element ${semanticId}`);
        }
      } else {
        throw new Error(`Element ${semanticId} has invalid attributes`);
      }
      
      // Fill the field
      const result = await client.Runtime.evaluate({
        expression: `
          (function() {
            try {
              const element = document.querySelector(${JSON.stringify(selector)});
              if (!element) return { success: false, error: 'Element not found' };
              
              // Scroll into view
              element.scrollIntoView({ behavior: 'instant', block: 'center' });
              
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
      
      // Invalidate cache since page state has changed
      await this.cacheSystem.invalidateTabCache(tabId);
      
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
      // Verify tab exists
      if (!(await this.tabManager.hasTab(tabId))) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      // Get the client
      const client = await this.tabManager.getTabClient(tabId);
      
      // Simple implementation: find a search input and submit with query
      const result = await client.Runtime.evaluate({
        expression: `
          (function() {
            try {
              // Try to find a search form or input using multiple strategies
              let searchInput = null;
              
              // Strategy 1: Look for input with type="search"
              searchInput = document.querySelector('input[type="search"]');
              
              // Strategy 2: Look for common search input names
              if (!searchInput) {
                searchInput = document.querySelector('input[name="q"], input[name="query"], input[name="search"], input[name="s"]');
              }
              
              // Strategy 3: Look by role
              if (!searchInput) {
                searchInput = document.querySelector('[role="search"] input, form[role="search"] input');
              }
              
              // Strategy 4: Look for inputs within elements with search-related classes
              if (!searchInput) {
                const searchContainers = document.querySelectorAll('.search, .search-box, .search-form, .searchbox, .searchform');
                for (const container of searchContainers) {
                  const input = container.querySelector('input');
                  if (input) {
                    searchInput = input;
                    break;
                  }
                }
              }
              
              if (!searchInput) {
                return { success: false, error: 'No search input found' };
              }
              
              // Scroll to ensure input is in view
              searchInput.scrollIntoView({ behavior: 'instant', block: 'center' });
              
              // Focus and fill the search input
              searchInput.focus();
              searchInput.value = ${JSON.stringify(query)};
              searchInput.dispatchEvent(new Event('input', { bubbles: true }));
              searchInput.dispatchEvent(new Event('change', { bubbles: true }));
              
              // Find the form
              const form = searchInput.closest('form');
              
              if (form) {
                // Submit the form
                form.submit();
                return { success: true, method: 'form-submit' };
              } else {
                // Try to simulate Enter key if no form
                searchInput.dispatchEvent(new KeyboardEvent('keydown', { 
                  key: 'Enter', 
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true 
                }));
                return { success: true, method: 'enter-key' };
              }
            } catch (error) {
              return { success: false, error: error.message };
            }
          })()
        `,
        returnByValue: true
      });
      
      const searchResult = result.result.value as { success: boolean, error?: string, method?: string };
      
      if (!searchResult.success) {
        throw new Error(`Failed to perform search: ${searchResult.error}`);
      }
      
      this.logger.debug(`Search performed via ${searchResult.method}`, { tabId, query });
      
      // Wait for navigation to complete
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(); // Don't reject on timeout, the search might not navigate
        }, 5000);
        
        client.Page.loadEventFired(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      // Invalidate cache since page has changed
      await this.cacheSystem.invalidateTabCache(tabId);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Search error', { tabId, query, error });
      throw new Error(`Failed to perform search: ${error.message}`);
    }
  }
}
