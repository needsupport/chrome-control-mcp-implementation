/**
 * Semantic Analyzer
 * 
 * Analyzes the DOM structure of a web page to create a semantic model that
 * represents the meaningful elements and their relationships. This provides
 * AI assistants with a structured understanding of the page content.
 */

import { Mutex } from 'async-mutex';
import ChromeRemoteInterface from 'chrome-remote-interface';
import { SemanticElement, ElementType, BoundingBox } from '../types.js';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';

export class SemanticAnalyzer {
  private logger: Logger;
  private mutex: Mutex;

  constructor() {
    this.logger = new Logger('semantic-analyzer');
    this.mutex = new Mutex();
  }

  /**
   * Analyze the semantics of a page using CDP
   */
  async analyzePage(client: ChromeRemoteInterface.Client, tabId: string): Promise<SemanticElement[]> {
    const release = await this.mutex.acquire();
    
    try {
      this.logger.debug('Starting semantic analysis of page', { tabId });
      
      // Get the document structure from Chrome
      const { root } = await client.DOM.getDocument({
        depth: -1, // Get the full tree
        pierce: true // Include shadow DOM
      });
      
      if (!root) {
        throw new Error('Failed to get DOM document');
      }
      
      // Start recursive analysis from the document root
      const semanticElements = await this.analyzeNode(client, root.nodeId);
      
      // Build parent-child relationships
      this.buildRelationships(semanticElements);
      
      // Calculate element importance scores
      this.calculateImportanceScores(semanticElements);
      
      this.logger.info('Semantic analysis complete', { 
        tabId, 
        elementCount: semanticElements.length 
      });
      
      return semanticElements;
    } catch (error) {
      this.logger.error('Error in semantic analysis', { tabId, error });
      throw new Error(`Semantic analysis failed: ${error.message}`);
    } finally {
      release();
    }
  }
  
  /**
   * Analyze a DOM node and its children recursively
   */
  private async analyzeNode(
    client: ChromeRemoteInterface.Client, 
    nodeId: number, 
    depth: number = 0
  ): Promise<SemanticElement[]> {
    if (depth > config.maxSemanticAnalysisDepth) {
      return []; // Prevent stack overflow from deeply nested DOMs
    }
    
    try {
      // Get node details
      const { node } = await client.DOM.describeNode({ nodeId });
      
      if (!node || node.nodeType !== 1) { // Element nodes have nodeType 1
        return [];
      }
      
      const elements: SemanticElement[] = [];
      const nodeName = node.nodeName.toLowerCase();
      
      // Skip invisible elements and common non-content elements
      if (this.shouldSkipNode(nodeName)) {
        return [];
      }
      
      // Get node attributes
      const { attributes } = await client.DOM.getAttributes({ nodeId });
      const parsedAttributes = this.parseAttributes(attributes || []);
      
      // Get text content
      const { result: textResult } = await client.Runtime.callFunctionOn({
        functionDeclaration: `function() { return this.textContent.trim(); }`,
        objectId: node.objectId,
        returnByValue: true
      });
      
      const text = textResult.value as string || '';
      
      // Get bounding box information
      let boundingBox: BoundingBox | undefined;
      try {
        if (node.backendNodeId) {
          const { model } = await client.DOM.getBoxModel({ backendNodeId: node.backendNodeId });
          if (model) {
            boundingBox = {
              x: model.content[0],
              y: model.content[1],
              width: model.width,
              height: model.height,
              top: model.content[1],
              right: model.content[2],
              bottom: model.content[5],
              left: model.content[0]
            };
          }
        }
      } catch (error) {
        // Some nodes don't have box models, which is fine
        this.logger.debug('Could not get box model', { nodeId, error: error.message });
      }
      
      // Determine element type based on node name and attributes
      const elementType = this.determineElementType(nodeName, parsedAttributes);
      
      // Only create semantic elements for interesting nodes
      if (this.isInterestingNode(elementType, nodeName, text, parsedAttributes)) {
        const semanticId = `semantic-${nodeId}`;
        
        elements.push({
          semanticId,
          elementType,
          nodeId,
          backendNodeId: node.backendNodeId || 0,
          objectId: node.objectId,
          text,
          importance: 0, // Will be calculated later
          childIds: [],
          attributes: parsedAttributes,
          role: parsedAttributes['role'] || '',
          boundingBox
        });
      }
      
      // Process children
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          const childElements = await this.analyzeNode(
            client, 
            child.nodeId, 
            depth + 1
          );
          elements.push(...childElements);
        }
      }
      
      return elements;
    } catch (error) {
      this.logger.error('Error analyzing node', { nodeId, error });
      return []; // Skip this node but continue with others
    }
  }
  
  /**
   * Determine if a node should be skipped (not analyzed)
   */
  private shouldSkipNode(nodeName: string): boolean {
    const skipElements = [
      'script', 'style', 'meta', 'link', 'noscript',
      'path', 'svg', 'polygon', 'circle', 'ellipse', 'rect',
      'defs', 'clippath', 'lineargradient', 'radialgradient'
    ];
    
    return skipElements.includes(nodeName);
  }
  
  /**
   * Determine if a node is "interesting" enough to be included in the semantic model
   */
  private isInterestingNode(
    elementType: ElementType, 
    nodeName: string, 
    text: string, 
    attributes: Record<string, string>
  ): boolean {
    // Always include interactive elements
    if ([
      ElementType.BUTTON,
      ElementType.LINK,
      ElementType.INPUT,
      ElementType.CHECKBOX,
      ElementType.RADIO,
      ElementType.SELECT,
      ElementType.FORM
    ].includes(elementType)) {
      return true;
    }
    
    // Always include headings
    if (elementType === ElementType.HEADING) {
      return true;
    }
    
    // Include elements with significant text content
    if (text && text.length > 10) {
      return true;
    }
    
    // Include elements with important attributes
    const importantAttributes = ['id', 'name', 'role', 'aria-label'];
    for (const attr of importantAttributes) {
      if (attributes[attr]) {
        return true;
      }
    }
    
    // Include elements with important class names
    if (attributes['class']) {
      const classes = attributes['class'].split(/\s+/);
      for (const cls of classes) {
        if (cls.includes('nav') || 
            cls.includes('menu') || 
            cls.includes('btn') || 
            cls.includes('heading') ||
            cls.includes('title') ||
            cls.includes('content')) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Determine the semantic type of an element
   */
  private determineElementType(
    nodeName: string, 
    attributes: Record<string, string>
  ): ElementType {
    const role = attributes['role'];
    
    // Check role attribute first (takes precedence)
    if (role) {
      switch (role) {
        case 'button': return ElementType.BUTTON;
        case 'link': return ElementType.LINK;
        case 'checkbox': return ElementType.CHECKBOX;
        case 'radio': return ElementType.RADIO;
        case 'heading': return ElementType.HEADING;
        case 'navigation': return ElementType.NAVIGATION;
        case 'list': return ElementType.LIST;
        case 'listitem': return ElementType.LIST_ITEM;
        case 'img': case 'image': return ElementType.IMAGE;
        case 'form': return ElementType.FORM;
        case 'table': return ElementType.TABLE;
      }
    }
    
    // Check node name (tag)
    switch (nodeName) {
      case 'a': return ElementType.LINK;
      case 'button': return ElementType.BUTTON;
      case 'input': {
        const type = attributes['type']?.toLowerCase();
        if (type === 'checkbox') return ElementType.CHECKBOX;
        if (type === 'radio') return ElementType.RADIO;
        if (type === 'button' || type === 'submit' || type === 'reset') {
          return ElementType.BUTTON;
        }
        return ElementType.INPUT;
      }
      case 'select': return ElementType.SELECT;
      case 'option': return ElementType.OPTION;
      case 'textarea': return ElementType.INPUT;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': 
        return ElementType.HEADING;
      case 'img': return ElementType.IMAGE;
      case 'form': return ElementType.FORM;
      case 'ul': case 'ol': case 'dl': return ElementType.LIST;
      case 'li': case 'dt': case 'dd': return ElementType.LIST_ITEM;
      case 'table': return ElementType.TABLE;
      case 'nav': return ElementType.NAVIGATION;
      case 'p': case 'div': case 'section': case 'article': case 'main': 
        return ElementType.TEXT;
      default: return ElementType.OTHER;
    }
  }
  
  /**
   * Parse DOM attributes from array format to object
   */
  private parseAttributes(attributes: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    
    for (let i = 0; i < attributes.length; i += 2) {
      if (i + 1 < attributes.length) {
        result[attributes[i]] = attributes[i + 1];
      }
    }
    
    return result;
  }
  
  /**
   * Build parent-child relationships between semantic elements
   */
  private buildRelationships(elements: SemanticElement[]): void {
    // Create a map for fast lookup
    const elementMap = new Map<number, SemanticElement>();
    for (const element of elements) {
      elementMap.set(element.nodeId, element);
    }
    
    // Now establish parent-child relationships
    for (const element of elements) {
      // Find all elements that have this element's nodeId in their path
      for (const potentialChild of elements) {
        if (potentialChild === element) continue;
        
        // Use DOM structure to determine parent-child relationships
        // This is a simplified approximation
        if (potentialChild.parentId === undefined) {
          // Try to establish parent-child relationship based on DOM hierarchy
          // This would be more accurate with actual DOM parentNode information
          const childId = potentialChild.semanticId;
          if (!element.childIds.includes(childId)) {
            element.childIds.push(childId);
            potentialChild.parentId = element.semanticId;
          }
        }
      }
    }
  }
  
  /**
   * Calculate importance scores for semantic elements
   */
  private calculateImportanceScores(elements: SemanticElement[]): void {
    for (const element of elements) {
      let score = 50; // Base score
      
      // Element type-based scoring
      switch (element.elementType) {
        case ElementType.HEADING:
          // Headings are very important
          score += 30;
          break;
        case ElementType.BUTTON:
        case ElementType.LINK:
          // Interactive elements are important
          score += 20;
          break;
        case ElementType.INPUT:
        case ElementType.CHECKBOX:
        case ElementType.RADIO:
          // Input elements are important
          score += 15;
          break;
        case ElementType.NAVIGATION:
          // Navigation is important
          score += 25;
          break;
        case ElementType.FORM:
          // Forms are important
          score += 20;
          break;
        case ElementType.TEXT:
          // Text content's importance depends on length
          score += Math.min(15, element.text.length / 20);
          break;
      }
      
      // Check attributes for importance clues
      if (element.attributes['id']) score += 5;
      if (element.attributes['name']) score += 5;
      if (element.attributes['class'] && 
          (element.attributes['class'].includes('main') || 
           element.attributes['class'].includes('primary') ||
           element.attributes['class'].includes('important'))) {
        score += 10;
      }
      
      // Text content
      if (element.text) {
        // More text generally means more important
        score += Math.min(10, element.text.length / 100);
      }
      
      // Visibility affects importance
      if (element.boundingBox) {
        const { width, height } = element.boundingBox;
        if (width === 0 || height === 0) {
          // Zero-dimension elements are usually invisible
          score -= 30;
        } else if (width > 200 && height > 200) {
          // Larger elements are often more important
          score += 10;
        }
        
        // Position on page - elements near top often more important
        if (element.boundingBox.y < 300) {
          score += 10;
        }
      }
      
      // ARIA attributes increase importance
      const ariaAttributes = Object.keys(element.attributes).filter(
        attr => attr.startsWith('aria-')
      );
      score += ariaAttributes.length * 2;
      
      // Cap the score at 100
      element.importance = Math.max(0, Math.min(100, score));
    }
  }
  
  /**
   * Find semantic elements by text content
   */
  async findElementsByText(
    elements: SemanticElement[],
    text: string,
    options: {
      exactMatch?: boolean,
      caseSensitive?: boolean
    } = {}
  ): Promise<SemanticElement[]> {
    const { exactMatch = false, caseSensitive = false } = options;
    
    return elements.filter(element => {
      const elementText = caseSensitive ? element.text : element.text.toLowerCase();
      const searchText = caseSensitive ? text : text.toLowerCase();
      
      if (exactMatch) {
        return elementText === searchText;
      } else {
        return elementText.includes(searchText);
      }
    });
  }
  
  /**
   * Find semantic elements by type
   */
  findElementsByType(
    elements: SemanticElement[],
    type: ElementType | ElementType[]
  ): SemanticElement[] {
    const types = Array.isArray(type) ? type : [type];
    return elements.filter(element => types.includes(element.elementType));
  }
  
  /**
   * Find elements by role
   */
  findElementsByRole(
    elements: SemanticElement[],
    role: string
  ): SemanticElement[] {
    return elements.filter(element => element.role === role);
  }
  
  /**
   * Create a selector for a semantic element
   */
  createSelector(element: SemanticElement): string {
    if (element.attributes.id) {
      return `#${element.attributes.id}`;
    }
    
    if (element.attributes.name) {
      return `[name="${element.attributes.name}"]`;
    }
    
    if (element.attributes.class) {
      const classes = element.attributes.class.split(/\s+/).map(c => `.${c}`).join('');
      if (classes) {
        return classes;
      }
    }
    
    // Fallback to using semantic ID (requires custom data attribute in DOM)
    return `[data-semantic-id="${element.semanticId}"]`;
  }
}