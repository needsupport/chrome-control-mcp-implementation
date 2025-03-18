/**
 * Example: Analyze a web page
 * 
 * This example demonstrates how to use the Chrome Control MCP server to:
 * 1. Navigate to a web page
 * 2. Analyze its semantic structure
 * 3. Extract structured content
 * 4. Find and interact with elements
 * 
 * Usage:
 *   npx ts-node examples/analyze-page.ts https://example.com
 */

import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:3001';

async function main() {
  if (process.argv.length < 3) {
    console.error('Please provide a URL to analyze');
    console.error('Usage: npx ts-node examples/analyze-page.ts https://example.com');
    process.exit(1);
  }
  
  const url = process.argv[2];
  console.log(`Analyzing page: ${url}`);
  
  try {
    // Step 1: Navigate to the page
    console.log('\n1. Navigating to page...');
    const { tabId } = await sendRequest('navigate', { url });
    console.log(`Page loaded in tab: ${tabId}`);
    
    // Step 2: Get structured content
    console.log('\n2. Getting structured content...');
    const { content } = await sendRequest('getStructuredContent', { tabId });
    console.log('Page title:', content.title);
    console.log('URL:', content.url);
    console.log('Main content blocks:', countContentBlocks(content.mainContent));
    
    // Step 3: Find clickable elements
    console.log('\n3. Finding clickable elements...');
    const { elements } = await sendRequest('findClickableElements', { tabId });
    console.log(`Found ${elements.length} clickable elements`);
    
    // Print top 5 elements by importance
    const topElements = elements
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);
    
    console.log('\nTop 5 clickable elements by importance:');
    topElements.forEach((element, index) => {
      console.log(`${index + 1}. ${element.text || '[No text]'} (${element.elementType}, importance: ${element.importance})`);
    });
    
    // Step 4: Analyze page semantics
    console.log('\n4. Analyzing page semantics...');
    const { semanticModel } = await sendRequest('analyzePageSemantics', { tabId });
    
    // Count elements by type
    const elementCounts: Record<string, number> = {};
    semanticModel.forEach(element => {
      elementCounts[element.elementType] = (elementCounts[element.elementType] || 0) + 1;
    });
    
    console.log('Elements by type:');
    Object.entries(elementCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`- ${type}: ${count}`);
      });
    
    // Step 5: Close the tab
    console.log('\n5. Closing tab...');
    await sendRequest('closeTab', { tabId });
    console.log('Tab closed');
    
    console.log('\nAnalysis complete!');
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Send a request to the MCP server
 */
async function sendRequest(method: string, params: Record<string, any>): Promise<any> {
  const response = await fetch(SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`API error: ${data.error.message}`);
  }
  
  return data.result;
}

/**
 * Count the total number of content blocks
 */
function countContentBlocks(block: any): number {
  let count = 1; // Count this block
  
  if (block.children && Array.isArray(block.children)) {
    for (const child of block.children) {
      count += countContentBlocks(child);
    }
  }
  
  return count;
}

// Run the example
main();