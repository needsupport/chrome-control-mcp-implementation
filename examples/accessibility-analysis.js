/**
 * Accessibility Analysis Example
 * 
 * This example demonstrates how to use the Chrome Control MCP server
 * to analyze web page accessibility issues using the accessibility tree.
 */

// Import fetch in Node.js environment
import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:3001';

/**
 * Send a JSON-RPC request to the MCP server
 */
async function sendRequest(method, params) {
  const response = await fetch(SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now() // Use timestamp as request ID
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Request failed: ${data.error.message}`);
  }

  return data.result;
}

/**
 * Analyze accessibility issues on a web page
 */
async function analyzeAccessibility(url) {
  try {
    console.log(`Analyzing accessibility issues for: ${url}`);

    // Step 1: Navigate to the URL
    console.log('- Navigating to page...');
    const navigationResult = await sendRequest('navigate', { url });
    const tabId = navigationResult.tabId;
    console.log(`- Page loaded in tab: ${tabId}`);

    // Step 2: Get the accessibility tree
    console.log('- Retrieving accessibility tree...');
    const accessibilityResult = await sendRequest('getAccessibilityTree', { tabId });
    const { accessibilityTree } = accessibilityResult;

    // Step 3: Analyze the results
    const { tree, issues, summary } = accessibilityTree;

    // Print summary
    console.log('\nAccessibility Summary:');
    console.log(`- Total nodes: ${summary.totalNodes}`);
    console.log(`- Total issues: ${summary.issueCount}`);
    console.log(`  - Critical: ${summary.criticalIssues}`);
    console.log(`  - Serious: ${summary.seriousIssues}`);
    console.log(`  - Moderate: ${summary.moderateIssues}`);
    console.log(`  - Minor: ${summary.minorIssues}`);

    // Print detailed issues
    if (issues.length > 0) {
      console.log('\nAccessibility Issues:');
      
      // Group issues by type and impact
      const groupedIssues = issues.reduce((acc, issue) => {
        const key = `${issue.impact}-${issue.type}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(issue);
        return acc;
      }, {});
      
      // Print issues in order of severity
      const severityOrder = ['critical-error', 'serious-error', 'moderate-error', 'minor-error', 
                            'critical-warning', 'serious-warning', 'moderate-warning', 'minor-warning'];
      
      for (const severity of severityOrder) {
        const issuesGroup = groupedIssues[severity];
        if (issuesGroup && issuesGroup.length > 0) {
          const [impact, type] = severity.split('-');
          console.log(`\n${impact.toUpperCase()} ${type.toUpperCase()} (${issuesGroup.length}):`);
          
          for (const issue of issuesGroup) {
            console.log(`- ${issue.message}`);
            if (issue.help) {
              console.log(`  Help: ${issue.help}`);
            }
            if (issue.helpUrl) {
              console.log(`  URL: ${issue.helpUrl}`);
            }
          }
        }
      }
    } else {
      console.log('\nNo accessibility issues detected!');
    }

    // Step 4: Clean up - close the tab
    console.log('\n- Cleaning up...');
    await sendRequest('closeTab', { tabId });
    console.log('- Tab closed successfully');

    console.log('\nAccessibility analysis complete!');
  } catch (error) {
    console.error('Error analyzing accessibility:', error);
  }
}

// Check if URL was provided as a command line argument
if (process.argv.length < 3) {
  console.error('Please provide a URL to analyze');
  console.error('Example: node accessibility-analysis.js https://example.com');
  process.exit(1);
}

// Get URL from command line
const url = process.argv[2];

// Run the analysis
analyzeAccessibility(url);
