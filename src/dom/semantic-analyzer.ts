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