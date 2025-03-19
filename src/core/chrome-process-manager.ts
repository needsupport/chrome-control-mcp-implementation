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

const exec = promisify(execCallback);

interface ChromeVersion {
  majorVersion: number;
  fullVersion: string;
}

export interface ChromeProcessInfo {
  pid: number;
  debugPort: number;
  process: ChildProcess;
  userDataDir: string;
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
  private shuttingDown = false;
  private temporaryDirs: string[] = [];
  private defaultExecutablePath: string;

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
      maxRestartAttempts: options.maxRestartAttempts ?? 3,
      restartBackoffMs: options.restartBackoffMs ?? 1000,
      additionalFlags: options.additionalFlags ?? [],
      environmentVars: options.environmentVars ?? {},
      monitorInterval: options.monitorInterval ?? 5000,
      headless: options.headless ?? (process.env.NODE_ENV !== 'development'),
      considerGracePeriodMs: options.considerGracePeriodMs ?? 3000,
      autostart: options.autostart ?? false,
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
   * Detect Chrome executable path based on platform
   */
  private detectChromeExecutable(): string {
    // Check for environment variable first
    if (process.env.CHROME_EXECUTABLE) {
      return process.env.CHROME_EXECUTABLE;
    }
    
    try {
      if (process.platform === 'win32') {
        // Windows
        return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      } else if (process.platform === 'darwin') {
        // macOS
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      } else {
        // Linux
        for (const exe of ['google-chrome', 'chrome', 'chromium', 'chromium-browser']) {
          try {
            const { stdout } = exec(`which ${exe}`);
            if (stdout && stdout.trim()) {
              return stdout.trim();
            }
          } catch {
            // Ignore which command failure and try next executable
          }
        }
        
        // Default fallback
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
      // Check Chrome version first
      await this.checkChromeVersion(chromePath);

      // Check if Chrome is already running on the debug port
      const isPortInUse = await this.isDebugPortInUse();
      if (isPortInUse) {
        this.logger.warn(`Chrome is already running on port ${this.options.debugPort}`);
        throw new Error(`Debug port ${this.options.debugPort} is already in use`);
      }

      // Create temporary user data directory if needed
      const userDataDir = this.options.useTemporaryUserDataDir
        ? await this.createTempDir()
        : this.options.userDataDir;

      if (!userDataDir) {
        throw new Error('User data directory not specified and could not create temporary directory');
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
        throw new Error('Failed to start Chrome (no PID)');
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

      // Create Chrome process info
      this.chromeInfo = {
        pid,
        debugPort: this.options.debugPort,
        process: this.chromeProcess,
        userDataDir,
      };

      // Wait for Chrome to initialize
      await this.waitForChromeStartup();

      // Start monitoring Chrome process
      this.startMonitoring();

      this.logger.info(`Chrome started successfully with PID ${pid}`);
      this.emit('start', this.chromeInfo);

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
      const response = await fetch(`http://localhost:${this.options.debugPort}/json/version`);
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
      const tempDir = path.join(os.tmpdir(), `chrome-control-${Date.now()}`);
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
        this.emit('crash', this.chromeInfo!, code, signal);
        this.handleChromeExit(code, signal);
      } else {
        this.emit('stop', this.chromeInfo!);
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
        const response = await fetch(`http://localhost:${this.options.debugPort}/json/version`);
        
        if (response.ok) {
          const version = await response.json();
          this.logger.info(`Chrome initialized: ${JSON.stringify(version)}`);
          return;
        }
      } catch (error) {
        // Ignore errors during startup wait
      }
      
      // Wait a bit before trying again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Timed out waiting for Chrome to initialize after ${timeout}ms`);
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
   * Check Chrome process health
   */
  private async checkChromeHealth(): Promise<void> {
    if (!this.isRunning()) {
      return;
    }
    
    try {
      // Check if Chrome is responsive
      const response = await fetch(`http://localhost:${this.options.debugPort}/json/version`);
      
      if (!response.ok) {
        this.logger.warn('Chrome is not responding properly');
        // Process is running but not responding properly
        await this.restart();
      }
    } catch (error) {
      this.logger.warn('Error checking Chrome health', error);
      
      if (this.chromeProcess) {
        // Check if process is still running by sending a signal (0)
        try {
          process.kill(this.chromeProcess.pid!, 0);
          this.logger.info('Chrome process is running but not responsive');
          
          // Process is running but not responding
          await this.restart();
        } catch (err) {
          // Process is not running
          this.logger.warn('Chrome process is not running anymore');
          this.chromeProcess = null;
          // Will be handled by exit event automatically
        }
      }
    }
  }

  /**
   * Restart Chrome
   */
  async restart(): Promise<ChromeProcessInfo> {
    this.logger.info('Restarting Chrome...');
    
    await this.stop();
    
    // Wait a bit before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
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
    
    // Try to terminate gracefully
    try {
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
            this.chromeProcess!.kill('SIGKILL');
          } catch (error) {
            // Ignore errors when killing the process
          }
          
          resolve();
        }, 5000);
        
        this.chromeProcess!.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
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
      }
    }
    
    this.temporaryDirs = [];
  }

  /**
   * Check Chrome version
   */
  private async checkChromeVersion(executablePath: string): Promise<ChromeVersion> {
    try {
      const { stdout } = await exec(`"${executablePath}" --version`);
      const versionOutput = stdout.trim();
      
      const versionMatch = versionOutput.match(/Chrome\s+(\d+)\.(\d+)\.(\d+)\.(\d+)/i);
      
      if (versionMatch) {
        const majorVersion = parseInt(versionMatch[1], 10);
        const fullVersion = versionMatch[0];
        
        this.logger.info(`Detected Chrome version: ${fullVersion} (major: ${majorVersion})`);
        
        if (majorVersion < this.options.minVersion) {
          throw new Error(`Chrome version ${majorVersion} is too old. Minimum required version is ${this.options.minVersion}`);
        }
        
        return { majorVersion, fullVersion };
      } else {
        throw new Error(`Could not parse Chrome version from: ${versionOutput}`);
      }
    } catch (error) {
      this.logger.warn('Error checking Chrome version', error);
      throw new Error(`Failed to check Chrome version: ${error.message}`);
    }
  }
}
