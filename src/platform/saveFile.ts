import { isAndroid } from './environment'
import { exportAndroidBytes } from './android'

/** Android WebView uses the native save picker for generated files. */
export async function saveBlob(name: string, blob: Blob): Promise<boolean> {
  if (isAndroid) return exportAndroidBytes(name, new Uint8Array(await blob.arrayBuffer()), blob.type || 'application/octet-stream')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
