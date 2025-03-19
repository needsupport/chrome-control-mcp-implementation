declare module 'chrome-remote-interface' {
  namespace ChromeRemoteInterface {
    interface Client {
      DOM: {
        querySelector: (params: any) => Promise<{nodeId: number}>;
        getBoxModel: (params: any) => Promise<{model: any}>;
        childNodeInserted: (callback: (params: any) => void) => void;
        childNodeRemoved: (callback: (params: any) => void) => void;
        attributeModified: (callback: (params: any) => void) => void;
        attributeRemoved: (callback: (params: any) => void) => void;
        characterDataModified: (callback: (params: any) => void) => void;
      };
      Page: {
        navigate: (params: any) => Promise<any>;
        loadEventFired: (callback: () => void) => void;
        captureScreenshot: (params?: any) => Promise<{data: string}>;
        enable: () => Promise<void>;
      };
      Runtime: {
        evaluate: (params: any) => Promise<{result: any}>;
      };
      Input: {
        dispatchMouseEvent: (params: any) => Promise<void>;
      };
      Accessibility: {
        enable: () => Promise<void>;
      };
      send: (method: string, params?: any) => Promise<any>;
      close: () => void;
    }

    interface Options {
      target?: any;
      port?: number;
      host?: string;
      protocol?: string;
      local?: boolean;
    }
  }

  function ChromeRemoteInterface(options?: ChromeRemoteInterface.Options): Promise<ChromeRemoteInterface.Client>;
  export = ChromeRemoteInterface;
}
