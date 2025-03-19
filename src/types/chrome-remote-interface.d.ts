declare module 'chrome-remote-interface' {
  namespace ChromeRemoteInterface {
    interface Client {
      DOM: {
        querySelector: (params: any) => Promise<any>;
        getBoxModel: (params: any) => Promise<any>;
        childNodeInserted: (callback: (params: any) => void) => void;
        childNodeRemoved: (callback: (params: any) => void) => void;
        attributeModified: (callback: (params: any) => void) => void;
        attributeRemoved: (callback: (params: any) => void) => void;
        characterDataModified: (callback: (params: any) => void) => void;
      };
      Page: {
        captureScreenshot: () => Promise<{data: string}>;
        loadEventFired: (callback: () => void) => void;
      };
      Runtime: {
        evaluate: (params: any) => Promise<{result: any}>;
      };
      Input: {
        dispatchMouseEvent: (params: any) => Promise<void>;
      };
      Accessibility: {
        enable: () => Promise<void>;
        getFullAXTree: () => Promise<{nodes: any[]}>;
      };
      send: (method: string, params?: any) => Promise<any>;
      close: () => void;
    }
  }
  
  function ChromeRemoteInterface(options?: any): Promise<ChromeRemoteInterface.Client>;
  export default ChromeRemoteInterface;
}
