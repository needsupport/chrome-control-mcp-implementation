/**
 * Chrome Process Manager Tests
 * 
 * Unit and integration tests for the Chrome Process Manager
 */

import { ChromeProcessManager, ChromeVersionError, ChromeStartupError } from './chrome-process-manager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// Mock the modules that interact with the system
jest.mock('child_process', () => {
  const originalModule = jest.requireActual('child_process');
  
  return {
    ...originalModule,
    spawn: jest.fn().mockImplementation((command, args, options) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.kill = jest.fn();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      
      // Simulate successful startup after a delay
      setTimeout(() => {
        if (mockSpawnShouldFail) {
          mockProcess.emit('exit', 1, null);
        }
      }, 100);
      
      return mockProcess;
    }),
    exec: jest.fn().mockImplementation((command, callback) => {
      if (command.includes('--version')) {
        callback(null, { stdout: 'Chromium 120.0.6099.129' });
      } else {
        callback(null, { stdout: '' });
      }
    })
  };
});

jest.mock('fs', () => {
  const originalModule = jest.requireActual('fs');
  
  return {
    ...originalModule,
    existsSync: jest.fn().mockReturnValue(true),
    promises: {
      ...originalModule.promises,
      access: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      rm: jest.fn().mockResolvedValue(undefined)
    }
  };
});

jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(() => {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/12345',
        Browser: 'Chrome/120.0.6099.129'
      })
    });
  });
});

// Mock variables to control test behavior
let mockSpawnShouldFail = false;

describe('ChromeProcessManager', () => {
  let chromeProcessManager: ChromeProcessManager;
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockSpawnShouldFail = false;
    
    // Create a new instance for each test
    chromeProcessManager = new ChromeProcessManager({
      minVersion: 100,
      debugPort: 9222,
      startupTimeout: 5000,
      maxRestartAttempts: 3,
      restartBackoffMs: 100,
      monitorInterval: 1000,
      autostart: false
    });
  });
  
  afterEach(async () => {
    // Clean up after each test
    if (chromeProcessManager) {
      await chromeProcessManager.shutdown();
    }
  });
  
  describe('Constructor and initialization', () => {
    test('should initialize with default options if none provided', () => {
      const defaultManager = new ChromeProcessManager();
      expect(defaultManager).toBeDefined();
    });
    
    test('should override default options with provided options', () => {
      expect(chromeProcessManager['options'].debugPort).toBe(9222);
      expect(chromeProcessManager['options'].minVersion).toBe(100);
    });
    
    test('should detect default Chrome executable path', () => {
      // @ts-ignore - accessing private method for testing
      const executablePath = chromeProcessManager.detectChromeExecutable();
      expect(executablePath).toBeTruthy();
      
      if (process.platform === 'win32') {
        expect(executablePath).toContain('chrome.exe');
      } else if (process.platform === 'darwin') {
        expect(executablePath).toContain('Google Chrome');
      } else {
        expect(executablePath).toMatch(/google-chrome|chromium/);
      }
    });
  });
  
  describe('Chrome startup and shutdown', () => {
    test('should start Chrome successfully', async () => {
      // Spy on emit to check for events
      const emitSpy = jest.spyOn(chromeProcessManager, 'emit');
      
      await chromeProcessManager.start();
      
      // Chrome should be running
      expect(chromeProcessManager.isRunning()).toBe(true);
      
      // Should emit start event
      expect(emitSpy).toHaveBeenCalledWith(
        'start',
        expect.objectContaining({
          pid: expect.any(Number),
          debugPort: expect.any(Number)
        })
      );
    });
    
    test('should stop Chrome gracefully', async () => {
      // First start Chrome
      await chromeProcessManager.start();
      expect(chromeProcessManager.isRunning()).toBe(true);
      
      // Spy on emit to check for events
      const emitSpy = jest.spyOn(chromeProcessManager, 'emit');
      
      // Then stop Chrome
      await chromeProcessManager.stop();
      
      // Chrome should not be running anymore
      expect(chromeProcessManager.isRunning()).toBe(false);
      
      // Should emit stop event
      expect(emitSpy).toHaveBeenCalledWith(
        'stop',
        expect.anything()
      );
    });
    
    test('should handle Chrome startup failure', async () => {
      // Mock Chrome spawning to fail
      mockSpawnShouldFail = true;
      
      // Spy on emit to check for events
      const emitSpy = jest.spyOn(chromeProcessManager, 'emit');
      
      try {
        await chromeProcessManager.start();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(chromeProcessManager.isRunning()).toBe(false);
      }
    });
  });
  
  describe('Resource management', () => {
    test('should create and cleanup temporary directories', async () => {
      // @ts-ignore - accessing private method for testing
      const tempDir = await chromeProcessManager.createTempDir();
      
      // Temp dir should be created
      expect(tempDir).toBeTruthy();
      expect(fs.promises.mkdir).toHaveBeenCalled();
      
      // Cleanup should remove the temp dir
      await chromeProcessManager.cleanup();
      expect(fs.promises.rm).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true, force: true })
      );
    });
    
    test('should track crash statistics', async () => {
      // Start Chrome
      await chromeProcessManager.start();
      
      // Get statistics before crashes
      const initialStats = chromeProcessManager.getCrashStatistics();
      expect(initialStats.count).toBe(0);
      
      // Simulate a crash by directly calling handleChromeExit
      // @ts-ignore - accessing private method for testing
      chromeProcessManager.handleChromeExit(1, null);
      
      // Statistics should show one crash
      const stats = chromeProcessManager.getCrashStatistics();
      expect(stats.count).toBe(1);
    });
  });
  
  describe('Error handling', () => {
    test('should throw ChromeVersionError for incompatible version', async () => {
      // Mock checkChromeVersion to return a low version
      // @ts-ignore - mockImplementation for private method
      chromeProcessManager.checkChromeVersion = jest.fn().mockImplementation(() => {
        throw new ChromeVersionError('Chrome version 90 is too old. Minimum required version is 100');
      });
      
      try {
        await chromeProcessManager.start();
        fail('Should have thrown a ChromeVersionError');
      } catch (error) {
        expect(error).toBeInstanceOf(ChromeVersionError);
      }
    });
    
    test('should throw ChromeStartupError for startup timeout', async () => {
      // Mock waitForChromeStartup to timeout
      // @ts-ignore - mockImplementation for private method
      chromeProcessManager.waitForChromeStartup = jest.fn().mockImplementation(() => {
        throw new ChromeStartupError('Timed out waiting for Chrome to initialize');
      });
      
      try {
        await chromeProcessManager.start();
        fail('Should have thrown a ChromeStartupError');
      } catch (error) {
        expect(error).toBeInstanceOf(ChromeStartupError);
      }
    });
  });
  
  describe('Monitoring and health checking', () => {
    test('should start monitoring Chrome process health', async () => {
      // Spy on startMonitoring and checkChromeHealth
      // @ts-ignore - accessing private methods for testing
      const startMonitoringSpy = jest.spyOn(chromeProcessManager, 'startMonitoring');
      // @ts-ignore - accessing private methods for testing
      const checkHealthSpy = jest.spyOn(chromeProcessManager, 'checkChromeHealth').mockResolvedValue(true);
      
      // Start Chrome
      await chromeProcessManager.start();
      
      // Monitoring should be started
      expect(startMonitoringSpy).toHaveBeenCalled();
      
      // Wait for a health check to occur
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // Health check should be called
      expect(checkHealthSpy).toHaveBeenCalled();
    });
  });
});
