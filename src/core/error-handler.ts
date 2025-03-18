/**
 * Error Handler
 * 
 * Provides centralized error handling for the application.
 * This includes logging, tracking, and recovery strategies.
 */

import { Logger } from '../logging/logger.js';

export interface ErrorDetails {
  message: string;
  stack?: string;
  code?: string | number;
  context?: Record<string, any>;
}

export class ErrorHandler {
  private logger: Logger;
  private errorCounts: Map<string, number> = new Map();
  private readonly MAX_RETRIES = 3;

  constructor() {
    this.logger = new Logger('error-handler');
    this.setupGlobalHandlers();
  }

  /**
   * Set up global error handlers
   */
  private setupGlobalHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.handleCriticalError('Uncaught exception', error);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason: unknown) => {
      if (reason instanceof Error) {
        this.handleCriticalError('Unhandled rejection', reason);
      } else {
        this.handleCriticalError('Unhandled rejection', new Error(String(reason)));
      }
    });

    // Handle process termination
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down gracefully...');
      this.cleanup().then(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down gracefully...');
      this.cleanup().then(() => process.exit(0));
    });
  }

  /**
   * Handle a generic error
   */
  handleError(message: string, error: unknown, context?: Record<string, any>): ErrorDetails {
    const errorDetails = this.normalizeError(error, context);
    
    this.logger.error(message, errorDetails);
    
    // Track error count
    const errorKey = errorDetails.code || errorDetails.message;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
    
    return errorDetails;
  }

  /**
   * Handle a critical error
   */
  handleCriticalError(message: string, error: unknown, context?: Record<string, any>): ErrorDetails {
    const errorDetails = this.normalizeError(error, context);
    
    this.logger.error(`CRITICAL ERROR: ${message}`, errorDetails);
    
    // Implement any critical error notification here (e.g., send alert)
    
    return errorDetails;
  }

  /**
   * Execute with retry
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    maxRetries: number = this.MAX_RETRIES
  ): Promise<T> {
    let lastError: unknown;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        this.logger.warn(`Operation failed (attempt ${attempt}/${maxRetries}): ${errorMessage}`, error);
        
        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(100 * Math.pow(2, attempt), 3000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries failed
    throw lastError;
  }

  /**
   * Execute with timeout
   */
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number,
    timeoutMessage: string = 'Operation timed out'
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeout);
      
      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Normalize an error into a consistent format
   */
  private normalizeError(error: unknown, context?: Record<string, any>): ErrorDetails {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
        context
      };
    } else if (typeof error === 'string') {
      return {
        message: error,
        context
      };
    } else {
      return {
        message: 'Unknown error',
        context: {
          ...context,
          rawError: JSON.stringify(error)
        }
      };
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    this.logger.info('Cleaning up resources before shutdown...');
    // Any cleanup needed goes here
  }
}
