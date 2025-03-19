/**
 * Port Utilities
 * 
 * Utilities for detecting, checking, and finding available ports.
 */

import * as net from 'net';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { Logger } from '../logging/logger.js';

const exec = promisify(execCallback);
const logger = new Logger('port-utils');

/**
 * Process information obtained from port scan
 */
interface ProcessOnPort {
  pid: number;
  command?: string;
}

/**
 * Check if a port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if ((err as any).code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
export async function findAvailablePort(startPort: number, maxPort: number = startPort + 100): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    if (!(await isPortInUse(port))) {
      return port;
    }
  }
  
  throw new Error(`Could not find an available port between ${startPort} and ${maxPort}`);
}

/**
 * Get information about the process using a specific port
 */
export async function getProcessOnPort(port: number): Promise<ProcessOnPort | null> {
  try {
    if (process.platform === 'win32') {
      // Windows
      const { stdout } = await exec(`netstat -ano | findstr :${port}`);
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && trimmed.includes(`:${port}`)) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 5) {
            const pid = parseInt(parts[4], 10);
            if (!isNaN(pid)) {
              // Try to get process name
              try {
                const { stdout: processStdout } = await exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
                const match = processStdout.match(/"([^"]+)"/);
                const command = match ? match[1] : undefined;
                
                return { pid, command };
              } catch {
                return { pid };
              }
            }
          }
        }
      }
    } else if (process.platform === 'darwin') {
      // macOS
      const { stdout } = await exec(`lsof -i :${port} -n -P`);
      const lines = stdout.split('\n');
      
      if (lines.length > 1) { // First line is header
        const parts = lines[1].trim().split(/\s+/);
        if (parts.length >= 2) {
          const command = parts[0];
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) {
            return { pid, command };
          }
        }
      }
    } else {
      // Linux and others
      const { stdout } = await exec(`ss -lptn 'sport = :${port}'`);
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        const pidMatch = line.match(/pid=(\d+)/);
        const cmdMatch = line.match(/users:\(\("([^"]+)"/);
        
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          const command = cmdMatch ? cmdMatch[1] : undefined;
          return { pid, command };
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.warn(`Error getting process on port ${port}:`, error);
    return null;
  }
}

/**
 * Kill the process using a specific port
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    const processInfo = await getProcessOnPort(port);
    
    if (!processInfo) {
      return false;
    }
    
    logger.warn(`Killing process ${processInfo.pid} (${processInfo.command || 'unknown'}) using port ${port}`);
    
    if (process.platform === 'win32') {
      await exec(`taskkill /F /PID ${processInfo.pid}`);
    } else {
      await exec(`kill -9 ${processInfo.pid}`);
    }
    
    // Verify port is now available
    await new Promise(resolve => setTimeout(resolve, 500));
    return !(await isPortInUse(port));
  } catch (error) {
    logger.error(`Error killing process on port ${port}:`, error);
    return false;
  }
}

/**
 * Ensure a port is available, by finding a free port or killing the process
 */
export async function ensurePortAvailable(port: number, allowKill: boolean = false): Promise<number> {
  if (!(await isPortInUse(port))) {
    return port;
  }
  
  if (allowKill) {
    const killed = await killProcessOnPort(port);
    if (killed) {
      return port;
    }
  }
  
  // If we couldn't free the requested port, find an alternative
  logger.warn(`Port ${port} is in use and could not be freed, finding alternative port...`);
  return findAvailablePort(port + 1);
}
