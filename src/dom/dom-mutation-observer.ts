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

interface BoundEventHandler {
  event: string;
  handler: Function;
}

interface ObservedTab {
  client: ChromeRemoteInterface.Client;
  boundHandlers: BoundEventHandler[];
  active: boolean;
}

export class DOMObserver extends EventEmitter {
  private logger: Logger;
  private observedTabs: Map<string, ObservedTab> = new Map();
  private mutex: Mutex = new Mutex();

  constructor() {
    super();
    this.logger = new Logger('dom-observer');
  }

  /**
   * Start observing a tab for DOM mutations
   */
  async observeTab(tabId: string, client: ChromeRemoteInterface.Client): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      if (this.observedTabs.has(tabId)) {
        this.logger.debug(`Tab ${tabId} is already being observed`);
        return;
      }

      try {
        // Make sure DOM domain is enabled
        await client.DOM.enable();
        
        // Set up event listeners for DOM mutations
        const boundHandlers: BoundEventHandler[] = [];
        
        // Child list mutations (additions/removals)
        const childNodeInsertedHandler = this.createMutationHandler(tabId, 'childList');
        client.DOM.on('childNodeInserted', childNodeInsertedHandler);
        boundHandlers.push({
          event: 'childNodeInserted',
          handler: childNodeInsertedHandler
        });
        
        const childNodeRemovedHandler = this.createMutationHandler(tabId, 'childList');
        client.DOM.on('childNodeRemoved', childNodeRemovedHandler);
        boundHandlers.push({
          event: 'childNodeRemoved',
          handler: childNodeRemovedHandler
        });
        
        // Attribute mutations
        const attributeModifiedHandler = this.createMutationHandler(tabId, 'attributes');
        client.DOM.on('attributeModified', attributeModifiedHandler);
        boundHandlers.push({
          event: 'attributeModified',
          handler: attributeModifiedHandler
        });
        
        const attributeRemovedHandler = this.createMutationHandler(tabId, 'attributes');
        client.DOM.on('attributeRemoved', attributeRemovedHandler);
        boundHandlers.push({
          event: 'attributeRemoved',
          handler: attributeRemovedHandler
        });
        
        // Character data mutations (text changes)
        const characterDataModifiedHandler = this.createMutationHandler(tabId, 'characterData');
        client.DOM.on('characterDataModified', characterDataModifiedHandler);
        boundHandlers.push({
          event: 'characterDataModified',
          handler: characterDataModifiedHandler
        });
        
        // Store the tab and its handlers
        this.observedTabs.set(tabId, { 
          client, 
          boundHandlers,
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
   * Create a mutation event handler
   */
  private createMutationHandler(tabId: string, type: 'childList' | 'attributes' | 'characterData'): Function {
    return (params: any) => {
      // Check if tab is still active before emitting events
      const tabInfo = this.observedTabs.get(tabId);
      if (!tabInfo || !tabInfo.active) return;

      this.emit('mutation', {
        tabId,
        type,
        timestamp: Date.now(),
        targetNodeId: params.nodeId || params.parentNodeId
      } as MutationEvent);
    };
  }

  /**
   * Stop observing a tab for DOM mutations
   */
  async stopObserving(tabId: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      const tabInfo = this.observedTabs.get(tabId);
      
      if (!tabInfo) {
        this.logger.debug(`Tab ${tabId} is not being observed`);
        return false;
      }
      
      // Mark as inactive first to prevent further events from being emitted
      tabInfo.active = false;
      
      // Remove all event listeners
      for (const { event, handler } of tabInfo.boundHandlers) {
        try {
          tabInfo.client.DOM.removeListener(event, handler);
        } catch (error) {
          this.logger.warn(`Error removing listener "${event}" for tab ${tabId}`, error);
          // Continue with other listeners despite error
        }
      }
      
      // Disable DOM domain
      try {
        await tabInfo.client.DOM.disable();
      } catch (error) {
        this.logger.warn(`Error disabling DOM domain for tab ${tabId}`, error);
        // Continue with cleanup despite error
      }
      
      // Remove the tab from observed tabs
      this.observedTabs.delete(tabId);
      
      this.logger.info(`Stopped observing DOM mutations for tab ${tabId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error stopping observation for tab ${tabId}`, error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Check if a tab is being observed
   */
  async isObserving(tabId: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      const tabInfo = this.observedTabs.get(tabId);
      return tabInfo ? tabInfo.active : false;
    } finally {
      release();
    }
  }

  /**
   * Get the list of tabs being observed
   */
  async getObservedTabs(): Promise<string[]> {
    const release = await this.mutex.acquire();
    try {
      return Array.from(this.observedTabs.entries())
        .filter(([_, info]) => info.active)
        .map(([tabId, _]) => tabId);
    } finally {
      release();
    }
  }

  /**
   * Shutdown and cleanup all resources
   */
  async shutdown(): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      const tabIds = Array.from(this.observedTabs.keys());
      
      for (const tabId of tabIds) {
        try {
          await this.stopObserving(tabId);
        } catch (error) {
          this.logger.warn(`Error stopping observation for tab ${tabId} during shutdown`, error);
        }
      }
      
      // Clear all listeners from this emitter
      this.removeAllListeners();
      
      this.logger.info('DOM Observer shutdown complete');
    } finally {
      release();
    }
  }
}
