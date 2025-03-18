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

export interface MutationEvent {
  tabId: string;
  type: 'childList' | 'attributes' | 'characterData';
  timestamp: number;
  targetNodeId?: number;
}

export class DOMObserver extends EventEmitter {
  private logger: Logger;
  private observedTabs: Map<string, { client: ChromeRemoteInterface.Client, listeners: Function[] }> = new Map();

  constructor() {
    super();
    this.logger = new Logger('dom-observer');
  }

  /**
   * Start observing a tab for DOM mutations
   */
  async observeTab(tabId: string, client: ChromeRemoteInterface.Client): Promise<void> {
    if (this.observedTabs.has(tabId)) {
      this.logger.debug(`Tab ${tabId} is already being observed`);
      return;
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
      listeners.push(() => childNodeInsertedListener.dispose());
      
      const childNodeRemovedListener = client.DOM.childNodeRemoved((params) => {
        this.emit('mutation', {
          tabId,
          type: 'childList',
          timestamp: Date.now(),
          targetNodeId: params.parentNodeId
        } as MutationEvent);
      });
      listeners.push(() => childNodeRemovedListener.dispose());
      
      // Attribute mutations
      const attributeModifiedListener = client.DOM.attributeModified((params) => {
        this.emit('mutation', {
          tabId,
          type: 'attributes',
          timestamp: Date.now(),
          targetNodeId: params.nodeId
        } as MutationEvent);
      });
      listeners.push(() => attributeModifiedListener.dispose());
      
      const attributeRemovedListener = client.DOM.attributeRemoved((params) => {
        this.emit('mutation', {
          tabId,
          type: 'attributes',
          timestamp: Date.now(),
          targetNodeId: params.nodeId
        } as MutationEvent);
      });
      listeners.push(() => attributeRemovedListener.dispose());
      
      // Character data mutations (text changes)
      const characterDataModifiedListener = client.DOM.characterDataModified((params) => {
        this.emit('mutation', {
          tabId,
          type: 'characterData',
          timestamp: Date.now(),
          targetNodeId: params.nodeId
        } as MutationEvent);
      });
      listeners.push(() => characterDataModifiedListener.dispose());
      
      // Store the tab and its listeners
      this.observedTabs.set(tabId, { client, listeners });
      
      this.logger.info(`Started observing DOM mutations for tab ${tabId}`);
    } catch (error) {
      this.logger.error(`Failed to start observing tab ${tabId}`, error);
      throw error;
    }
  }

  /**
   * Stop observing a tab for DOM mutations
   */
  stopObserving(tabId: string): boolean {
    const tabData = this.observedTabs.get(tabId);
    
    if (!tabData) {
      this.logger.debug(`Tab ${tabId} is not being observed`);
      return false;
    }
    
    // Dispose all listeners
    for (const disposeListener of tabData.listeners) {
      try {
        disposeListener();
      } catch (error) {
        this.logger.warn(`Error disposing listener for tab ${tabId}`, error);
      }
    }
    
    // Remove the tab from observed tabs
    this.observedTabs.delete(tabId);
    
    this.logger.info(`Stopped observing DOM mutations for tab ${tabId}`);
    return true;
  }

  /**
   * Check if a tab is being observed
   */
  isObserving(tabId: string): boolean {
    return this.observedTabs.has(tabId);
  }

  /**
   * Get the list of tabs being observed
   */
  getObservedTabs(): string[] {
    return Array.from(this.observedTabs.keys());
  }
}
