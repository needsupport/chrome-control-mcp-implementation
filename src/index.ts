// Chrome Control MCP Implementation - Main Entry Point
import { startServer } from './server/server.js';
import { config } from './config.js';
import { Logger } from './logging/logger.js';
import { ErrorHandler } from './core/error-handler.js';

// Initialize logger
const logger = new Logger('main');

// Initialize error handler (sets up global handlers)
const errorHandler = new ErrorHandler();

// Application state
let isShuttingDown = false;

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    logger.info('Starting Chrome Control MCP server...');
    
    // Display configuration
    logger.info(`Configuration: port=${config.serverPort}, debug=${config.debug}`);

    // Start the MCP server
    const server = await startServer(config.serverPort);
    
    // Set up graceful shutdown
    setupGracefulShutdown(server);
    
    logger.info(`Chrome Control MCP server started on port ${config.serverPort}`);
  } catch (error) {
    errorHandler.handleCriticalError('Failed to start server', error);
    process.exit(1);
  }
}

/**
 * Set up graceful shutdown
 */
function setupGracefulShutdown(server: any): void {
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    try {
      // Close the server
      await new Promise<void>((resolve, reject) => {
        server.close((err: Error) => {
          if (err) {
            logger.error('Error closing server', err);
            reject(err);
          } else {
            logger.info('Server closed successfully');
            resolve();
          }
        });
        
        // Force close after timeout
        setTimeout(() => {
          logger.warn('Forcing server close after timeout');
          resolve();
        }, 5000);
      });
      
      logger.info('Shutdown complete, exiting process');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };
  
  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run the application
main();
