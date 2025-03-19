// Chrome Control MCP Implementation - Main Entry Point
import { startServer, shutdownServer } from './server/server.js';
import { config } from './config.js';
import { Logger } from './logging/logger.js';
import { ChromeProcessManager, ChromeVersionError, ChromeStartupError, ChromeExecutableError } from './core/chrome-process-manager.js';
import { ensurePortAvailable } from './utils/port-utils.js';
import { performance } from 'perf_hooks';

const logger = new Logger('main');

// Initialize Chrome Process Manager if enabled
let chromeProcessManager: ChromeProcessManager | null = null;

/**
 * Initialize Chrome Process Manager and start Chrome browser
 */
async function initializeChromeProcessManager(): Promise<void> {
  if (config.manageChromeProcess) {
    const startTime = performance.now();
    logger.info('Initializing Chrome Process Manager...');
    
    try {
      // Check if the Chrome debugging port is available or find an alternative
      const debugPort = await ensurePortAvailable(
        config.chromeDebuggingPort, 
        config.autoFreeDebugPort
      );
      
      if (debugPort !== config.chromeDebuggingPort) {
        logger.warn(`Original debug port ${config.chromeDebuggingPort} was in use, using alternative port ${debugPort} instead`);
      }
      
      // Initialize the Chrome Process Manager
      chromeProcessManager = new ChromeProcessManager({
        minVersion: config.minChromeVersion,
        debugPort: debugPort,
        startupTimeout: config.chromeLaunchTimeout,
        maxRestartAttempts: config.chromeRestartAttempts,
        restartBackoffMs: config.chromeRestartBackoff,
        monitorInterval: config.chromeHealthCheckInterval,
        useTemporaryUserDataDir: config.chromeTempUserDataDir,
        userDataDir: config.chromeUserDataDir,
        headless: config.chromeHeadless,
        additionalFlags: config.chromeAdditionalFlags,
        cpuWarningThreshold: config.chromeMaxCpuUsage,
        memoryWarningThreshold: config.chromeMaxMemoryUsage,
        autostart: false // We'll start it manually
      });

      // Set up comprehensive event handlers
      chromeProcessManager.on('start', (info) => {
        logger.info(`Chrome started successfully with PID ${info.pid} and debug port ${info.debugPort}`);
      });

      chromeProcessManager.on('crash', (info, code, signal) => {
        logger.warn(`Chrome crashed with code ${code} and signal ${signal}`);
      });

      chromeProcessManager.on('restart', (info) => {
        logger.info(`Chrome restarted successfully with PID ${info.pid}`);
      });

      chromeProcessManager.on('stop', (info) => {
        logger.info(`Chrome process ${info.pid} stopped successfully`);
      });

      chromeProcessManager.on('error', (error) => {
        logger.error('Chrome process error:', error);
      });
      
      chromeProcessManager.on('health', (info, isHealthy) => {
        if (!isHealthy) {
          logger.warn(`Chrome health check failed for process ${info.pid}`);
        }
      });
      
      chromeProcessManager.on('resource_warning', (info, usage) => {
        logger.warn(`Chrome resource usage high: CPU=${usage.cpu.toFixed(1)}%, Memory=${usage.memory.toFixed(1)}MB`);
      });

      // Start Chrome
      try {
        await chromeProcessManager.start(config.chromeExecutablePath);
        const elapsedTime = (performance.now() - startTime).toFixed(0);
        logger.info(`Chrome started successfully in ${elapsedTime}ms with debugging on port ${debugPort}`);
      } catch (error) {
        if (error instanceof ChromeVersionError) {
          logger.error('Incompatible Chrome version:', error.message);
        } else if (error instanceof ChromeExecutableError) {
          logger.error('Failed to start Chrome executable:', error.message);
        } else if (error instanceof ChromeStartupError) {
          logger.error('Chrome startup failed:', error.message);
        } else {
          logger.error('Failed to start Chrome:', error);
        }
        throw error;
      }
    } catch (error) {
      logger.error('Chrome Process Manager initialization failed:', error);
      throw error;
    }
  } else {
    logger.info('Chrome Process Management is disabled, assuming Chrome is already running');
  }
}

// Start the MCP server
let server: any = null;

/**
 * Start the MCP server and all required components
 */
async function startMcpServer(): Promise<void> {
  logger.info('Starting Chrome Control MCP server...');
  const startTime = performance.now();
  
  try {
    // First initialize Chrome if needed
    await initializeChromeProcessManager();
    
    // Check if the server port is available
    const serverPort = await ensurePortAvailable(
      config.serverPort, 
      config.autoFreeServerPort
    );
    
    if (serverPort !== config.serverPort) {
      logger.warn(`Original server port ${config.serverPort} was in use, using alternative port ${serverPort} instead`);
    }
    
    // Then start the server
    logger.info(`Starting Chrome Control MCP server on port ${serverPort}...`);
    server = await startServer(serverPort);
    
    const elapsedTime = (performance.now() - startTime).toFixed(0);
    logger.info(`Chrome Control MCP server started successfully in ${elapsedTime}ms`);
    
    if (chromeProcessManager && chromeProcessManager.processInfo) {
      logger.info('System Information:');
      logger.info(`- Chrome: PID=${chromeProcessManager.processInfo.pid}, Debug Port=${chromeProcessManager.processInfo.debugPort}`);
      logger.info(`- Server: Port=${serverPort}`);
      logger.info(`- Node.js: ${process.version}, ${process.platform} ${process.arch}`);
    }
  } catch (error) {
    logger.error('Failed to start MCP server:', error);
    await gracefulShutdown('startup-error');
    process.exit(1);
  }
}

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.info('Shutdown already in progress, ignoring additional signal');
    return;
  }
  
  isShuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully...`);
  const startTime = performance.now();
  
  // Set a timeout to force exit if shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    logger.error(`Graceful shutdown timed out after ${config.gracefulShutdownTimeout}ms, forcing exit`);
    process.exit(1);
  }, config.gracefulShutdownTimeout);
  
  try {
    // First stop Chrome Process Manager if enabled
    if (chromeProcessManager) {
      logger.info('Shutting down Chrome Process Manager...');
      await chromeProcessManager.shutdown();
      logger.info('Chrome Process Manager shut down successfully');
    }
    
    // Then stop the server
    if (server) {
      logger.info('Shutting down server...');
      await shutdownServer();
      logger.info('Server shut down successfully');
    }
    
    clearTimeout(forceExitTimeout);
    const elapsedTime = (performance.now() - startTime).toFixed(0);
    logger.info(`Graceful shutdown completed successfully in ${elapsedTime}ms`);
    
    // Give loggers time to flush
    setTimeout(() => process.exit(0), 100);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    clearTimeout(forceExitTimeout);
    
    // Force exit even if there's an error with shutdown
    setTimeout(() => process.exit(1), 100);
  }
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Export the Chrome Process Manager for use in other modules
export { chromeProcessManager };

// Start the server when this module is run directly
if (require.main === module) {
  startMcpServer().catch(error => {
    logger.error('Fatal error starting MCP server:', error);
    process.exit(1);
  });
}
