import { contextBridge, ipcRenderer } from 'electron'
import type { AppSnapshot, AppSnapshotPatch, ImageScanProgress, MediaToolsProgress, MusicImportProgress, ResourceDownloadProgress, SylunaeAPI } from '../../src/shared/types'

const api: SylunaeAPI = {
  platform: 'electron',
  imageProcessing: {
    getDirectory: () => ipcRenderer.invoke('image-processing:get-directory'),
    pickDirectory: () => ipcRenderer.invoke('image-processing:pick-directory'),
    openDirectory: () => ipcRenderer.invoke('image-processing:open-directory'),
    save: (name, bytes) => ipcRenderer.invoke('image-processing:save', name, bytes),
  },
  storage: {
    putNoteAsset: (bytes, mime) => ipcRenderer.invoke('storage:put-note-asset', bytes, mime),
    getNoteAsset: (id) => ipcRenderer.invoke('storage:get-note-asset', id),
    load: () => ipcRenderer.invoke('storage:load'),
    save: (patch: AppSnapshotPatch) => ipcRenderer.invoke('storage:save', patch),
    replace: (snapshot: AppSnapshot) => ipcRenderer.invoke('storage:replace', snapshot),
  },
  music: {
    pick: () => ipcRenderer.invoke('music:pick'),
    getDownloadDirectory: () => ipcRenderer.invoke('music:get-download-directory'),
    pickDownloadDirectory: (currentDirectory) => ipcRenderer.invoke('music:pick-download-directory', currentDirectory),
    importRemote: (input) => ipcRenderer.invoke('music:import-remote', input),
    searchYoutube: (query) => ipcRenderer.invoke('music:search-youtube', query),
    onImportProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: MusicImportProgress) => listener(progress)
      ipcRenderer.on('music:import-progress', handler)
      return () => ipcRenderer.removeListener('music:import-progress', handler)
    },
    getMediaToolsStatus: () => ipcRenderer.invoke('music:get-media-tools-status'),
    installMediaTools: () => ipcRenderer.invoke('music:install-media-tools'),
    onMediaToolsProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: MediaToolsProgress) => listener(progress)
      ipcRenderer.on('music:media-tools-progress', handler)
      return () => ipcRenderer.removeListener('music:media-tools-progress', handler)
    },
    relocate: (trackId) => ipcRenderer.invoke('music:relocate', trackId),
    checkPaths: (paths) => ipcRenderer.invoke('music:check-paths', paths),
    getAudioUrl: (path) => ipcRenderer.invoke('music:get-url', path),
    showInFolder: (path) => ipcRenderer.invoke('music:show-in-folder', path),
    readMetadata: (path) => ipcRenderer.invoke('music:read-metadata', path),
    updateMetadata: (update) => ipcRenderer.invoke('music:update-metadata', update),
  },
  resources: {
    list: () => ipcRenderer.invoke('resources:list'),
    openDirectory: (directory) => ipcRenderer.invoke('resources:open-directory', directory),
    download: (id) => ipcRenderer.invoke('resources:download', id),
    remove: (id) => ipcRenderer.invoke('resources:remove', id),
    importWhiteNoise: () => ipcRenderer.invoke('resources:import-white-noise'),
    getAudioUrl: (id) => ipcRenderer.invoke('resources:get-audio-url', id),
    onDownloadProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ResourceDownloadProgress) => listener(progress)
      ipcRenderer.on('resources:download-progress', handler)
      return () => ipcRenderer.removeListener('resources:download-progress', handler)
    },
  },
  images: {
    pick: () => ipcRenderer.invoke('images:pick'),
    pickFile: () => ipcRenderer.invoke('images:pick-file'),
    pickRoot: (recursive) => ipcRenderer.invoke('images:pick-root', recursive),
    scan: (taskId, library, rootId) => ipcRenderer.invoke('images:scan', taskId, library, rootId),
    cancelScan: (taskId) => ipcRenderer.invoke('images:cancel-scan', taskId),
    onScanProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ImageScanProgress) => listener(progress)
      ipcRenderer.on('images:scan-progress', handler)
      return () => ipcRenderer.removeListener('images:scan-progress', handler)
    },
    relocateRoot: (taskId, rootId, library) => ipcRenderer.invoke('images:relocate-root', taskId, rootId, library),
    relocateAsset: (assetId, library) => ipcRenderer.invoke('images:relocate-asset', assetId, library),
    checkPaths: (paths) => ipcRenderer.invoke('images:check-paths', paths),
    getUrls: (paths) => ipcRenderer.invoke('images:get-urls', paths),
    getThumbnailUrls: (requests) => ipcRenderer.invoke('images:get-thumbnail-urls', requests),
  },
  backup: {
    exportFile: (contents, defaultName) => ipcRenderer.invoke('backup:export', contents, defaultName),
    importFile: () => ipcRenderer.invoke('backup:import'),
  },
  system: {
    getTheme: () => ipcRenderer.invoke('system:get-theme'),
    openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
    findFavicon: (url) => ipcRenderer.invoke('system:find-favicon', url),
    getLinkPreview: (url) => ipcRenderer.invoke('system:get-link-preview', url),
    notifyPomodoroComplete: (focusCompleted) => ipcRenderer.invoke('system:notify-pomodoro-complete', focusCompleted),
    notifyBirthday: (body) => ipcRenderer.invoke('system:notify-birthday', body),
    pickPomodoroAlarm: () => ipcRenderer.invoke('system:pick-pomodoro-alarm'),
    getPomodoroAlarmUrl: (path) => ipcRenderer.invoke('system:get-pomodoro-alarm-url', path),
  },
}

contextBridge.exposeInMainWorld('sylunae', api)
