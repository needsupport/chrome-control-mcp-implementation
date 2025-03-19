declare module 'chrome-remote-interface' {
  namespace ChromeRemoteInterface {
    interface Client {
      DOM: any;
      Page: any;
      Runtime: any;
      Input: any;
      Accessibility: any;
      Network: any;
      send: (method: string, params?: any) => Promise<any>;
      close: () => void;
      on: (event: string, callback: (params: any) => void) => void;
      once: (event: string, callback: (params: any) => void) => void;
    }
  }
  
  function ChromeRemoteInterface(options?: any): Promise<ChromeRemoteInterface.Client>;
  export default ChromeRemoteInterface;
}
