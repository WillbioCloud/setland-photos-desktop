import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  processAndUpload: (payload: {
    filePaths: string[];
    coverPhoto: string;
    clientCpf: string;
    clientName: string;
    clientPhone: string;
    photographer: string;
  }) => ipcRenderer.invoke('photos:processAndUpload', payload),
  onProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('upload-progress', (_, value) => callback(value));
  },
  uploadToDrive: (payload: any) => ipcRenderer.invoke('drive:uploadPurchased', payload),
  onDriveProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('drive-upload-progress', (_, value) => callback(value));
  },
  onDrivePhotoProgress: (callback: (data: any) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('drive:photo-progress', listener);
    return () => ipcRenderer.removeListener('drive:photo-progress', listener);
  },
  getPrinters: () => ipcRenderer.invoke('printer:getPrinters'),
  printPhotos: (payload: { photos: any[]; printerName?: string }) => ipcRenderer.invoke('printer:printPhotos', payload),
  appendPhotos: (payload: { sessionId: string; filePaths: string[]; clientName?: string }) => ipcRenderer.invoke('photos:appendPhotos', payload),
  // Abre links de WhatsApp / Drive / vitrine no navegador padrão do sistema operacional
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  deleteLocalSessionDir: (localCacheDir: string) => 
    ipcRenderer.invoke('photos:deleteLocalSessionDir', localCacheDir)
});