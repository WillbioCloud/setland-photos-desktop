/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }>;
  [key: string]: any;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  delta?: number;
}

export interface ElectronAPI {
  selectFiles: () => Promise<string[] | null>;
  processAndUpload: (payload: any) => Promise<any>;
  onProgress: (callback: (progress: number) => void) => void;
  uploadToDrive: (payload: any) => Promise<any>;
  onDriveProgress: (callback: (progress: number) => void) => void;
  onDrivePhotoProgress: (callback: (data: any) => void) => () => void;
  getPrinters: () => Promise<any[]>;
  printPhotos: (payload: { photos: any[]; printerName?: string; copies?: number; orientation?: string; paperSize?: string; finish?: string }) => Promise<any>;
  appendPhotos: (payload: { sessionId: string; filePaths: string[]; clientName?: string }) => Promise<any>;
  openExternal: (url: string) => Promise<any>;
  deleteLocalSessionDir: (localCacheDir: string) => Promise<any>;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable?: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateError?: (callback: (err: any) => void) => () => void;
  startUpdateDownload: () => Promise<any>;
  quitAndInstall: () => void;
  checkForUpdates: () => Promise<any>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    electron?: ElectronAPI;
  }
}
