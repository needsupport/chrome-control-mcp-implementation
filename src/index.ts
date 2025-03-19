// Chrome Control MCP Implementation - Main Entry Point
import { startServer, shutdownServer } from './server/server.js';
import { config } from './config.js';
import { Logger } from './logging/logger.js';
import { ChromeProcessManager } from './core/chrome-process-manager.js';

const logger = new Logger('main');

// Initialize Chrome Process Manager if enabled
let chromeProcessManager: ChromeProcessManager | null = null;

async function initializeChromeProcessManager(): Promise<void> {
  if (config.manageChromeProcess) {
    logger.info('Initializing Chrome Process Manager...');
    chromeProcessManager = new ChromeProcessManager({
      minVersion: config.minChromeVersion,
      debugPort: config.chromeDebuggingPort,
      startupTimeout: config.chromeLaunchTimeout,
      maxRestartAttempts: config.chromeRestartAttempts,
      restartBackoffMs: config.chromeRestartBackoff,
      monitorInterval: config.chromeHealthCheckInterval,
      useTemporaryUserDataDir: config.chromeTempUserDataDir,
      userDataDir: config.chromeUserDataDir,
      headless: config.chromeHeadless,
      additionalFlags: config.chromeAdditionalFlags,
      autostart: false // We'll start it manually
    });

    // Set up event handlers
    chromeProcessManager.on('start', (info) => {
      logger.info(`Chrome started successfully with PID ${info.pid}`);
    });

    chromeProcessManager.on('crash', (info, code, signal) => {
      logger.warn(`Chrome crashed with code ${code} and signal ${signal}`);
    });

    chromeProcessManager.on('restart', (info) => {
      logger.info(`Chrome restarted successfully with PID ${info.pid}`);
    });

    chromeProcessManager.on('error', (error) => {
      logger.error('Chrome process error:', error);
    });

    // Start Chrome
    try {
      await chromeProcessManager.start(config.chromeExecutablePath);
      logger.info(`Chrome started with debugging on port ${config.chromeDebuggingPort}`);
    } catch (error) {
      logger.error('Failed to start Chrome:', error);
      throw error;
    }
  } else {
    logger.info('Chrome Process Management is disabled, assuming Chrome is already running');
  }
}

// Start the MCP server
let server: any = null;

async function startMcpServer(): Promise<void> {
  try {
    // First initialize Chrome if needed
    await initializeChromeProcessManager();
    
    // Then start the server
    logger.info(`Starting Chrome Control MCP server on port ${config.serverPort}...`);
    server = await startServer(config.serverPort);
    logger.info(`Chrome Control MCP server started successfully`);
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
    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Register signal handlers
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

// Start the server
startMcpServer();
