import { imageDownloadNames } from '../shared/imageNaming'
import { describe, expect, it, vi } from 'vitest'
import { centeredCrop, outputDimensions, outputName, encodeImage } from '../lib/imageProcessing'

describe('image processing geometry', () => {
  it('fits portrait and landscape presets inside the original image', () => {
    for (const [width, height] of [[1200, 800], [800, 1200]]) {
      for (const ratio of [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16]) {
        const rect = centeredCrop(width, height, ratio)
        expect(rect.width / rect.height).toBeCloseTo(ratio)
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(width)
        expect(rect.y + rect.height).toBeLessThanOrEqual(height)
      }
    }
  })
  it('rotates the cropped area without clipping or changing the source dimensions', () => {
    const crop = { x: 100, y: 50, width: 600, height: 300 }
    expect(outputDimensions(1200, 800, { crop, rotation: 90 })).toEqual({ width: 300, height: 600 })
    expect(outputDimensions(1200, 800, { crop, rotation: 270 })).toEqual({ width: 300, height: 600 })
    expect(outputDimensions(1200, 800, { crop, rotation: 180 })).toEqual({ width: 600, height: 300 })
    expect(outputDimensions(1200, 800, { crop: null, rotation: 0 })).toEqual({ width: 1200, height: 800 })
  })
  it('returns the exact original file without re-encoding when no edits are applied', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 30, close })))
    try {
      const file = new File(['original bytes'], 'photo.png', { type: 'image/png' })
      const output = await encodeImage(file, { crop: null, rotation: 0 }, 'image/webp', 100, true)
      expect(output.blob).toBe(file)
      expect(output).toMatchObject({ width: 20, height: 30 })
      expect(outputName(file.name, 'original')).toBe('photo.png')
      expect(close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('uses a distinct output name and preserves names containing dots', () => {
    expect(outputName('旅行.原图.png', 'image/jpeg')).toBe('旅行.原图.jpg')
    expect(outputName('photo', 'image/webp')).toBe('photo.webp')
  })
})


describe('image download naming', () => {
  it('supports zero-based padded sequences, templates, steps, and original extensions', () => {
    expect(imageDownloadNames(['a.png', 'b.jpg', 'c.webp'], { template: '{n}', start: 0, digits: 2, step: 1 })).toEqual(['00.png', '01.jpg', '02.webp'])
    expect(imageDownloadNames(['旅行.原图.png', 'b.jpg'], { template: '相册-{n}-{name}-精选', start: 1, digits: 3, step: 2 })).toEqual(['相册-001-旅行.原图-精选.png', '相册-003-b-精选.jpg'])
    expect(imageDownloadNames(['a.png', 'b.png'], { template: '{n}', start: 99, digits: 2, step: 1 })).toEqual(['99.png', '100.png'])
  })
  it('uses safe portable filenames and resolves case-insensitive collisions', () => {
    expect(imageDownloadNames(['a.png', 'b.png'], { template: '../CON', start: 0, digits: 2, step: 1 })).toEqual(['.._CON.png', '.._CON (1).png'])
    expect(imageDownloadNames(['CON.png', 'Photo.png', 'photo.png'])).toEqual(['_CON.png', 'Photo.png', 'photo (1).png'])
    expect(() => imageDownloadNames(['a.png'], { template: '{n}', start: -1, digits: 2, step: 1 })).toThrow('起始编号')
    expect(() => imageDownloadNames(['a.png'], { template: '{n}', start: 0, digits: 99, step: 1 })).toThrow('编号位数')
  })
})
