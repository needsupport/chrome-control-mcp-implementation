// Chrome Control MCP Implementation - Main Entry Point
import { startServer } from './server/server.js';
import { config } from './config.js';
import { Logger } from './logging/logger.js';

const logger = new Logger('main');

// Start the MCP server
const server = startServer(config.serverPort);

logger.info(`Chrome Control MCP server starting on port ${config.serverPort}...`);

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
    // Stop accepting new connections
    server.close(() => {
      logger.info('Server stopped accepting new connections');
    });
    
    // Additional cleanup operations would be performed here
    // For example, closing all browser tabs, releasing resources, etc.
    
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
