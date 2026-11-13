import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DriveProgress, DriveWhiteNoise } from '../../src/shared/driveBackup'
import type { AppSnapshot, AppSnapshotPatch, AppUpdateStatus, ImageScanProgress, MediaToolsProgress, MusicImportProgress, ResourceDownloadProgress, SylunaeAPI } from '../../src/shared/types'

async function withDriveProgress<T>(channel: string, argument: string, listener: (progress: DriveProgress) => void, options?: unknown): Promise<T> {
  const handler = (_event: Electron.IpcRendererEvent, value: DriveProgress) => listener(value)
  ipcRenderer.on('drive:progress', handler)
  try { return await ipcRenderer.invoke(channel, argument, options) }
  finally { ipcRenderer.removeListener('drive:progress', handler) }
}

const api: SylunaeAPI = {
  platform: 'electron',
  driveBackup: {
    notebook: {
      latest: () => ipcRenderer.invoke('drive:notebook-latest'),
      revision: (id) => ipcRenderer.invoke('drive:notebook-revision', id),
      legacy: (id) => ipcRenderer.invoke('drive:notebook-legacy', id),
      read: (object) => ipcRenderer.invoke('drive:notebook-read', object),
      put: (bytes, mime) => ipcRenderer.invoke('drive:notebook-put', bytes, mime),
      publish: (manifest, expected) => ipcRenderer.invoke('drive:notebook-publish', manifest, expected),
    },
    importDevelopmentClient: process.argv.includes('--sylunae-development')
      ? () => ipcRenderer.invoke('drive:import-development-client')
      : undefined,
    status: () => ipcRenderer.invoke('drive:status'),
    account: () => ipcRenderer.invoke('drive:account'),
    connect: () => ipcRenderer.invoke('drive:connect'),
    cancelConnect: () => ipcRenderer.invoke('drive:cancel-connect'),
    disconnect: () => ipcRenderer.invoke('drive:disconnect'),
    prepare: (snapshot, whiteNoise) => ipcRenderer.invoke('drive:prepare', snapshot, whiteNoise),
    upload: (token, onProgress, guard) => withDriveProgress('drive:upload', token, onProgress, guard),
    latest: () => ipcRenderer.invoke('drive:latest'),
    revision: (id) => ipcRenderer.invoke('drive:revision', id),
    previewRestore: () => ipcRenderer.invoke('drive:preview-restore'),
    download: (id, onProgress) => withDriveProgress('drive:download', id, onProgress),
    hasRollback: () => ipcRenderer.invoke('drive:has-rollback'),
    rollback: () => ipcRenderer.invoke('drive:rollback'),
  },
  updates: process.argv.includes('--sylunae-updates') ? {
    getStatus: () => ipcRenderer.invoke('updates:get-status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status)
      ipcRenderer.on('updates:status', handler)
      return () => ipcRenderer.removeListener('updates:status', handler)
    },
  } : undefined,
  formatConversion: {
    capabilities: () => ipcRenderer.invoke('conversion:capabilities'),
    inspect: (file) => ipcRenderer.invoke('conversion:inspect', webUtils.getPathForFile(file)),
    convert: (id, target, quality) => ipcRenderer.invoke('conversion:convert', id, target, quality),
    save: (ids) => ipcRenderer.invoke('conversion:save', ids),
    release: (ids) => ipcRenderer.invoke('conversion:release', ids),
    cancel: () => ipcRenderer.invoke('conversion:cancel'),
  },
  imageProcessing: {
    rememberImport: (file) => ipcRenderer.invoke('image-processing:remember-import', webUtils.getPathForFile(file)),
    pickFolder: () => ipcRenderer.invoke('image-processing:pick-folder'),
    scanFolder: (recursive) => ipcRenderer.invoke('image-processing:scan-folder', recursive),
    processFolder: (format, level, order) => ipcRenderer.invoke('image-processing:process-folder', format, level, order),
    saveFolder: (rule, order) => ipcRenderer.invoke('image-processing:save-folder', rule, order),
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
    replace: (snapshot: AppSnapshot, whiteNoise?: DriveWhiteNoise) => ipcRenderer.invoke('storage:replace', snapshot, whiteNoise),
  },
  music: {
    pick: () => ipcRenderer.invoke('music:pick'),
    getDownloadDirectory: () => ipcRenderer.invoke('music:get-download-directory'),
    pickDownloadDirectory: (currentDirectory) => ipcRenderer.invoke('music:pick-download-directory', currentDirectory),
    importRemote: (input) => ipcRenderer.invoke('music:import-remote', input),
    searchYoutube: (query) => ipcRenderer.invoke('music:search-youtube', query),
    resolveYoutubeAudio: (url) => ipcRenderer.invoke('music:resolve-youtube-audio', url),
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
    onBeforeClose: (listener) => {
      const handler = () => {
        void listener().catch(() => undefined).finally(() => ipcRenderer.send('system:close-ready'))
      }
      ipcRenderer.on('system:before-close', handler)
      return () => ipcRenderer.removeListener('system:before-close', handler)
    },
    themeReady: () => ipcRenderer.send('system:theme-ready'),
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
