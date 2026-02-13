// Ambient type declarations for Electron + menubar
// These are minimal stubs — replaced by real types after `npm install`

declare namespace Electron {
  interface NativeImage {
    setTemplateImage(option: boolean): void;
    getSize(): { width: number; height: number };
  }
}

declare module 'electron' {
  export const app: {
    on(event: string, listener: (...args: any[]) => void): void;
    quit(): void;
  };

  export class BrowserWindow {
    webContents: {
      send(channel: string, ...args: any[]): void;
      openDevTools(options?: any): void;
    };
  }

  export class Tray {
    constructor(image: any);
    setToolTip(tooltip: string): void;
    setTitle(title: string): void;
  }

  export const ipcMain: {
    handle(channel: string, listener: (event: any, ...args: any[]) => any): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
  };

  export const nativeTheme: {
    shouldUseDarkColors: boolean;
    on(event: string, listener: () => void): void;
  };

  export const nativeImage: {
    createFromPath(path: string): Electron.NativeImage;
    createFromBuffer(buffer: Buffer, options?: { width?: number; height?: number; scaleFactor?: number }): Electron.NativeImage;
    createEmpty(): Electron.NativeImage;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: Record<string, any>): void;
  };
}

declare module 'menubar' {
  import type { BrowserWindow, Tray } from 'electron';

  interface MenubarOptions {
    tray?: Tray;
    index?: string;
    icon?: string;
    preloadWindow?: boolean;
    browserWindow?: Record<string, any>;
    showDockIcon?: boolean;
    showOnAllWorkspaces?: boolean;
  }

  interface Menubar {
    on(event: string, listener: (...args: any[]) => void): void;
    window?: BrowserWindow;
    app: any;
    tray: Tray;
  }

  export function menubar(opts: MenubarOptions): Menubar;
}
