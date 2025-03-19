/**
 * Chrome Process Manager
 * 
 * Handles the lifecycle of Chrome processes, including:
 * - Starting Chrome with proper debugging flags
 * - Monitoring Chrome process health
 * - Handling Chrome crashes and restarts
 * - Cleaning up Chrome processes on shutdown
 */

import { spawn, ChildProcess, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { retry } from '../utils/retry.js';

const exec = promisify(execCallback);

interface ChromeVersion {
  majorVersion: number;
  fullVersion: string;
}

/**
 * Chrome process resources usage statistics
 */
interface ProcessResourceUsage {
  cpu: number;  // CPU usage percentage
  memory: number; // Memory usage in MB
  uptime: number; // Process uptime in seconds
}

export interface ChromeProcessInfo {
  pid: number;
  debugPort: number;
  process: ChildProcess;
  userDataDir: string;
  startTime: number;
  resourceUsage?: ProcessResourceUsage;
}

/**
 * Chrome process manager events
 */
export interface ChromeProcessManagerEvents {
  /**
   * Emitted when Chrome is successfully started
   */
  start: (info: ChromeProcessInfo) => void;

  /**
   * Emitted when Chrome crashes or stops unexpectedly
   */
  crash: (info: ChromeProcessInfo, code: number | null, signal: NodeJS.Signals | null) => void;

  /**
   * Emitted when Chrome is successfully restarted after a crash
   */
  restart: (info: ChromeProcessInfo) => void;

  /**
   * Emitted when Chrome is intentionally stopped
   */
  stop: (info: ChromeProcessInfo) => void;

  /**
   * Emitted when there's an error with Chrome process management
   */
  error: (error: Error) => void;

  /**
   * Emitted when Chrome health status changes
   */
  health: (info: ChromeProcessInfo, isHealthy: boolean) => void;
  
  /**
   * Emitted when Chrome's resource usage exceeds thresholds
   */
  resource_warning: (info: ChromeProcessInfo, usage: ProcessResourceUsage) => void;
}

/**
 * Options for the Chrome process manager
 */
export interface ChromeProcessManagerOptions {
  minVersion?: number;
  debugPort?: number;
  userDataDir?: string;
  useTemporaryUserDataDir?: boolean;
  startupTimeout?: number;
  maxRestartAttempts?: number;
  restartBackoffMs?: number;
  additionalFlags?: string[];
  environmentVars?: Record<string, string>;
  monitorInterval?: number;
  headless?: boolean;
  considerGracePeriodMs?: number; // Grace period after which a Chrome exit is considered a crash
  autostart?: boolean; // Whether to start Chrome immediately
  cpuWarningThreshold?: number; // CPU usage percentage threshold for warnings
  memoryWarningThreshold?: number; // Memory usage in MB threshold for warnings
  maxResponseTime?: number; // Maximum time in ms for Chrome to respond to health checks
}

// Error classes for better error handling
export class ChromeVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChromeVersionError';
  }
}

export class ChromeExecutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChromeExecutableError';
  }
}

export class ChromeStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChromeStartupError';
  }
}

export class ChromeHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChromeHealthError';
  }
}

/**
 * Class responsible for managing Chrome processes
 */
export class ChromeProcessManager extends EventEmitter {
  private logger: Logger;
  private chromeProcess: ChildProcess | null = null;
  private chromeInfo: ChromeProcessInfo | null = null;
  private options: Required<ChromeProcessManagerOptions>;
  private restartAttempts = 0;
  private monitorIntervalId: NodeJS.Timeout | null = null;
  private resourceMonitorIntervalId: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private temporaryDirs: string[] = [];
  private defaultExecutablePath: string;
  private lastHealthCheckTime = 0;
  private healthCheckHistory: boolean[] = [];
  private crashCount = 0;

  constructor(options: ChromeProcessManagerOptions = {}) {
    super();
    this.logger = new Logger('chrome-process-manager');

    // Set default options
    this.options = {
      minVersion: config.minChromeVersion ?? 115,
      debugPort: config.chromeDebuggingPort ?? 9222,
      userDataDir: options.userDataDir ?? '',
      useTemporaryUserDataDir: options.useTemporaryUserDataDir ?? true,
      startupTimeout: options.startupTimeout ?? 10000,
      maxRestartAttempts: options.maxRestartAttempts ?? 5,
      restartBackoffMs: options.restartBackoffMs ?? 1000,
      additionalFlags: options.additionalFlags ?? [],
      environmentVars: options.environmentVars ?? {},
      monitorInterval: options.monitorInterval ?? 5000,
      headless: options.headless ?? (process.env.NODE_ENV !== 'development'),
      considerGracePeriodMs: options.considerGracePeriodMs ?? 3000,
      autostart: options.autostart ?? false,
      cpuWarningThreshold: options.cpuWarningThreshold ?? 80,
      memoryWarningThreshold: options.memoryWarningThreshold ?? 2000, // 2GB
      maxResponseTime: options.maxResponseTime ?? 5000, // 5 seconds
    };

    // Set default Chrome executable based on platform
    this.defaultExecutablePath = this.detectChromeExecutable();

    // Start Chrome if autostart is enabled
    if (this.options.autostart) {
      this.start().catch(err => {
        this.logger.error('Failed to auto-start Chrome', err);
        this.emit('error', err);
      });
    }

    // Setup cleanup on process exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Get the Chrome debug URL
   */
  get debugUrl(): string {
    return `http://localhost:${this.options.debugPort}`;
  }

  /**
   * Get the Chrome process info
   */
  get processInfo(): ChromeProcessInfo | null {
    return this.chromeInfo;
  }

  /**
   * Check if Chrome is currently running
   */
  isRunning(): boolean {
    return this.chromeProcess !== null && this.chromeInfo !== null;
  }

  /**
   * Get crash statistics
   */
  getCrashStatistics(): { count: number, restartAttempts: number } {
    return {
      count: this.crashCount,
      restartAttempts: this.restartAttempts
    };
  }

  /**
   * Detect Chrome executable path based on platform
   */
  private detectChromeExecutable(): string {
    // Check for environment variable first
    if (process.env.CHROME_EXECUTABLE) {
      return process.env.CHROME_EXECUTABLE;
    }
    
    try {
      if (process.platform === 'win32') {
        // Windows - check multiple possible locations
        const possiblePaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${os.homedir()}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`
        ];
        
        for (const path of possiblePaths) {
          if (fs.existsSync(path)) {
            return path;
          }
        }
        
        // Default fallback for Windows
        return 'chrome.exe';
      } else if (process.platform === 'darwin') {
        // macOS - check default and user-specific locations
        const possiblePaths = [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
        ];
        
        for (const path of possiblePaths) {
          if (fs.existsSync(path)) {
            return path;
          }
        }
        
        // Default fallback for macOS
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      } else {
        // Linux and others - use which command to find executables
        for (const exe of ['google-chrome', 'google-chrome-stable', 'chrome', 'chromium', 'chromium-browser']) {
          try {
            const result = execCallback(`which ${exe}`, (error, stdout) => {
              if (!error && stdout && stdout.toString().trim()) {
                return stdout.toString().trim();
              }
            });
          } catch {
            // Ignore which command failure and try next executable
          }
        }
        
        // Check common Linux paths
        const possiblePaths = [
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser'
        ];
        
        for (const path of possiblePaths) {
          if (fs.existsSync(path)) {
            return path;
          }
        }
        
        // Default fallback for Linux
        return 'google-chrome';
      }
    } catch (error) {
      this.logger.warn('Error detecting Chrome executable', error);
      return process.platform === 'win32' ? 'chrome.exe' : 'google-chrome';
    }
  }

  /**
   * Start Chrome with debugging enabled
   */
  async start(executablePath?: string): Promise<ChromeProcessInfo> {
    if (this.isRunning()) {
      this.logger.info('Chrome is already running');
      return this.chromeInfo!;
    }

    const chromePath = executablePath || config.chromeExecutablePath || this.defaultExecutablePath;
    this.logger.info(`Starting Chrome from: ${chromePath}`);

    try {
      // Validate chromePath exists
      try {
        await fs.promises.access(chromePath, fs.constants.X_OK);
      } catch (error) {
        throw new ChromeExecutableError(`Chrome executable not found or not executable: ${chromePath}`);
      }

      // Check Chrome version first
      await this.checkChromeVersion(chromePath);

      // Check if Chrome is already running on the debug port
      const isPortInUse = await this.isDebugPortInUse();
      if (isPortInUse) {
        this.logger.warn(`Chrome is already running on port ${this.options.debugPort}`);
        throw new ChromeStartupError(`Debug port ${this.options.debugPort} is already in use`);
      }

      // Create temporary user data directory if needed
      const userDataDir = this.options.useTemporaryUserDataDir
        ? await this.createTempDir()
        : this.options.userDataDir;

      if (!userDataDir) {
        throw new ChromeStartupError('User data directory not specified and could not create temporary directory');
      }

      // Build Chrome flags
      const flags = [
        `--remote-debugging-port=${this.options.debugPort}`,
        `--user-data-dir=${userDataDir}`,
      ];

      // Add headless flag if enabled
      if (this.options.headless) {
        flags.push('--headless=new');
      }

      // Add safe defaults
      flags.push(
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-hang-monitor',
        '--disable-sync'
      );

      // Add additional flags
      flags.push(...this.options.additionalFlags);

      // Spawn Chrome process
      this.logger.info(`Launching Chrome with flags: ${flags.join(' ')}`);
      this.chromeProcess = spawn(chromePath, flags, {
        env: { ...process.env, ...this.options.environmentVars },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      const pid = this.chromeProcess.pid;
      if (!pid) {
        throw new ChromeStartupError('Failed to start Chrome (no PID)');
      }

      // Set up process event handlers
      this.setupProcessEventHandlers(this.chromeProcess);

      // Capture Chrome stdout/stderr
      if (this.chromeProcess.stdout) {
        this.chromeProcess.stdout.on('data', (data) => {
          this.logger.debug(`Chrome stdout: ${data.toString().trim()}`);
        });
      }
      
      if (this.chromeProcess.stderr) {
        this.chromeProcess.stderr.on('data', (data) => {
          this.logger.debug(`Chrome stderr: ${data.toString().trim()}`);
        });
      }

      // Record start time
      const startTime = Date.now();

      // Create Chrome process info
      this.chromeInfo = {
        pid,
        debugPort: this.options.debugPort,
        process: this.chromeProcess,
        userDataDir,
        startTime,
      };

      // Wait for Chrome to initialize
      await retry(
        () => this.waitForChromeStartup(),
        {
          retries: 3,
          minTimeout: 1000,
          factor: 2,
          onRetry: (error, attempt) => {
            this.logger.warn(`Retrying Chrome startup (attempt ${attempt}/3): ${error.message}`);
          }
        }
      );

      // Start monitoring Chrome process health
      this.startMonitoring();

      // Start monitoring resource usage
      this.startResourceMonitoring();

      this.logger.info(`Chrome started successfully with PID ${pid}`);
      this.emit('start', this.chromeInfo);

      // Reset restart attempts on successful start
      this.restartAttempts = 0;

      return this.chromeInfo;
    } catch (error) {
      this.logger.error('Failed to start Chrome', error);
      // Clean up if there was an error
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Check if Chrome is already running on the debug port
   */
  private async isDebugPortInUse(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`http://localhost:${this.options.debugPort}/json/version`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create a temporary directory for Chrome user data
   */
  private async createTempDir(): Promise<string> {
    try {
      const tempDir = path.join(os.tmpdir(), `chrome-control-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
      await fs.promises.mkdir(tempDir, { recursive: true });
      this.temporaryDirs.push(tempDir);
      return tempDir;
    } catch (error) {
      this.logger.error('Failed to create temporary directory', error);
      throw error;
    }
  }

  /**
   * Set up Chrome process event handlers
   */
  private setupProcessEventHandlers(process: ChildProcess): void {
    // Handle process exit
    process.once('exit', (code, signal) => {
      this.logger.info(`Chrome process exited with code ${code} and signal ${signal}`);
      this.chromeProcess = null;

      if (!this.shuttingDown) {
        if (this.chromeInfo) {
          this.emit('crash', this.chromeInfo, code, signal);
          this.crashCount++;
        }
        this.handleChromeExit(code, signal);
      } else if (this.chromeInfo) {
        this.emit('stop', this.chromeInfo);
      }
    });

    // Handle process error
    process.once('error', (error) => {
      this.logger.error('Chrome process error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Handle Chrome process exit
   */
  private handleChromeExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.shuttingDown) {
      return; // Don't restart if we're shutting down
    }

    this.logger.warn(`Chrome exited unexpectedly with code ${code} and signal ${signal}`);
    
    if (this.restartAttempts < this.options.maxRestartAttempts) {
      const backoffTime = this.options.restartBackoffMs * Math.pow(2, this.restartAttempts);
      this.restartAttempts++;
      
      this.logger.info(`Attempting to restart Chrome in ${backoffTime}ms (attempt ${this.restartAttempts}/${this.options.maxRestartAttempts})`);
      
      setTimeout(() => {
        this.start()
          .then((info) => {
            this.logger.info(`Chrome restarted successfully with PID ${info.pid}`);
            this.emit('restart', info);
            this.restartAttempts = 0; // Reset restart attempts on successful restart
          })
          .catch((error) => {
            this.logger.error(`Failed to restart Chrome (attempt ${this.restartAttempts}/${this.options.maxRestartAttempts})`, error);
            this.emit('error', error);
          });
      }, backoffTime);
    } else {
      this.logger.error(`Maximum restart attempts (${this.options.maxRestartAttempts}) reached, giving up`);
      this.emit('error', new Error(`Failed to restart Chrome after ${this.options.maxRestartAttempts} attempts`));
    }
  }

  /**
   * Wait for Chrome to start up and be available
   */
  private async waitForChromeStartup(): Promise<void> {
    this.logger.info(`Waiting for Chrome to initialize on port ${this.options.debugPort}...`);
    
    const startTime = Date.now();
    const timeout = this.options.startupTimeout;
    
    while (Date.now() - startTime < timeout) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`http://localhost:${this.options.debugPort}/json/version`, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const version = await response.json();
          this.logger.info(`Chrome initialized: ${JSON.stringify(version)}`);
          
          // Check browser availability by trying to get the list of targets
          const targetsResponse = await fetch(`http://localhost:${this.options.debugPort}/json/list`);
          if (targetsResponse.ok) {
            return;
          }
        }
      } catch (error) {
        // Ignore errors during startup wait
      }
      
      // Wait a bit before trying again
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    throw new ChromeStartupError(`Timed out waiting for Chrome to initialize after ${timeout}ms`);
  }

  /**
   * Start monitoring Chrome process health
   */
  private startMonitoring(): void {
    if (this.monitorIntervalId) {
      clearInterval(this.monitorIntervalId);
    }
    
    this.monitorIntervalId = setInterval(() => {
      this.checkChromeHealth().catch(err => {
        this.logger.error('Error checking Chrome health', err);
      });
    }, this.options.monitorInterval);
  }

  /**
   * Start monitoring Chrome resource usage
   */
  private startResourceMonitoring(): void {
    if (!this.chromeInfo || !this.chromeProcess) return;
    
    if (this.resourceMonitorIntervalId) {
      clearInterval(this.resourceMonitorIntervalId);
    }
    
    this.resourceMonitorIntervalId = setInterval(async () => {
      try {
        if (!this.chromeProcess || !this.chromeInfo) return;
        
        // Get process resource usage
        const usage = await this.getProcessResourceUsage(this.chromeInfo.pid);
        
        if (!usage) return;
        
        // Update process info with resource usage
        this.chromeInfo.resourceUsage = usage;
        
        // Check if resource usage exceeds thresholds
        if (usage.cpu > this.options.cpuWarningThreshold) {
          this.logger.warn(`Chrome CPU usage is high: ${usage.cpu.toFixed(1)}%`);
          this.emit('resource_warning', this.chromeInfo, usage);
        }
        
        if (usage.memory > this.options.memoryWarningThreshold) {
          this.logger.warn(`Chrome memory usage is high: ${usage.memory.toFixed(1)}MB`);
          this.emit('resource_warning', this.chromeInfo, usage);
        }
      } catch (error) {
        this.logger.debug('Error monitoring Chrome resources', error);
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Get process resource usage
   */
  private async getProcessResourceUsage(pid: number): Promise<ProcessResourceUsage | null> {
    try {
      // Different approaches depending on platform
      if (process.platform === 'win32') {
        // Windows - use wmic
        const { stdout } = await exec(`wmic process where ProcessId=${pid} get WorkingSetSize,UserModeTime,CreationDate /format:csv`);
        
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) return null;
        
        const parts = lines[1].split(',');
        if (parts.length < 4) return null;
        
        const workingSetSize = parseInt(parts[2], 10) / (1024 * 1024); // Convert to MB
        const userModeTime = parseInt(parts[3], 10) / 10000000; // Convert to seconds
        
        return {
          cpu: 0, // Not accurate on Windows without multiple samples
          memory: workingSetSize,
          uptime: userModeTime
        };
      } else if (process.platform === 'darwin' || process.platform === 'linux') {
        // macOS/Linux - use ps
        const cmd = process.platform === 'darwin'
          ? `ps -p ${pid} -o %cpu,%mem,rss,etime`
          : `ps -p ${pid} -o %cpu,%mem,rss,etimes --no-headers`;
        
        const { stdout } = await exec(cmd);
        const parts = stdout.trim().split(/\s+/);
        
        if (parts.length < 4) return null;
        
        const cpu = parseFloat(parts[0]);
        const memory = parseInt(parts[2], 10) / 1024; // Convert KB to MB
        const uptime = process.platform === 'darwin'
          ? this.parseEtime(parts[3])
          : parseInt(parts[3], 10);
        
        return { cpu, memory, uptime };
      }
      
      return null;
    } catch (error) {
      this.logger.debug(`Error getting resource usage for PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Parse etime format from ps (e.g., "2-03:45:12" -> seconds)
   */
  private parseEtime(etime: string): number {
    try {
      // Format can be [[dd-]hh:]mm:ss
      const parts = etime.split('-');
      let days = 0;
      let timeStr = etime;
      
      if (parts.length > 1) {
        days = parseInt(parts[0], 10);
        timeStr = parts[1];
      }
      
      const timeParts = timeStr.split(':');
      let seconds = 0;
      
      if (timeParts.length === 3) {
        // hh:mm:ss
        seconds = parseInt(timeParts[0], 10) * 3600 + parseInt(timeParts[1], 10) * 60 + parseInt(timeParts[2], 10);
      } else if (timeParts.length === 2) {
        // mm:ss
        seconds = parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);
      } else {
        // ss
        seconds = parseInt(timeParts[0], 10);
      }
      
      return days * 86400 + seconds;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Check Chrome process health
   */
  private async checkChromeHealth(): Promise<boolean> {
    if (!this.isRunning()) {
      return false;
    }
    
    this.lastHealthCheckTime = Date.now();
    let isHealthy = false;
    
    try {
      // Check if Chrome is responsive
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`http://localhost:${this.options.debugPort}/json/version`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        // Also check if targets are available (a good indicator of Chrome health)
        const targetsResponse = await fetch(`http://localhost:${this.options.debugPort}/json/list`);
        isHealthy = targetsResponse.ok;
        
        if (targetsResponse.ok) {
          const targets = await targetsResponse.json();
          // Check if targets is an array (valid response)
          isHealthy = Array.isArray(targets);
        }
      } else {
        isHealthy = false;
      }
    } catch (error) {
      this.logger.warn('Error checking Chrome health', error);
      isHealthy = false;
      
      if (this.chromeProcess) {
        // Check if process is still running by sending a signal (0)
        try {
          process.kill(this.chromeProcess.pid!, 0);
          this.logger.info('Chrome process is running but not responsive');
          // Process is running but not responding
        } catch (err) {
          // Process is not running
          this.logger.warn('Chrome process is not running anymore');
          this.chromeProcess = null;
          // Will be handled by exit event automatically
          return false;
        }
      }
    }
    
    // Update health check history (keep last 5 checks for trending)
    this.healthCheckHistory.push(isHealthy);
    if (this.healthCheckHistory.length > 5) {
      this.healthCheckHistory.shift();
    }
    
    // Check health trend (if 3 or more checks are unhealthy, restart)
    const unhealthyChecks = this.healthCheckHistory.filter(h => !h).length;
    
    if (this.chromeInfo) {
      if (unhealthyChecks >= 3) {
        this.logger.warn(`Chrome health check failing consistently (${unhealthyChecks}/5 checks failed)`);
        this.emit('health', this.chromeInfo, false);
        
        // Restart Chrome if it's consistently unhealthy
        await this.restart();
        return false;
      } else if (!isHealthy) {
        this.logger.warn('Chrome health check failed, will monitor for consistent failures');
        this.emit('health', this.chromeInfo, false);
        return false;
      } else {
        this.emit('health', this.chromeInfo, true);
        return true;
      }
    }
    
    return isHealthy;
  }

  /**
   * Restart Chrome
   */
  async restart(): Promise<ChromeProcessInfo> {
    this.logger.info('Restarting Chrome...');
    
    await this.stop();
    
    // Wait a bit before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Reset health check history
    this.healthCheckHistory = [];
    
    return this.start();
  }

  /**
   * Stop Chrome gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning() || !this.chromeProcess || !this.chromeInfo) {
      this.logger.info('Chrome is not running');
      return;
    }
    
    this.logger.info(`Stopping Chrome process (PID: ${this.chromeInfo.pid})...`);
    
    // Set flag to avoid restart attempts
    this.shuttingDown = true;
    
    // Stop monitoring
    if (this.monitorIntervalId) {
      clearInterval(this.monitorIntervalId);
      this.monitorIntervalId = null;
    }
    
    if (this.resourceMonitorIntervalId) {
      clearInterval(this.resourceMonitorIntervalId);
      this.resourceMonitorIntervalId = null;
    }
    
    // Try to terminate gracefully
    try {
      // First try to close all pages via CDP
      try {
        const targetsResponse = await fetch(`http://localhost:${this.options.debugPort}/json/list`);
        if (targetsResponse.ok) {
          const targets = await targetsResponse.json();
          if (Array.isArray(targets)) {
            for (const target of targets) {
              if (target.type === 'page' && target.id) {
                await fetch(`http://localhost:${this.options.debugPort}/json/close/${target.id}`);
              }
            }
          }
        }
      } catch (error) {
        this.logger.debug('Error closing Chrome tabs', error);
      }
      
      // Then try to terminate the process
      // On Windows, we use CTRL_BREAK_EVENT (1) which helps with cleaner child process termination
      if (process.platform === 'win32') {
        this.chromeProcess.kill('SIGBREAK');
      } else {
        this.chromeProcess.kill('SIGTERM');
      }
      
      // Wait for process to exit gracefully
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.logger.warn('Chrome did not exit gracefully, forcing termination');
          
          try {
            // Force kill if process doesn't exit gracefully
            if (this.chromeProcess && this.chromeProcess.pid) {
              if (process.platform === 'win32') {
                // On Windows, we need to use taskkill for force kill
                exec(`taskkill /F /PID ${this.chromeProcess.pid}`).catch(e => {
                  this.logger.debug(`Error in taskkill: ${e.message}`);
                });
              } else {
                this.chromeProcess.kill('SIGKILL');
              }
            }
          } catch (error) {
            // Ignore errors when killing the process
            this.logger.debug('Error during force kill', error);
          }
          
          resolve();
        }, 5000);
        
        if (this.chromeProcess) {
          this.chromeProcess.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });
      
    } catch (error) {
      this.logger.error('Error stopping Chrome process', error);
    }
    
    this.chromeProcess = null;
    this.chromeInfo = null;
    this.shuttingDown = false;
  }

  /**
   * Shutdown Chrome process manager
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    
    this.shuttingDown = true;
    this.logger.info('Shutting down Chrome process manager...');
    
    // Stop monitoring
    if (this.monitorIntervalId) {
      clearInterval(this.monitorIntervalId);
      this.monitorIntervalId = null;
    }
    
    if (this.resourceMonitorIntervalId) {
      clearInterval(this.resourceMonitorIntervalId);
      this.resourceMonitorIntervalId = null;
    }
    
    // Stop Chrome
    await this.stop();
    
    // Clean up
    await this.cleanup();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Chrome process manager resources...');
    
    // Try to stop Chrome
    await this.stop();
    
    // Clean up temporary directories
    for (const dir of this.temporaryDirs) {
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
        this.logger.debug(`Removed temporary directory: ${dir}`);
      } catch (error) {
        this.logger.warn(`Failed to remove temporary directory: ${dir}`, error);
        
        // On Windows, sometimes files are locked, so we need to retry with a delay
        if (process.platform === 'win32') {
          setTimeout(async () => {
            try {
              await fs.promises.rm(dir, { recursive: true, force: true });
              this.logger.debug(`Removed temporary directory on retry: ${dir}`);
            } catch (retryError) {
              this.logger.warn(`Failed to remove temporary directory on retry: ${dir}`, retryError);
            }
          }, 2000);
        }
      }
    }
    
    this.temporaryDirs = [];
    this.healthCheckHistory = [];
  }

  /**
   * Check Chrome version
   */
  private async checkChromeVersion(executablePath: string): Promise<ChromeVersion> {
    try {
      const { stdout } = await exec(`"${executablePath}" --version`);
      const versionOutput = stdout.trim();
      
      // Support different version string formats
      const versionMatch = versionOutput.match(/(?:Chrome|Chromium)\s+(?:version\s+)?(\d+)(?:\.(\d+)(?:\.(\d+)(?:\.(\d+))?)?)?/i);
      
      if (versionMatch) {
        const majorVersion = parseInt(versionMatch[1], 10);
        const fullVersion = versionMatch[0];
        
        this.logger.info(`Detected Chrome version: ${fullVersion} (major: ${majorVersion})`);
        
        if (majorVersion < this.options.minVersion) {
          throw new ChromeVersionError(`Chrome version ${majorVersion} is too old. Minimum required version is ${this.options.minVersion}`);
        }
        
        return { majorVersion, fullVersion };
      } else {
        this.logger.warn(`Unrecognized Chrome version output: ${versionOutput}`);
        // Try to continue anyway as the version check might be failing due to different output format
        return { majorVersion: 0, fullVersion: versionOutput };
      }
    } catch (error: any) {
      if (error instanceof ChromeVersionError) {
        throw error;
      }
      
      this.logger.warn('Error checking Chrome version', error);
      
      if (error.message && error.message.includes('Command failed')) {
        throw new ChromeExecutableError(`Chrome executable not found or not valid: ${executablePath}`);
      }
      
      throw new ChromeVersionError(`Failed to check Chrome version: ${error.message}`);
    }
  }

  /**
   * Reset system state (for recovery after errors)
   */
  async reset(): Promise<void> {
    this.logger.info('Resetting Chrome Process Manager state...');
    
    // Stop and clean up everything
    await this.shutdown();
    
    // Reset all state variables
    this.restartAttempts = 0;
    this.crashCount = 0;
    this.healthCheckHistory = [];
    this.shuttingDown = false;
    this.chromeProcess = null;
    this.chromeInfo = null;
    
    this.logger.info('Chrome Process Manager state reset complete');
  }
}
