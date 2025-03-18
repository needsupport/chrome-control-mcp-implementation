/**
 * Type definitions for the Chrome Control MCP implementation
 */

// Chrome API types
export interface TabInfo {
  id: string;
  url: string;
  title: string;
}

export interface ChromeSession {
  targetId: string;
  sessionId: string;
}

// DOM interaction types
export interface ElementInfo {
  nodeId: number;
  backendNodeId: number;
  objectId?: string;
  tagName: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isClickable: boolean;
  boundingBox?: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Semantic analysis types
export interface SemanticElement {
  semanticId: string;
  elementType: ElementType;
  nodeId: number;
  backendNodeId: number;
  objectId?: string;
  text: string;
  importance: number;
  childIds: string[];
  parentId?: string;
  attributes: Record<string, string>;
  role?: string;
  boundingBox?: BoundingBox;
}

export enum ElementType {
  NAVIGATION = 'navigation',
  BUTTON = 'button',
  LINK = 'link',
  FORM = 'form',
  INPUT = 'input',
  CHECKBOX = 'checkbox',
  RADIO = 'radio',
  SELECT = 'select',
  OPTION = 'option',
  TEXT = 'text',
  HEADING = 'heading',
  IMAGE = 'image',
  LIST = 'list',
  LIST_ITEM = 'listItem',
  TABLE = 'table',
  OTHER = 'other'
}

// Content extraction types
export interface PageContent {
  url: string;
  title: string;
  mainContent: ContentBlock;
  navigation?: NavigationInfo;
  forms?: FormInfo[];
  metaData: Record<string, string>;
}

export interface ContentBlock {
  type: ContentType;
  text: string;
  importance: number;
  semanticId?: string;
  children: ContentBlock[];
}

export enum ContentType {
  HEADING = 'heading',
  PARAGRAPH = 'paragraph',
  LIST = 'list',
  LIST_ITEM = 'listItem',
  TABLE = 'table',
  IMAGE = 'image',
  LINK = 'link',
  CODE = 'code',
  QUOTE = 'quote',
  OTHER = 'other'
}

// Navigation types
export interface NavigationInfo {
  links: NavigationLink[];
  menus: NavigationMenu[];
  currentLocation: string;
}

export interface NavigationLink {
  text: string;
  url: string;
  semanticId: string;
  importance: number;
}

export interface NavigationMenu {
  title: string;
  links: NavigationLink[];
  semanticId: string;
}

// Form interaction types
export interface FormInfo {
  semanticId: string;
  name?: string;
  action?: string;
  method?: string;
  fields: FormField[];
  submitButton?: SemanticElement;
}

export interface FormField {
  semanticId: string;
  name?: string;
  label?: string;
  type: string;
  value?: string;
  required: boolean;
  options?: string[];
}

// Error handling types
export interface ErrorInfo {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
  recoveryStrategies?: string[];
}

// Performance metrics
export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: ErrorInfo;
}

// JSON-RPC request/response types
export interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: Record<string, unknown>;
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  result?: unknown;
  error?: JsonRpcError;
  id: number | string;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}