declare module 'chrome-remote-interface' {
  namespace ChromeRemoteInterface {
    interface Client {
      DOM: {
        querySelector: (params: { selector: string; nodeId: number }) => Promise<{ nodeId: number }>;
        getBoxModel: (params: { nodeId: number }) => Promise<{ model: any }>;
        childNodeInserted: (callback: (params: any) => void) => void;
        childNodeRemoved: (callback: (params: any) => void) => void;
        attributeModified: (callback: (params: any) => void) => void;
        attributeRemoved: (callback: (params: any) => void) => void;
        characterDataModified: (callback: (params: any) => void) => void;
      };
      Page: {
        navigate: (params: { url: string }) => Promise<{ frameId: string }>;
        loadEventFired: (callback: () => void) => void;
        captureScreenshot: (params?: any) => Promise<{ data: string }>;
      };
      Runtime: {
        evaluate: (params: {
          expression: string;
          returnByValue?: boolean;
          awaitPromise?: boolean;
        }) => Promise<{ result: { value: any } }>;
      };
      Input: {
        dispatchMouseEvent: (params: {
          type: string;
          x: number;
          y: number;
          button?: string;
          clickCount?: number;
        }) => Promise<void>;
      };
      Accessibility: {
        enable: () => Promise<void>;
        getFullAXTree: () => Promise<{ nodes: any[] }>;
      };
      send: (method: string, params?: any) => Promise<any>;
      close: () => Promise<void>;
    }

    interface Target {
      id: string;
      title: string;
      type: string;
      url: string;
      webSocketDebuggerUrl?: string;
    }

    interface New {
      (options?: { target?: (targets: Target[]) => Target }): Promise<Client>;
      List(options?: { host?: string; port?: number }): Promise<Target[]>;
    }
  }

  const CDP: ChromeRemoteInterface.New;
  export = CDP;
}
