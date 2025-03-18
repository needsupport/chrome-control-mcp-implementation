/**
 * DOM Mutation Observer
 * 
 * Observes DOM changes in Chrome tabs and emits events when mutations occur.
 * This allows the system to be aware of dynamic content changes without constant polling.
 */

import { EventEmitter } from 'events';
import ChromeRemoteInterface from 'chrome-remote-interface';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { Mutex } from 'async-mutex';

export interface MutationEvent {
  tabId: string;
  type: 'childList' | 'attributes' | 'characterData';
  timestamp: number;
  targetNodeId?: number;
}

export class DOMObserver extends EventEmitter {
  private logger: Logger;
  private observedTabs: Map<string, { 
    client: ChromeRemoteInterface.Client, 
    listeners: Function[],
    active: boolean 
  }> = new Map();
  private mutex: Mutex = new Mutex(); // Added mutex for observer operations

  constructor() {
    super();
    this.logger = new Logger('dom-observer');

    // Set maximum event listeners to avoid memory leaks
    this.setMaxListeners(100);
  }

  /**
   * Start observing a tab for DOM mutations
   */
  async observeTab(tabId: string, client: ChromeRemoteInterface.Client): Promise<void> {
    const release = await this.mutex.acquire();
    
    try {
      // First check if already being observed and clean up if needed
      if (this.observedTabs.has(tabId)) {
        this.logger.debug(`Tab ${tabId} is already being observed, cleaning up first`);
        await this.stopObserving(tabId);
      }

      try {
        // Make sure DOM domain is enabled
        await client.DOM.enable();
        
        // Set up event listeners for DOM mutations
        const listeners: Function[] = [];
        
        // Child list mutations (additions/removals)
        const childNodeInsertedListener = client.DOM.childNodeInserted((params) => {
          this.emit('mutation', {
            tabId,
            type: 'childList',
            timestamp: Date.now(),
            targetNodeId: params.parentNodeId
          } as MutationEvent);
        });
        listeners.push(() => {
          try {
            childNodeInsertedListener.dispose();
          } catch (error) {
            this.logger.debug(`Error disposing childNodeInsertedListener: ${error.message}`);
          }
        });
        
        const childNodeRemovedListener = client.DOM.childNodeRemoved((params) => {
          this.emit('mutation', {
            tabId,
            type: 'childList',
            timestamp: Date.now(),
            targetNodeId: params.parentNodeId
          } as MutationEvent);
        });
        listeners.push(() => {
          try {
            childNodeRemovedListener.dispose();
          } catch (error) {
            this.logger.debug(`Error disposing childNodeRemovedListener: ${error.message}`);
          }
        });
        
        // Attribute mutations
        const attributeModifiedListener = client.DOM.attributeModified((params) => {
          this.emit('mutation', {
            tabId,
            type: 'attributes',
            timestamp: Date.now(),
            targetNodeId: params.nodeId
          } as MutationEvent);
        });
        listeners.push(() => {
          try {
            attributeModifiedListener.dispose();
          } catch (error) {
            this.logger.debug(`Error disposing attributeModifiedListener: ${error.message}`);
          }
        });
        
        const attributeRemovedListener = client.DOM.attributeRemoved((params) => {
          this.emit('mutation', {
            tabId,
            type: 'attributes',
            timestamp: Date.now(),
            targetNodeId: params.nodeId
          } as MutationEvent);
        });
        listeners.push(() => {
          try {
            attributeRemovedListener.dispose();
          } catch (error) {
            this.logger.debug(`Error disposing attributeRemovedListener: ${error.message}`);
          }
        });
        
        // Character data mutations (text changes)
        const characterDataModifiedListener = client.DOM.characterDataModified((params) => {
          this.emit('mutation', {
            tabId,
            type: 'characterData',
            timestamp: Date.now(),
            targetNodeId: params.nodeId
          } as MutationEvent);
        });
        listeners.push(() => {
          try {
            characterDataModifiedListener.dispose();
          } catch (error) {
            this.logger.debug(`Error disposing characterDataModifiedListener: ${error.message}`);
          }
        });
        
        // Add document update listener for more complex changes
        const documentUpdatedListener = client.DOM.documentUpdated(() => {
          this.emit('mutation', {
            tabId,
            type: 'childList', // Treat as a major childList change
            timestamp: Date.now()
          } as MutationEvent);
        });
        listeners.push(() => {
          try {
            documentUpdatedListener.dispose();
          } catch (error) {
            this.logger.debug(`Error disposing documentUpdatedListener: ${error.message}`);
          }
        });
        
        // Store the tab and its listeners
        this.observedTabs.set(tabId, { 
          client, 
          listeners,
          active: true 
        });
        
        this.logger.info(`Started observing DOM mutations for tab ${tabId}`);
      } catch (error) {
        this.logger.error(`Failed to start observing tab ${tabId}`, error);
        throw error;
      }
    } finally {
      release();
    }
  }

  /**
   * Stop observing a tab for DOM mutations
   */
  async stopObserving(tabId: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    
    try {
      const tabData = this.observedTabs.get(tabId);
      
      if (!tabData) {
        this.logger.debug(`Tab ${tabId} is not being observed`);
        return false;
      }

      // Set active to false first to prevent new emits during cleanup
      tabData.active = false;
      
      // Dispose all listeners
      for (const disposeListener of tabData.listeners) {
        try {
          disposeListener();
        } catch (error) {
          this.logger.warn(`Error disposing listener for tab ${tabId}`, error);
        }
      }
      
      // Explicitly clean up client reference
      if (tabData.client) {
        try {
          await tabData.client.DOM.disable();
        } catch (error) {
          this.logger.warn(`Error disabling DOM domain for tab ${tabId}`, error);
        }
      }
      
      // Remove the tab from observed tabs
      this.observedTabs.delete(tabId);
      
      this.logger.info(`Stopped observing DOM mutations for tab ${tabId}`);
      return true;
    } finally {
      release();
    }
  }

  /**
   * Check if a tab is being observed
   */
  isObserving(tabId: string): boolean {
    const tabData = this.observedTabs.get(tabId);
    return !!tabData && tabData.active;
  }

  /**
   * Get the list of tabs being observed
   */
  getObservedTabs(): string[] {
    return Array.from(this.observedTabs.entries())
      .filter(([_, data]) => data.active)
      .map(([tabId, _]) => tabId);
  }

  /**
   * Cleanup all resources when shutting down
   */
  async cleanupAllTabs(): Promise<void> {
    const release = await this.mutex.acquire();
    
    try {
      const tabs = Array.from(this.observedTabs.keys());
      for (const tabId of tabs) {
        await this.stopObserving(tabId);
      }
      
      // Remove all listeners
      this.removeAllListeners();
      
      this.logger.info('All DOM observers cleaned up');
    } finally {
      release();
    }
  }
}
