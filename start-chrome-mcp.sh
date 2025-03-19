#!/bin/bash

# Start Chrome Control MCP Server
# This script handles the launch of Chrome with appropriate debugging flags
# and starts the MCP server

# Set execute permissions for this script if not already set
chmod +x "$0"

# Configuration
CHROME_DEBUG_PORT=${CHROME_DEBUGGING_PORT:-9222}
NODE_ENV=${NODE_ENV:-development}
CHROME_USER_DATA_DIR=$(mktemp -d)
CHROME_PID_FILE=".chrome_pid"
MIN_CHROME_VERSION=115
RETRY_MAX=3
RETRY_DELAY=2

# Log functions
log_info() { echo -e "\e[34m[INFO]\e[0m $1"; }
log_success() { echo -e "\e[32m[SUCCESS]\e[0m $1"; }
log_warning() { echo -e "\e[33m[WARNING]\e[0m $1"; }
log_error() { echo -e "\e[31m[ERROR]\e[0m $1"; }

# Detect Chrome executable based on platform
detect_chrome_executable() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    echo "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  else
    # Linux and others
    for exe in google-chrome chrome chromium chromium-browser; do
      if command -v "$exe" > /dev/null; then
        echo "$exe"
        return
      fi
    done
    log_error "Chrome executable not found"
    exit 1
  fi
}

# Check Chrome version
check_chrome_version() {
  local chrome_exe="$1"
  local version_output
  
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    version_output=$("$chrome_exe" --version 2> /dev/null)
  else
    # Linux/macOS
    version_output=$("$chrome_exe" --version 2> /dev/null)
  fi
  
  # Extract version number
  local chrome_version
  if [[ $version_output =~ Chrome[[:space:]]+([0-9]+) ]]; then
    chrome_version="${BASH_REMATCH[1]}"
    log_info "Detected Chrome version: $chrome_version"
    
    if (( chrome_version < MIN_CHROME_VERSION )); then
      log_error "Chrome version $chrome_version is too old. Minimum required version is $MIN_CHROME_VERSION"
      exit 1
    fi
  else
    log_warning "Could not determine Chrome version, continuing anyway"
  fi
}

# Cleanup function
cleanup() {
  log_info "Cleaning up resources..."
  
  # Kill Chrome if we started it
  if [[ -f "$CHROME_PID_FILE" ]]; then
    local pid
    pid=$(cat "$CHROME_PID_FILE")
    if ps -p "$pid" > /dev/null; then
      log_info "Stopping Chrome (PID: $pid)"
      kill "$pid" 2> /dev/null || true
      sleep 1
      # Force kill if still running
      if ps -p "$pid" > /dev/null; then
        log_info "Force stopping Chrome (PID: $pid)"
        kill -9 "$pid" 2> /dev/null || true
      fi
    fi
    rm "$CHROME_PID_FILE"
  fi
  
  # Clean up temporary directory
  if [[ -d "$CHROME_USER_DATA_DIR" ]]; then
    log_info "Removing temporary Chrome profile: $CHROME_USER_DATA_DIR"
    rm -rf "$CHROME_USER_DATA_DIR"
  fi
  
  log_info "Cleanup complete"
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    log_info "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if necessary directories exist
if [ ! -d "node_modules" ]; then
    log_info "Installing dependencies..."
    npm ci || npm install
fi

# Build TypeScript code
log_info "Building TypeScript code..."
npm run build || { 
  log_error "Build failed"
  exit 1
}

# Find Chrome executable
CHROME_EXECUTABLE=${CHROME_EXECUTABLE:-$(detect_chrome_executable)}
log_info "Using Chrome executable: $CHROME_EXECUTABLE"

# Check Chrome version
check_chrome_version "$CHROME_EXECUTABLE"

# Check if Chrome is already running on debug port
log_info "Checking if Chrome is already running on debug port $CHROME_DEBUG_PORT..."
if curl -s "http://localhost:$CHROME_DEBUG_PORT/json/version" > /dev/null; then
  log_info "Chrome is already running with remote debugging on port $CHROME_DEBUG_PORT"
else
  log_info "Starting Chrome with remote debugging on port $CHROME_DEBUG_PORT..."
  
  # Set up Chrome flags
  CHROME_FLAGS="--remote-debugging-port=$CHROME_DEBUG_PORT"
  CHROME_FLAGS+=" --user-data-dir=$CHROME_USER_DATA_DIR"
  
  # Add headless flag in non-development environment
  if [[ "$NODE_ENV" != "development" ]]; then
    CHROME_FLAGS+=" --headless=new"
  fi
  
  # Additional flags for better performance and security
  CHROME_FLAGS+=" --disable-gpu"
  CHROME_FLAGS+=" --no-first-run"
  CHROME_FLAGS+=" --no-default-browser-check"
  CHROME_FLAGS+=" --disable-extensions"

  # Start Chrome in the background
  "$CHROME_EXECUTABLE" $CHROME_FLAGS &
  CHROME_PID=$!
  echo $CHROME_PID > "$CHROME_PID_FILE"
  log_info "Chrome started with PID: $CHROME_PID"
  
  # Wait for Chrome to initialize and verify it's running
  for i in $(seq 1 $RETRY_MAX); do
    sleep $RETRY_DELAY
    if curl -s "http://localhost:$CHROME_DEBUG_PORT/json/version" > /dev/null; then
      log_success "Chrome is now running with remote debugging"
      break
    fi
    
    if [[ $i == $RETRY_MAX ]]; then
      log_error "Failed to start Chrome with debugging enabled after $RETRY_MAX attempts"
      exit 1
    else
      log_warning "Waiting for Chrome to initialize (attempt $i of $RETRY_MAX)..."
    fi
  done
fi

# Set environment variable for the server
export CHROME_DEBUGGING_PORT=$CHROME_DEBUG_PORT

# Start the server
log_info "Starting Chrome Control MCP server..."
node dist/index.js
