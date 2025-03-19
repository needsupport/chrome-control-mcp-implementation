/**
 * Chrome Instance Manager
 * 
 * Manages multiple Chrome instances for parallel operations.
 * Each instance runs in its own process with a separate port and user profile.
 */

import { ChromeProcessManager, ChromeProcessInfo } from './chrome-process-manager.js';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { findAvailablePort } from '../utils/port-utils.js';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// Instance information
export interface ChromeInstanceInfo {
  id: string;
  processManager: ChromeProcessManager;
  processInfo: ChromeProcessInfo | null;
  debugPort: number;
  startTime: number;
  status: 'starting' | 'running' | 'crashed' | 'stopped';
}

export class ChromeInstanceManager extends EventEmitter {
  private logger: Logger;
  private instances: Map<string, ChromeInstanceInfo> = new Map();
  private baseDebugPort: number;
  private maxInstances: number;
  private shuttingDown = false;

  constructor() {
    super();
    this.logger = new Logger('chrome-instance-manager');
    this.baseDebugPort = config.chromeDebuggingPort;
    this.maxInstances = config.maxChromeInstances || 5;
  }

  /**
   * Get information about all instances
   */
  getAllInstances(): Array<ChromeInstanceInfo> {
    return Array.from(this.instances.values());
  }

  /**
   * Get information about a specific instance
   */
  getInstance(id: string): ChromeInstanceInfo | undefined {
    return this.instances.get(id);
  }

  /**
   * Check if an instance exists
   */
  hasInstance(id: string): boolean {
    return this.instances.has(id);
  }

  /**
   * Get the number of running instances
   */
  getRunningCount(): number {
    return Array.from(this.instances.values())
      .filter(instance => instance.status === 'running')
      .length;
  }

  /**
   * Create and start a new Chrome instance
   */
  async createInstance(id?: string): Promise<ChromeInstanceInfo> {
    // Generate an instance ID if not provided
    const instanceId = id || `chrome-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Check if we already have an instance with this ID
    if (this.instances.has(instanceId)) {
      throw new Error(`Instance with ID ${instanceId} already exists`);
    }
    
    // Check if we've reached the maximum number of instances
    if (this.instances.size >= this.maxInstances) {
      throw new Error(`Maximum number of instances (${this.maxInstances}) reached`);
    }
    
    this.logger.info(`Creating new Chrome instance with ID: ${instanceId}`);
    
    try {
      // Find an available port for this instance
      const port = await findAvailablePort(this.baseDebugPort);
      this.logger.info(`Using port ${port} for Chrome instance ${instanceId}`);
      
      // Create a new Chrome Process Manager for this instance
      const processManager = new ChromeProcessManager({
        debugPort: port,
        useTemporaryUserDataDir: true,
        headless: config.chromeHeadless,
        additionalFlags: [
          `--user-data-dir=${instanceId}`,
          ...config.chromeAdditionalFlags
        ],
        autostart: false  // We'll start it manually
      });
      
      // Set up event listeners
      processManager.on('start', (info) => {
        const instance = this.instances.get(instanceId);
        if (instance) {
          instance.status = 'running';
          instance.processInfo = info;
          this.emit('instance:start', instance);
        }
      });
      
      processManager.on('crash', (info, code, signal) => {
        const instance = this.instances.get(instanceId);
        if (instance) {
          instance.status = 'crashed';
          this.emit('instance:crash', instance, code, signal);
        }
      });
      
      processManager.on('restart', (info) => {
        const instance = this.instances.get(instanceId);
        if (instance) {
          instance.status = 'running';
          instance.processInfo = info;
          this.emit('instance:restart', instance);
        }
      });
      
      processManager.on('error', (error) => {
        this.emit('instance:error', instanceId, error);
      });
      
      // Create instance info
      const instanceInfo: ChromeInstanceInfo = {
        id: instanceId,
        processManager,
        processInfo: null,
        debugPort: port,
        startTime: performance.now(),
        status: 'starting'
      };
      
      // Store instance
      this.instances.set(instanceId, instanceInfo);
      
      // Start the Chrome process
      await processManager.start();
      
      return instanceInfo;
    } catch (error) {
      this.logger.error(`Failed to create Chrome instance ${instanceId}:`, error);
      
      // Clean up if we've already stored the instance
      if (this.instances.has(instanceId)) {
        const instance = this.instances.get(instanceId)!;
        await instance.processManager.shutdown();
        this.instances.delete(instanceId);
      }
      
      throw error;
    }
  }
  
  /**
   * Stop a specific Chrome instance
   */
  async stopInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    
    if (!instance) {
      throw new Error(`Instance with ID ${id} not found`);
    }
    
    this.logger.info(`Stopping Chrome instance ${id}...`);
    
    try {
      await instance.processManager.shutdown();
      instance.status = 'stopped';
      this.instances.delete(id);
      this.emit('instance:stop', instance);
      this.logger.info(`Chrome instance ${id} stopped`);
    } catch (error) {
      this.logger.error(`Failed to stop Chrome instance ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Restart a specific Chrome instance
   */
  async restartInstance(id: string): Promise<ChromeInstanceInfo> {
    const instance = this.instances.get(id);
    
    if (!instance) {
      throw new Error(`Instance with ID ${id} not found`);
    }
    
    this.logger.info(`Restarting Chrome instance ${id}...`);
    
    try {
      await instance.processManager.restart();
      instance.status = 'running';
      instance.startTime = performance.now();
      this.emit('instance:restart', instance);
      this.logger.info(`Chrome instance ${id} restarted`);
      return instance;
    } catch (error) {
      this.logger.error(`Failed to restart Chrome instance ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Get least loaded instance or create a new one if needed
   */
  async getAvailableInstance(): Promise<ChromeInstanceInfo> {
    const runningInstances = Array.from(this.instances.values())
      .filter(instance => instance.status === 'running');
    
    // If no running instances, create a new one
    if (runningInstances.length === 0) {
      return this.createInstance();
    }
    
    // If we haven't reached the max instances and load is high, create a new one
    if (runningInstances.length < this.maxInstances) {
      // Check if existing instances are overloaded
      const overloaded = runningInstances.some(instance => {
        const usage = instance.processInfo?.resourceUsage;
        return usage && (
          usage.cpu > config.chromeMaxCpuUsage ||
          usage.memory > config.chromeMaxMemoryUsage
        );
      });
      
      if (overloaded) {
        return this.createInstance();
      }
    }
    
    // Otherwise, return the instance with the lowest resource usage
    let leastLoadedInstance = runningInstances[0];
    let lowestLoad = Number.MAX_VALUE;
    
    for (const instance of runningInstances) {
      const usage = instance.processInfo?.resourceUsage;
      
      if (usage) {
        // Calculate a simple load score: (cpu% + memory_mb/100)
        const loadScore = usage.cpu + usage.memory / 100;
        
        if (loadScore < lowestLoad) {
          lowestLoad = loadScore;
          leastLoadedInstance = instance;
        }
      }
    }
    
    return leastLoadedInstance;
  }
  
  /**
   * Shutdown all instances and manager
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    
    this.shuttingDown = true;
    this.logger.info(`Shutting down Chrome Instance Manager with ${this.instances.size} instances...`);
    
    const shutdownPromises = Array.from(this.instances.values()).map(instance => {
      return instance.processManager.shutdown()
        .catch(error => {
          this.logger.error(`Error shutting down instance ${instance.id}:`, error);
        });
    });
    
    await Promise.all(shutdownPromises);
    this.instances.clear();
    this.shuttingDown = false;
    this.logger.info('Chrome Instance Manager shutdown complete');
  }
}

// Export singleton instance
export const chromeInstanceManager = new ChromeInstanceManager();
