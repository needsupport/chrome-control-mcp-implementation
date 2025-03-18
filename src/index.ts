// Chrome Control MCP Implementation - Main Entry Point
import { startServer } from './server/server.js';
import { config } from './config.js';
import { Logger } from './logging/logger.js';

// Initialize logger
const logger = new Logger('main');

// Global Chrome API reference for cleanup
let server;

// Set up global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  // Don't exit immediately, try to clean up first
  performCleanup('Uncaught exception')
    .finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  // Continue running, but log the error
});

// Handle termination signals for graceful shutdown
process.on('SIGINT', () => performCleanup('SIGINT'));
process.on('SIGTERM', () => performCleanup('SIGTERM'));

// Start the MCP server
try {
  server = startServer(config.serverPort);
  
  logger.info(`Chrome Control MCP server starting on port ${config.serverPort}...`);
} catch (error) {
  logger.error('Failed to start server', error);
  process.exit(1);
}

// Function to perform cleanup on shutdown
async function performCleanup(reason: string): Promise<void> {
  logger.info(`Shutting down server (reason: ${reason})...`);
  
  try {
    if (server) {
      // Close the server
      await new Promise<void>((resolve) => {
        server.close(() => {
          logger.info('Server closed successfully');
          resolve();
        });
      });
    }
    
    // Additional cleanup logic can be added here
    
    logger.info('Cleanup complete, exiting');
    process.exit(0);
  } catch (error) {
    logger.error('Error during cleanup', error);
    process.exit(1);
  }
}
