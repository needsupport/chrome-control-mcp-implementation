/**
 * Type definitions for the Chrome Control MCP
 */

// Tabs and Navigation

/**
 * Information about a browser tab
 */
export interface TabInfo {
  id: string;
  url: string;
  title: string;
  status: 'loading' | 'complete' | 'error';
}

/**
 * DOM Element Type
 */
export type ElementType =
  | 'div'
  | 'span'
  | 'p'
  | 'a'
  | 'button'
  | 'input'
  | 'select'
  | 'textarea'
  | 'img'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'li'
  | 'table'
  | 'tr'
  | 'td'
  | 'th'
  | 'form'
  | 'label'
  | 'iframe'
  | 'section'
  | 'article'
  | 'header'
  | 'footer'
  | 'nav'
  | 'main'
  | 'aside'
  | 'canvas'
  | 'svg'
  | 'unknown';

/**
 * Semantic Element
 */
export interface SemanticElement {
  semanticId: string;
  nodeId: number;
  elementType: ElementType;
  textContent?: string;
  attributes?: Record<string, string>;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visibility?: 'visible' | 'hidden' | 'partial';
  importance?: number;
  children?: SemanticElement[];
  interactable?: boolean;
  label?: string;
  role?: string;
}

/**
 * Content Type
 */
export type ContentType =
  | 'article'
  | 'product'
  | 'navigation'
  | 'form'
  | 'search'
  | 'advertisement'
  | 'media'
  | 'list'
  | 'table'
  | 'other';

/**
 * Metadata Fields
 */
export interface MetaData {
  title?: string;
  description?: string;
  author?: string;
  publishDate?: string;
  keywords?: string[];
  [key: string]: any;
}

/**
 * Article Content
 */
export interface ArticleContent {
  title: string;
  content: string;
  summary?: string;
  sections?: {
    heading: string;
    content: string;
  }[];
}

/**
 * Product Content
 */
export interface ProductContent {
  name: string;
  price?: string;
  description?: string;
  images?: string[];
  attributes?: Record<string, string>;
}

/**
 * Navigation Content
 */
export interface NavigationContent {
  links: {
    text: string;
    url: string;
    isActive?: boolean;
  }[];
}

/**
 * Form Content
 */
export interface FormContent {
  id?: string;
  action?: string;
  method?: string;
  fields: {
    type: string;
    name: string;
    id?: string;
    label?: string;
    placeholder?: string;
    required?: boolean;
    options?: {
      value: string;
      text: string;
    }[];
  }[];
}

/**
 * Page Content
 */
export interface PageContent {
  url: string;
  title: string;
  mainContent: {
    type: ContentType;
    content: any;
  }[];
  metaData: MetaData;
  semanticElements?: SemanticElement[];
}

/**
 * Error Information
 */
export interface ErrorInfo {
  code: string;
  message: string;
  details?: any;
}

// JSON-RPC Protocol Definitions

/**
 * JSON-RPC Request
 */
export interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: any;
  id: number | string;
}

/**
 * JSON-RPC Response
 */
export interface JsonRpcResponse {
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string | null;
}

/**
 * JSON-RPC Error
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

/**
 * MCP Server Configuration
 */
export interface ServerConfig {
  port: number;
  host: string;
  debugMode: boolean;
  timeout: number;
  maxConcurrentRequests: number;
}

/**
 * Cache Options
 */
export interface CacheOptions {
  tabId?: string;
  ttl?: number;
  tags?: string[];
}

/**
 * DOM Mutation Event
 */
export interface DomMutationEvent {
  tabId: string;
  nodeId: number;
  type: 'childList' | 'attributes' | 'characterData';
  addedNodes?: number[];
  removedNodes?: number[];
  attributeName?: string;
  attributeValue?: string;
}
