import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import type { MediaToolsProgress, MediaToolsStatus } from '../../src/shared/types'

interface MediaToolDefinition {
  id: 'ffmpeg' | 'yt-dlp'
  label: string
  fileName: string
  version: string
  url: string
  sha256: string
  installedBytes: number
  gzip?: boolean
}

const MEDIA_TOOLS: MediaToolDefinition[] = [
  {
    id: 'ffmpeg',
    label: 'FFmpeg',
    fileName: 'ffmpeg.exe',
    version: '6.1.1',
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz',
    sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
    installedBytes: 82_797_568,
    gzip: true,
  },
  {
    id: 'yt-dlp',
    label: 'yt-dlp',
    fileName: 'yt-dlp.exe',
    version: '2026.08.19',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
    sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
    installedBytes: 17_840_399,
  },
]

let installation: Promise<void> | null = null

function toolsDirectory(): string {
  return join(app.getPath('userData'), 'media-tools')
}

function toolPath(tool: MediaToolDefinition): string {
  return join(toolsDirectory(), tool.fileName)
}

function isInstalled(tool: MediaToolDefinition): boolean {
  try {
    return existsSync(toolPath(tool)) && statSync(toolPath(tool)).size === tool.installedBytes
  } catch {
    return false
  }
}

export function getMediaToolsStatus(): MediaToolsStatus {
  const components = MEDIA_TOOLS.map((tool) => ({
    id: tool.id,
    label: tool.label,
    version: tool.version,
    installed: isInstalled(tool),
    installedBytes: tool.installedBytes,
  }))
  return {
    ready: components.every((component) => component.installed),
    installing: installation !== null,
    components,
    installedBytes: components.reduce((total, component) => total + component.installedBytes, 0),
  }
}

async function downloadTool(tool: MediaToolDefinition, report: (progress: MediaToolsProgress) => void): Promise<void> {
  if (isInstalled(tool)) return
  mkdirSync(toolsDirectory(), { recursive: true })
  const destination = toolPath(tool)
  const partial = `${destination}.download`
  if (existsSync(partial)) unlinkSync(partial)
  if (existsSync(destination)) unlinkSync(destination)

  const response = await fetch(tool.url, {
    redirect: 'follow',
    headers: { 'User-Agent': `Sylunae-Workshop/${app.getVersion()}` },
  })
  if (!response.ok || !response.body) throw new Error(`${tool.label} 下载失败（HTTP ${response.status}）`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  const totalBytes = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : null
  let receivedBytes = 0
  let lastReportAt = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length
      const now = Date.now()
      if (now - lastReportAt >= 100 || (totalBytes !== null && receivedBytes >= totalBytes)) {
        report({
          stage: 'downloading',
          tool: tool.id,
          message: `正在下载 ${tool.label}…`,
          receivedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(100, Math.round(receivedBytes / totalBytes * 100)) : null,
        })
        lastReportAt = now
      }
      callback(null, chunk)
    },
  })

  try {
    if (tool.gzip) {
      await pipeline(Readable.fromWeb(response.body as never), counter, createGunzip(), createWriteStream(partial, { flags: 'wx' }))
    } else {
      await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(partial, { flags: 'wx' }))
    }
    report({ stage: 'verifying', tool: tool.id, message: `正在校验 ${tool.label}…`, receivedBytes, totalBytes, percent: null })
    const hash = createHash('sha256')
    const { createReadStream } = await import('node:fs')
    await pipeline(createReadStream(partial), hash)
    if (hash.digest('hex') !== tool.sha256 || statSync(partial).size !== tool.installedBytes) {
      throw new Error(`${tool.label} 安全校验失败，请稍后重试`)
    }
    renameSync(partial, destination)
  } catch (error) {
    if (existsSync(partial)) unlinkSync(partial)
    throw error
  }
}

export async function installMediaTools(report: (progress: MediaToolsProgress) => void): Promise<MediaToolsStatus> {
  if (process.platform !== 'win32' || process.arch !== 'x64') return Promise.reject(new Error('媒体工具目前仅支持 Windows x64'))
  if (!installation) {
    installation = (async () => {
      for (const tool of MEDIA_TOOLS) await downloadTool(tool, report)
      report({ stage: 'complete', tool: null, message: '媒体工具已准备完成', receivedBytes: 0, totalBytes: null, percent: 100 })
    })()
  }
  const activeInstallation = installation
  try {
    await activeInstallation
  } finally {
    if (installation === activeInstallation) installation = null
  }
  return getMediaToolsStatus()
}

export function getMediaToolPaths(): { ffmpeg: string; ytDlp: string } {
  const status = getMediaToolsStatus()
  if (!status.ready) throw new Error('MEDIA_TOOLS_REQUIRED')
  return {
    ffmpeg: toolPath(MEDIA_TOOLS[0]),
    ytDlp: toolPath(MEDIA_TOOLS[1]),
  }
}

// Conversion needs only FFmpeg, independently of the YouTube downloader.
export function getFFmpegPath(): string | null {
  return isInstalled(MEDIA_TOOLS[0]) ? toolPath(MEDIA_TOOLS[0]) : null
}
