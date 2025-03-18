/**
 * Tab Manager
 * 
 * Manages browser tabs, including creation, tracking, and closing.
 * Provides a centralized way to handle tabs across the application.
 */

import ChromeRemoteInterface from 'chrome-remote-interface';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { EventEmitter } from 'events';
import { Mutex } from 'async-mutex';

export interface Tab {
  id: string;
  title: string;
  url: string;
  created: number;
}

export interface TabSession {
  client: ChromeRemoteInterface.Client;
  domains: {
    DOM: boolean;
    Page: boolean;
    Runtime: boolean;
    Network: boolean;
  };
}

export class TabManager extends EventEmitter {
  private logger: Logger;
  private tabs: Map<string, Tab> = new Map();
  private sessions: Map<string, TabSession> = new Map();
  private mainConnection: ChromeRemoteInterface.Client | null = null;
  private tabMutex: Mutex = new Mutex(); // Added mutex for tab operations
  
  constructor() {
    super();
    this.logger = new Logger('tab-manager');
    
    // Set up global unhandled error handlers
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception in TabManager', error);
    });
    
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection in TabManager', { reason });
    });
  }

  /**
   * Initialize the TabManager with Chrome DevTools Protocol
   */
  async initialize(): Promise<void> {
    try {
      // Check if Chrome is accessible
      const targets = await ChromeRemoteInterface.List({ port: config.chromeDebuggingPort });
      
      if (targets.length === 0) {
        throw new Error('No Chrome targets found. Make sure Chrome is running with remote debugging enabled.');
      }
      
      // Create a main connection for administrative operations
      this.mainConnection = await ChromeRemoteInterface({ port: config.chromeDebuggingPort });
      
      this.logger.info('TabManager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize TabManager', error);
      throw error;
    }
  }

  /**
   * Create a new tab
   */
  async createTab(url: string): Promise<string> {
    if (!this.mainConnection) {
      throw new Error('TabManager not initialized');
    }
    
    // Acquire lock before tab creation to prevent race conditions
    const release = await this.tabMutex.acquire();
    
    try {
      // Create a new target/tab
      const { targetId } = await ChromeRemoteInterface.New({ 
        port: config.chromeDebuggingPort,
        url: url
      });
      
      // Create a CDP client for this tab
      const client = await ChromeRemoteInterface({ 
        port: config.chromeDebuggingPort, 
        target: targetId 
      });
      
      // Enable necessary domains
      await Promise.all([
        client.Page.enable(),
        client.DOM.enable(),
        client.Runtime.enable(),
        client.Network.enable()
      ]);
      
      // Wait for page load
      await new Promise<void>((resolve) => {
        const loadTimeout = setTimeout(() => {
          this.logger.warn(`Page load timeout for ${url} - continuing anyway`);
          resolve();
        }, config.navigationTimeout);
        
        client.Page.loadEventFired(() => {
          clearTimeout(loadTimeout);
          resolve();
        });
      });
      
      // Get page info
      const { result } = await client.Runtime.evaluate({
        expression: 'JSON.stringify({ title: document.title, url: window.location.href })',
        returnByValue: true
      });
      
      const pageInfo = JSON.parse(result.value as string);
      
      // Store tab information
      const tab: Tab = {
        id: targetId,
        title: pageInfo.title || url,
        url: pageInfo.url || url,
        created: Date.now()
      };
      
      this.tabs.set(targetId, tab);
      
      // Store session
      this.sessions.set(targetId, {
        client,
        domains: {
          DOM: true,
          Page: true,
          Runtime: true,
          Network: true
        }
      });
      
      this.logger.info(`Created new tab: ${targetId} - ${url}`);
      
      // Emit event
      this.emit('tabCreated', tab);
      
      return targetId;
    } catch (error) {
      this.logger.error(`Failed to create tab for ${url}`, error);
      throw error;
    } finally {
      // Always release the lock
      release();
    }
  }

  /**
   * Get a tab by ID
   */
  async getTab(tabId: string): Promise<Tab | undefined> {
    const release = await this.tabMutex.acquire();
    try {
      return this.tabs.get(tabId);
    } finally {
      release();
    }
  }

  /**
   * Get all tabs
   */
  async getAllTabs(): Promise<Tab[]> {
    const release = await this.tabMutex.acquire();
    try {
      return Array.from(this.tabs.values());
    } finally {
      release();
    }
  }

  /**
   * Get a CDP client for a tab
   */
  async getTabClient(tabId: string): Promise<ChromeRemoteInterface.Client> {
    const release = await this.tabMutex.acquire();
    
    try {
      const session = this.sessions.get(tabId);
      
      if (!session) {
        throw new Error(`No session found for tab ${tabId}`);
      }
      
      return session.client;
    } finally {
      release();
    }
  }

  /**
   * Check if a tab exists
   */
  async hasTab(tabId: string): Promise<boolean> {
    const release = await this.tabMutex.acquire();
    try {
      return this.tabs.has(tabId);
    } finally {
      release();
    }
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<boolean> {
    const release = await this.tabMutex.acquire();
    
    try {
      const tab = this.tabs.get(tabId);
      
      if (!tab) {
        this.logger.warn(`Tab ${tabId} not found`);
        return false;
      }
      
      // Close the client session if it exists
      const session = this.sessions.get(tabId);
      if (session) {
        try {
          // Disable all domains first to ensure cleanup
          if (session.domains.DOM) {
            await session.client.DOM.disable();
          }
          if (session.domains.Page) {
            await session.client.Page.disable();
          }
          if (session.domains.Runtime) {
            await session.client.Runtime.disable();
          }
          if (session.domains.Network) {
            await session.client.Network.disable();
          }
          
          await session.client.close();
        } catch (closeError) {
          // Just log errors during close, don't throw
          this.logger.warn(`Error closing CDP client for tab ${tabId}`, closeError);
        }
        
        this.sessions.delete(tabId);
      }
      
      // Close the target
      try {
        await ChromeRemoteInterface.Close({ 
          port: config.chromeDebuggingPort, 
          id: tabId 
        });
      } catch (closeError) {
        this.logger.warn(`Error closing target for tab ${tabId}`, closeError);
      }
      
      // Remove tab from tracking
      this.tabs.delete(tabId);
      
      this.logger.info(`Closed tab: ${tabId}`);
      
      // Emit event
      this.emit('tabClosed', tab);
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to close tab ${tabId}`, error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Refresh tab information
   */
  async refreshTabInfo(tabId: string): Promise<Tab> {
    const release = await this.tabMutex.acquire();
    
    try {
      const tab = this.tabs.get(tabId);
      
      if (!tab) {
        throw new Error(`Tab ${tabId} not found`);
      }
      
      const session = this.sessions.get(tabId);
      
      if (!session) {
        throw new Error(`No session found for tab ${tabId}`);
      }
      
      // Get updated page info
      const { result } = await session.client.Runtime.evaluate({
        expression: 'JSON.stringify({ title: document.title, url: window.location.href })',
        returnByValue: true
      });
      
      const pageInfo = JSON.parse(result.value as string);
      
      // Update tab information
      const updatedTab: Tab = {
        ...tab,
        title: pageInfo.title,
        url: pageInfo.url
      };
      
      this.tabs.set(tabId, updatedTab);
      
      return updatedTab;
    } catch (error) {
      this.logger.error(`Failed to refresh tab info for ${tabId}`, error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Clean up and close all tabs
   */
  async cleanup(): Promise<void> {
    const release = await this.tabMutex.acquire();
    
    try {
      const tabIds = [...this.tabs.keys()];
      
      for (const tabId of tabIds) {
        try {
          await this.closeTab(tabId);
        } catch (error) {
          this.logger.warn(`Error closing tab ${tabId} during cleanup`, error);
        }
      }
      
      // Close the main connection
      if (this.mainConnection) {
        await this.mainConnection.close();
        this.mainConnection = null;
      }
      
      this.logger.info('TabManager cleanup complete');
    } finally {
      release();
    }
  }
}
