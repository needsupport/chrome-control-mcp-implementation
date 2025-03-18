/**
 * Input Validator
 * 
 * Provides validation functions for various types of input data.
 * This helps prevent security issues and ensure data integrity.
 */

import { Logger } from '../logging/logger.js';

export class InputValidator {
  private logger: Logger;
  
  constructor() {
    this.logger = new Logger('input-validator');
  }
  
  /**
   * Validate a URL
   */
  validateUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    try {
      // Create URL object to validate
      new URL(url);
      
      // Check for common protocols
      const protocol = url.toLowerCase().split(':')[0];
      if (!['http', 'https', 'file', 'data', 'about'].includes(protocol)) {
        this.logger.warn(`Invalid URL protocol: ${protocol}`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.warn(`Invalid URL: ${url}`, error);
      return false;
    }
  }
  
  /**
   * Validate a CSS selector
   */
  validateSelector(selector: string): boolean {
    if (!selector || typeof selector !== 'string') {
      return false;
    }
    
    try {
      // Test if the selector is valid
      document.createDocumentFragment().querySelector(selector);
      
      // Check for potentially dangerous patterns
      const dangerousPatterns = [
        /javascript:/i,
        /data:/i,
        /vbscript:/i,
        /on\w+=/i,
        /<[\s\S]*?>/
      ];
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(selector)) {
          this.logger.warn(`Potentially malicious selector detected: ${selector}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      this.logger.warn(`Invalid selector: ${selector}`, error);
      return false;
    }
  }
  
  /**
   * Sanitize JavaScript code
   * This isn't a full security solution, just a basic check for obviously malicious code
   */
  sanitizeScript(script: string): string {
    if (!script || typeof script !== 'string') {
      return '';
    }
    
    const blacklist = [
      // System access patterns
      /process\.exit/g,
      /process\.env/g,
      /require\s*\(/g,
      /eval\s*\(/g,
      /Function\s*\(/g,
      
      // Potentially harmful global access
      /window\.open/g,
      /window\.location\s*=/g,
      /document\.location\s*=/g,
      /document\.cookie/g,
      
      // XSS helpers
      /document\.write/g,
      /document\.writeln/g
    ];
    
    let sanitized = script;
    let modified = false;
    
    for (const pattern of blacklist) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '/* REMOVED */');
        modified = true;
      }
    }
    
    if (modified) {
      this.logger.warn('Potentially harmful code was sanitized');
    }
    
    return sanitized;
  }
  
  /**
   * Validate a tab ID
   */
  validateTabId(tabId: string): boolean {
    if (!tabId || typeof tabId !== 'string') {
      return false;
    }
    
    // Tab IDs should follow a specific pattern
    const validTabIdPattern = /^tab-\d+$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return validTabIdPattern.test(tabId);
  }
  
  /**
   * Validate form input
   */
  validateFormInput(value: string, inputType: string): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    
    switch (inputType.toLowerCase()) {
      case 'email':
        return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value);
        
      case 'number':
        return /^-?\d+(\.\d+)?$/.test(value);
        
      case 'url':
        return this.validateUrl(value);
        
      case 'date':
        return !isNaN(Date.parse(value));
        
      // For text, textarea, password, etc., allow most inputs
      default:
        return value.length <= 1000; // Reasonable limit for text input
    }
  }
  
  /**
   * Validate JSON-RPC request parameters
   */
  validateRequestParams(method: string, params: Record<string, unknown>): string | null {
    if (!params) {
      return 'Missing required parameters';
    }
    
    switch (method) {
      case 'navigate':
        if (!params.url || typeof params.url !== 'string') {
          return 'URL parameter is required and must be a string';
        }
        if (!this.validateUrl(params.url as string)) {
          return 'Invalid URL format';
        }
        break;
        
      case 'clickElement':
      case 'findElementsBySelector':
        if (!params.tabId || typeof params.tabId !== 'string') {
          return 'tabId parameter is required and must be a string';
        }
        if (!this.validateTabId(params.tabId as string)) {
          return 'Invalid tab ID format';
        }
        if (!params.selector || typeof params.selector !== 'string') {
          return 'selector parameter is required and must be a string';
        }
        if (!this.validateSelector(params.selector as string)) {
          return 'Invalid selector format';
        }
        break;
        
      case 'executeScript':
        if (!params.tabId || typeof params.tabId !== 'string') {
          return 'tabId parameter is required and must be a string';
        }
        if (!this.validateTabId(params.tabId as string)) {
          return 'Invalid tab ID format';
        }
        if (!params.script || typeof params.script !== 'string') {
          return 'script parameter is required and must be a string';
        }
        break;
        
      // Add more method-specific validations as needed
    }
    
    return null; // No validation errors
  }
}
