/**
 * Content Extractor
 * 
 * Extracts structured content from web pages by analyzing the DOM and
 * semantic information. This provides AI assistants with organized
 * information about the page content, navigation, and interactive elements.
 */

import { Mutex } from 'async-mutex';
import ChromeRemoteInterface from 'chrome-remote-interface';
import { 
  PageContent, 
  ContentBlock, 
  ContentType, 
  NavigationInfo, 
  NavigationLink, 
  NavigationMenu, 
  FormInfo, 
  FormField,
  SemanticElement,
  ElementType
} from '../types.js';
import { Logger } from '../logging/logger.js';
import { SemanticAnalyzer } from './semantic-analyzer.js';

export class ContentExtractor {
  private logger: Logger;
  private mutex: Mutex;
  private semanticAnalyzer: SemanticAnalyzer;

  constructor(semanticAnalyzer: SemanticAnalyzer) {
    this.logger = new Logger('content-extractor');
    this.mutex = new Mutex();
    this.semanticAnalyzer = semanticAnalyzer;
  }

  /**
   * Extract structured content from a web page
   */
  async extractContent(
    client: ChromeRemoteInterface.Client, 
    tabId: string,
    semanticModel: SemanticElement[]
  ): Promise<PageContent> {
    const release = await this.mutex.acquire();
    
    try {
      this.logger.debug('Starting content extraction', { tabId });
      
      // Extract basic page information
      const url = await this.extractUrl(client);
      const title = await this.extractTitle(client);
      const metaData = await this.extractMetaData(client);
      
      // Extract main content
      const mainContent = await this.extractMainContent(client, semanticModel);
      
      // Extract navigation information
      const navigation = await this.extractNavigation(client, semanticModel);
      
      // Extract forms
      const forms = await this.extractForms(client, semanticModel);
      
      this.logger.info('Content extraction complete', { tabId });
      
      return {
        url,
        title,
        mainContent,
        navigation,
        forms,
        metaData
      };
    } catch (error) {
      this.logger.error('Content extraction error', { tabId, error });
      throw new Error(`Failed to extract content: ${error.message}`);
    } finally {
      release();
    }
  }
  
  /**
   * Extract the URL of the current page
   */
  private async extractUrl(client: ChromeRemoteInterface.Client): Promise<string> {
    const { result } = await client.Runtime.evaluate({
      expression: 'window.location.href',
      returnByValue: true
    });
    
    return result.value as string;
  }
  
  /**
   * Extract the page title
   */
  private async extractTitle(client: ChromeRemoteInterface.Client): Promise<string> {
    const { result } = await client.Runtime.evaluate({
      expression: 'document.title',
      returnByValue: true
    });
    
    return result.value as string;
  }
  
  /**
   * Extract meta tags from the page
   */
  private async extractMetaData(client: ChromeRemoteInterface.Client): Promise<Record<string, string>> {
    const { result } = await client.Runtime.evaluate({
      expression: `
        (function() {
          const metadata = {};
          const metaTags = document.querySelectorAll('meta');
          
          metaTags.forEach(meta => {
            const name = meta.getAttribute('name') || meta.getAttribute('property');
            const content = meta.getAttribute('content');
            
            if (name && content) {
              metadata[name] = content;
            }
          });
          
          return metadata;
        })()
      `,
      returnByValue: true
    });
    
    return result.value as Record<string, string>;
  }
  
  /**
   * Extract the main content of the page
   */
  private async extractMainContent(
    client: ChromeRemoteInterface.Client,
    semanticModel: SemanticElement[]
  ): Promise<ContentBlock> {
    try {
      // Find the main content container
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            // Look for semantic main content elements
            const mainElement = 
              document.querySelector('main') || 
              document.querySelector('article') || 
              document.querySelector('[role="main"]');
              
            if (mainElement) {
              return {
                found: true,
                nodeId: mainElement.__nodeId,
                text: mainElement.innerText,
                childCount: mainElement.children.length
              };
            }
            
            // Fallback: try to find the content heuristically
            // (This is a simplified content extraction algorithm)
            const contentCandidates = [];
            const containers = document.querySelectorAll('div, section');
            
            containers.forEach(container => {
              // Calculate text density
              const text = container.innerText;
              const textLength = text.length;
              const childrenCount = container.children.length;
              
              if (childrenCount > 0 && textLength > 100) {
                const textDensity = textLength / childrenCount;
                contentCandidates.push({
                  element: container,
                  textLength: textLength,
                  textDensity: textDensity
                });
              }
            });
            
            // Sort by text density (higher is better)
            contentCandidates.sort((a, b) => b.textDensity - a.textDensity);
            
            if (contentCandidates.length > 0) {
              const bestCandidate = contentCandidates[0].element;
              return {
                found: true,
                nodeId: bestCandidate.__nodeId,
                text: bestCandidate.innerText,
                childCount: bestCandidate.children.length
              };
            }
            
            // Last resort: use body
            return {
              found: false,
              text: document.body.innerText,
              childCount: document.body.children.length
            };
          })()
        `,
        returnByValue: true
      });
      
      const mainContentInfo = result.value as { 
        found: boolean;
        nodeId?: number;
        text: string;
        childCount: number;
      };
      
      // Process the main content into a structured ContentBlock
      return this.processMainContent(mainContentInfo.text);
    } catch (error) {
      this.logger.error('Error extracting main content', { error });
      
      // Return a simple fallback content block
      return {
        type: ContentType.PARAGRAPH,
        text: 'Failed to extract main content',
        importance: 50,
        children: []
      };
    }
  }
  
  /**
   * Process raw text into a structured ContentBlock
   */
  private processMainContent(text: string): ContentBlock {
    // Split the text into paragraphs
    const paragraphs = text.split(/\n\s*\n+/).filter(p => p.trim().length > 0);
    
    // Create content blocks for each paragraph
    const children: ContentBlock[] = paragraphs.map((paragraph, index) => {
      // Simple heuristic: first paragraph is often a heading or introduction
      const importance = index === 0 ? 90 : Math.max(30, 80 - index * 5);
      
      // Determine the content type
      let type = ContentType.PARAGRAPH;
      if (paragraph.startsWith('•') || paragraph.match(/^\d+\./)) {
        type = ContentType.LIST_ITEM;
      } else if (paragraph.length < 80 && paragraph.endsWith('?')) {
        type = ContentType.OTHER; // Possibly a question
      } else if (paragraph.match(/^[A-Z][^.!?]*[.!?]$/)) {
        type = ContentType.HEADING;
      }
      
      return {
        type,
        text: paragraph.trim(),
        importance,
        children: []
      };
    });
    
    // Create the main content block
    return {
      type: ContentType.OTHER,
      text: paragraphs.length > 0 ? paragraphs[0] : 'No content',
      importance: 100,
      children
    };
  }
  
  /**
   * Extract navigation information from the page
   */
  private async extractNavigation(
    client: ChromeRemoteInterface.Client,
    semanticModel: SemanticElement[]
  ): Promise<NavigationInfo | undefined> {
    try {
      // Find navigation elements from the semantic model
      const navElements = semanticModel.filter(
        element => element.elementType === ElementType.NAVIGATION
      );
      
      // If no navigation elements found, try to extract them using CDP
      if (navElements.length === 0) {
        const { result } = await client.Runtime.evaluate({
          expression: `
            (function() {
              const navElements = document.querySelectorAll('nav, [role="navigation"], .navigation, .nav, .menu');
              return Array.from(navElements).length;
            })()
          `,
          returnByValue: true
        });
        
        const navCount = result.value as number;
        
        if (navCount === 0) {
          // No navigation elements found
          return undefined;
        }
      }
      
      // Extract navigation links
      const { result: linksResult } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const links = [];
            const navElements = document.querySelectorAll('nav, [role="navigation"], .navigation, .nav, .menu');
            
            for (const nav of navElements) {
              const navLinks = nav.querySelectorAll('a');
              for (const link of navLinks) {
                if (link.textContent.trim() && link.href) {
                  links.push({
                    text: link.textContent.trim(),
                    url: link.href,
                    classes: link.getAttribute('class') || ''
                  });
                }
              }
            }
            
            return links;
          })()
        `,
        returnByValue: true
      });
      
      const extractedLinks = linksResult.value as Array<{
        text: string;
        url: string;
        classes: string;
      }>;
      
      // Create navigation links
      const navigationLinks: NavigationLink[] = extractedLinks.map((link, index) => ({
        text: link.text,
        url: link.url,
        semanticId: `nav-link-${index}`,
        importance: 70 - (index * 2) // First links are usually more important
      }));
      
      // Identify navigation menus
      const menus: NavigationMenu[] = [];
      const seenUrls = new Set<string>();
      
      // Group links into menus (simple approach - group by common URLs)
      let currentMenu: {
        title: string;
        links: NavigationLink[];
      } | null = null;
      
      for (const link of navigationLinks) {
        // Skip duplicate links
        if (seenUrls.has(link.url)) {
          continue;
        }
        seenUrls.add(link.url);
        
        // Start a new menu if needed
        if (!currentMenu) {
          currentMenu = {
            title: 'Main Menu',
            links: []
          };
        }
        
        // Add link to current menu
        currentMenu.links.push(link);
        
        // If menu is getting large, close it and start a new one
        if (currentMenu.links.length >= 10) {
          menus.push({
            title: currentMenu.title,
            links: currentMenu.links,
            semanticId: `nav-menu-${menus.length}`
          });
          currentMenu = null;
        }
      }
      
      // Add the last menu if it exists
      if (currentMenu && currentMenu.links.length > 0) {
        menus.push({
          title: currentMenu.title,
          links: currentMenu.links,
          semanticId: `nav-menu-${menus.length}`
        });
      }
      
      // Get current location
      const currentLocation = await this.extractUrl(client);
      
      return {
        links: navigationLinks,
        menus,
        currentLocation
      };
    } catch (error) {
      this.logger.error('Error extracting navigation', { error });
      return undefined;
    }
  }
  
  /**
   * Extract forms from the page
   */
  private async extractForms(
    client: ChromeRemoteInterface.Client,
    semanticModel: SemanticElement[]
  ): Promise<FormInfo[] | undefined> {
    try {
      // Get all forms from the page
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const forms = document.querySelectorAll('form');
            const formData = [];
            
            forms.forEach((form, formIndex) => {
              const fields = [];
              const formElements = form.querySelectorAll('input, select, textarea');
              
              formElements.forEach((field, fieldIndex) => {
                // Get the field's label
                let label = '';
                if (field.id) {
                  const labelElement = document.querySelector('label[for="' + field.id + '"]');
                  if (labelElement) {
                    label = labelElement.textContent.trim();
                  }
                }
                
                if (!label && field.placeholder) {
                  label = field.placeholder;
                }
                
                // Get options for select elements
                let options = [];
                if (field.tagName === 'SELECT') {
                  options = Array.from(field.options).map(opt => opt.value);
                }
                
                fields.push({
                  name: field.name || '',
                  label: label,
                  type: field.type || field.tagName.toLowerCase(),
                  value: field.value || '',
                  required: field.required || false,
                  options: options
                });
              });
              
              // Find the submit button
              let submitButton = null;
              const buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
              if (buttons.length > 0) {
                const button = buttons[0];
                submitButton = {
                  text: button.textContent || button.value || 'Submit',
                  name: button.name || ''
                };
              }
              
              formData.push({
                name: form.name || '',
                action: form.action || '',
                method: form.method || 'get',
                fields: fields,
                submitButton: submitButton
              });
            });
            
            return formData;
          })()
        `,
        returnByValue: true
      });
      
      const extractedForms = result.value as Array<{
        name: string;
        action: string;
        method: string;
        fields: Array<{
          name: string;
          label: string;
          type: string;
          value: string;
          required: boolean;
          options: string[];
        }>;
        submitButton: {
          text: string;
          name: string;
        } | null;
      }>;
      
      // Convert to FormInfo objects
      const forms: FormInfo[] = extractedForms.map((form, formIndex) => {
        // Create FormField objects
        const fields: FormField[] = form.fields.map((field, fieldIndex) => ({
          semanticId: `form-${formIndex}-field-${fieldIndex}`,
          name: field.name,
          label: field.label,
          type: field.type,
          value: field.value,
          required: field.required,
          options: field.options.length > 0 ? field.options : undefined
        }));
        
        // Find corresponding semantic element for the submit button
        let submitButton: SemanticElement | undefined;
        if (form.submitButton) {
          const submitText = form.submitButton.text;
          submitButton = semanticModel.find(
            element => 
              element.elementType === ElementType.BUTTON && 
              element.text.includes(submitText)
          );
        }
        
        return {
          semanticId: `form-${formIndex}`,
          name: form.name,
          action: form.action,
          method: form.method,
          fields,
          submitButton
        };
      });
      
      return forms.length > 0 ? forms : undefined;
    } catch (error) {
      this.logger.error('Error extracting forms', { error });
      return undefined;
    }
  }
}