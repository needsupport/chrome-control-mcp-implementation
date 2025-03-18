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
  
  constructor() {
    super();
    this.logger = new Logger('tab-manager');
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
          this.logger.warn(`Page load timeout for ${url}`);
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
    }
  }

  /**
   * Get a tab by ID
   */
  getTab(tabId: string): Tab | undefined {
    return this.tabs.get(tabId);
  }

  /**
   * Get all tabs
   */
  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Get a CDP client for a tab
   */
  getTabClient(tabId: string): ChromeRemoteInterface.Client {
    const session = this.sessions.get(tabId);
    
    if (!session) {
      throw new Error(`No session found for tab ${tabId}`);
    }
    
    return session.client;
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    
    if (!tab) {
      this.logger.warn(`Tab ${tabId} not found`);
      return false;
    }
    
    try {
      // Close the client session if it exists
      const session = this.sessions.get(tabId);
      if (session) {
        await session.client.close();
        this.sessions.delete(tabId);
      }
      
      // Close the target
      await ChromeRemoteInterface.Close({ 
        port: config.chromeDebuggingPort, 
        id: tabId 
      });
      
      // Remove tab from tracking
      this.tabs.delete(tabId);
      
      this.logger.info(`Closed tab: ${tabId}`);
      
      // Emit event
      this.emit('tabClosed', tab);
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to close tab ${tabId}`, error);
      throw error;
    }
  }

  /**
   * Refresh tab information
   */
  async refreshTabInfo(tabId: string): Promise<Tab> {
    const tab = this.tabs.get(tabId);
    
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`);
    }
    
    try {
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
    }
  }

  /**
   * Check if a tab exists
   */
  hasTab(tabId: string): boolean {
    return this.tabs.has(tabId);
  }

  /**
   * Clean up and close all tabs
   */
  async cleanup(): Promise<void> {
    for (const tabId of this.tabs.keys()) {
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
  }
}
