/**
 * Type definitions for chrome-remote-interface
 */

declare module 'chrome-remote-interface' {
  namespace ChromeRemoteInterface {
    interface Client {
      DOM: {
        enable(): Promise<void>;
        querySelector(params: { nodeId: number; selector: string }): Promise<{ nodeId: number }>;
        getBoxModel(params: { nodeId: number }): Promise<{ model: any }>;
        getDocument(): Promise<{ root: any }>;
        childNodeInserted(callback: (params: any) => void): void;
        childNodeRemoved(callback: (params: any) => void): void;
        attributeModified(callback: (params: any) => void): void;
        attributeRemoved(callback: (params: any) => void): void;
        characterDataModified(callback: (params: any) => void): void;
      };
      Runtime: {
        enable(): Promise<void>;
        evaluate(params: { expression: string; returnByValue?: boolean; awaitPromise?: boolean }): Promise<{ result: any }>;
      };
      Page: {
        enable(): Promise<void>;
        navigate(params: { url: string }): Promise<{ frameId: string }>;
        loadEventFired(callback: () => void): void;
        captureScreenshot(params?: { format?: string; quality?: number }): Promise<{ data: string }>;
      };
      Input: {
        dispatchMouseEvent(params: any): Promise<void>;
      };
      Network: {
        enable(): Promise<void>;
      };
      Accessibility: {
        enable(): Promise<void>;
        getFullAXTree(): Promise<{ nodes: any[] }>;
      };
      close(): Promise<void>;
    }

    interface ProtocolTarget {
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl?: string;
    }
  }

  function ChromeRemoteInterface(options?: {
    host?: string;
    port?: number;
    target?: string | ((targets: ChromeRemoteInterface.ProtocolTarget[]) => ChromeRemoteInterface.ProtocolTarget);
  }): Promise<ChromeRemoteInterface.Client>;

  namespace ChromeRemoteInterface {
    function List(options?: { host?: string; port?: number }): Promise<ProtocolTarget[]>;
    function New(options?: { host?: string; port?: number; url?: string }): Promise<{ targetId: string }>;
    function Activate(options: { host?: string; port?: number; id: string }): Promise<void>;
    function Close(options: { host?: string; port?: number; id: string }): Promise<void>;
    function Version(options?: { host?: string; port?: number }): Promise<{ webSocketDebuggerUrl: string; [key: string]: any }>;
  }

  export = ChromeRemoteInterface;
}
