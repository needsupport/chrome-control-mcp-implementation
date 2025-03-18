/**
 * Logging System
 * Provides detailed logging capabilities with different log levels and output formats
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

// Log levels
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

// Log level names
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.TRACE]: 'TRACE'
};

// Current log level from config
const CURRENT_LOG_LEVEL = getLogLevelFromString(config.logLevel);

/**
 * Convert string log level to enum
 */
function getLogLevelFromString(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'error': return LogLevel.ERROR;
    case 'warn': return LogLevel.WARN;
    case 'info': return LogLevel.INFO;
    case 'debug': return LogLevel.DEBUG;
    case 'trace': return LogLevel.TRACE;
    default: return LogLevel.INFO;
  }
}

/**
 * Logger class for consistent logging throughout the application
 */
export class Logger {
  private component: string;
  private logDir: string;
  private logFilePath: string;

  constructor(component: string) {
    this.component = component;
    this.logDir = config.logDirectory;
    this.logFilePath = path.join(this.logDir, 'chrome-mcp.log');
    
    // Create log directory if it doesn't exist
    this.ensureLogDirectory();
  }

  /**
   * Log an error message
   */
  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log a trace message
   */
  trace(message: string, data?: unknown): void {
    this.log(LogLevel.TRACE, message, data);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, data?: unknown): void {
    // Check if we should log this level
    if (level > CURRENT_LOG_LEVEL && !config.debugMode) {
      return;
    }
    
    // Format the log entry
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];
    
    // Format data if present
    let dataString = '';
    if (data !== undefined) {
      if (data instanceof Error) {
        dataString = `\n  Error: ${data.message}\n  Stack: ${data.stack || 'No stack trace'}`;
      } else {
        try {
          dataString = `\n  ${JSON.stringify(data, null, 2)}`;
        } catch (error) {
          dataString = `\n  [Unserializable data: ${typeof data}]`;
        }
      }
    }
    
    // Create log entry
    const logEntry = `[${timestamp}] [${levelName}] [${this.component}] ${message}${dataString}\n`;
    
    // Log to console with color
    if (config.debugMode || level <= LogLevel.INFO) {
      const consoleMethod = this.getConsoleMethod(level);
      console[consoleMethod](`[${levelName}] [${this.component}] ${message}`);
      
      if (data) {
        console[consoleMethod](data);
      }
    }
    
    // Write to log file
    this.writeToLogFile(logEntry);
  }

  /**
   * Get the appropriate console method for a log level
   */
  private getConsoleMethod(level: LogLevel): 'error' | 'warn' | 'info' | 'debug' | 'log' {
    switch (level) {
      case LogLevel.ERROR: return 'error';
      case LogLevel.WARN: return 'warn';
      case LogLevel.INFO: return 'info';
      case LogLevel.DEBUG: return 'debug';
      default: return 'log';
    }
  }

  /**
   * Write a log entry to the log file
   */
  private writeToLogFile(logEntry: string): void {
    try {
      fs.appendFileSync(this.logFilePath, logEntry);
      
      // Check file size and rotate if needed
      this.checkLogRotation();
    } catch (error) {
      // If we can't write to the log file, at least log to console
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Check if log file needs rotation
   */
  private checkLogRotation(): void {
    try {
      const stats = fs.statSync(this.logFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      // Rotate if file is larger than 10MB
      if (fileSizeInMB > 10) {
        this.rotateLogFile();
      }
    } catch (error) {
      console.error('Failed to check log file size:', error);
    }
  }

  /**
   * Rotate log file
   */
  private rotateLogFile(): void {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const newFileName = `chrome-mcp-${timestamp}.log`;
      const newFilePath = path.join(this.logDir, newFileName);
      
      fs.renameSync(this.logFilePath, newFilePath);
      
      // Remove old log files if there are more than 10
      this.cleanupOldLogFiles();
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  /**
   * Clean up old log files
   */
  private cleanupOldLogFiles(): void {
    try {
      const files = fs.readdirSync(this.logDir);
      const logFiles = files
        .filter(file => file.startsWith('chrome-mcp-') && file.endsWith('.log'))
        .map(file => path.join(this.logDir, file))
        .map(filePath => ({ path: filePath, mtime: fs.statSync(filePath).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      // Keep only the 10 most recent log files
      if (logFiles.length > 10) {
        logFiles.slice(10).forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
    } catch (error) {
      console.error('Failed to clean up old log files:', error);
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }
}