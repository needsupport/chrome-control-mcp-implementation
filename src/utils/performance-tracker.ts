/**
 * Performance Tracker
 * Utility for tracking performance metrics of operations
 */

import { PerformanceMetrics, ErrorInfo } from '../types.js';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';

interface TrackerEndOptions {
  success: boolean;
  error?: unknown;
}

/**
 * Class to track performance of operations
 */
export class PerformanceTracker {
  private logger: Logger;
  private metrics: PerformanceMetrics[];
  private enabled: boolean;
  
  constructor() {
    this.logger = new Logger('performance-tracker');
    this.metrics = [];
    this.enabled = config.enablePerformanceMetrics;
  }
  
  /**
   * Start tracking an operation
   */
  start(operation: string): OperationTracker {
    if (!this.enabled) {
      return new OperationTracker(operation, false, this.recordMetric.bind(this));
    }
    
    this.logger.debug(`Starting operation: ${operation}`);
    return new OperationTracker(operation, true, this.recordMetric.bind(this));
  }
  
  /**
   * Record a performance metric
   */
  private recordMetric(metric: PerformanceMetrics): void {
    if (!this.enabled) {
      return;
    }
    
    this.metrics.push(metric);
    
    // Log the metric
    this.logger.debug(`Operation completed: ${metric.operation}`, {
      duration: `${metric.duration}ms`,
      success: metric.success,
      error: metric.error
    });
  }
  
  /**
   * Get all recorded metrics
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }
  
  /**
   * Get metrics for a specific operation
   */
  getMetricsForOperation(operation: string): PerformanceMetrics[] {
    return this.metrics.filter(metric => metric.operation === operation);
  }
  
  /**
   * Get average duration for a specific operation
   */
  getAverageDuration(operation: string): number {
    const metrics = this.getMetricsForOperation(operation);
    
    if (metrics.length === 0) {
      return 0;
    }
    
    const totalDuration = metrics.reduce((sum, metric) => sum + metric.duration, 0);
    return totalDuration / metrics.length;
  }
  
  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

/**
 * Tracker for a specific operation
 */
class OperationTracker {
  private operation: string;
  private startTime: number;
  private enabled: boolean;
  private recordCallback: (metric: PerformanceMetrics) => void;
  
  constructor(
    operation: string,
    enabled: boolean,
    recordCallback: (metric: PerformanceMetrics) => void
  ) {
    this.operation = operation;
    this.startTime = performance.now();
    this.enabled = enabled;
    this.recordCallback = recordCallback;
  }
  
  /**
   * End tracking and record metrics
   */
  end(options: TrackerEndOptions): void {
    if (!this.enabled) {
      return;
    }
    
    const endTime = performance.now();
    const duration = endTime - this.startTime;
    
    const metric: PerformanceMetrics = {
      operation: this.operation,
      startTime: this.startTime,
      endTime,
      duration,
      success: options.success
    };
    
    // Add error info if present
    if (!options.success && options.error) {
      let errorMessage = 'Unknown error';
      
      if (options.error instanceof Error) {
        errorMessage = options.error.message;
      } else if (typeof options.error === 'string') {
        errorMessage = options.error;
      }
      
      metric.error = {
        code: 'OPERATION_ERROR',
        message: errorMessage,
        recoverable: false
      };
    }
    
    this.recordCallback(metric);
  }
}