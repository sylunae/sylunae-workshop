import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface AudioWaveformProps {
  media: HTMLAudioElement | null
  src: string
}

function waveformColors() {
  const styles = getComputedStyle(document.documentElement)
  return {
    cursorColor: styles.getPropertyValue('--brand').trim(),
    progressColor: styles.getPropertyValue('--brand').trim(),
    waveColor: styles.getPropertyValue('--faint').trim(),
  }
}

function renderEnergyWaveform(peaks: Array<Float32Array | number[]>, ctx: CanvasRenderingContext2D) {
  const primaryChannel = peaks[0]
  if (!primaryChannel?.length) return

  const secondaryChannel = peaks[1] ?? primaryChannel
  const { width, height } = ctx.canvas
  const halfHeight = height / 2
  const samplesPerColumn = primaryChannel.length / width
  const amplitudes = new Float32Array(width)

  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * samplesPerColumn)
    const end = Math.min(primaryChannel.length, Math.ceil((x + 1) * samplesPerColumn))
    let energy = 0

    for (let index = start; index < end; index++) {
      const primary = primaryChannel[index] ?? 0
      const secondary = secondaryChannel[index] ?? primary
      energy += (primary * primary + secondary * secondary) / 2
    }

    const rms = Math.sqrt(energy / Math.max(1, end - start))
    amplitudes[x] = rms / (rms + 0.32)
  }

  ctx.beginPath()
  ctx.moveTo(0, halfHeight)
  for (let x = 0; x < width; x++) ctx.lineTo(x, halfHeight - amplitudes[x] * halfHeight)
  for (let x = width - 1; x >= 0; x--) ctx.lineTo(x, halfHeight + amplitudes[x] * halfHeight)
  ctx.closePath()
  ctx.fill()
}

export function AudioWaveform({ media, src }: AudioWaveformProps) {
  const container = useRef<HTMLDivElement>(null)
  const wavesurfer = useRef<WaveSurfer | null>(null)
  const loadedSrc = useRef('')
  const loadVersion = useRef(0)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!container.current || !media) return

    const version = ++loadVersion.current
    loadedSrc.current = src
    setLoading(true)
    setUnavailable(false)

    const instance = WaveSurfer.create({
      container: container.current,
      media,
      height: 'auto',
      cursorWidth: 1,
      dragToSeek: true,
      fillParent: true,
      hideScrollbar: true,
      renderFunction: renderEnergyWaveform,
      ...waveformColors(),
    })
    wavesurfer.current = instance

    const stopReadyListener = instance.once('ready', () => {
      if (loadVersion.current === version) setLoading(false)
    })
    const stopErrorListener = instance.once('error', () => {
      if (loadVersion.current === version) {
        setLoading(false)
        setUnavailable(true)
      }
    })

    const themeObserver = new MutationObserver(() => instance.setOptions(waveformColors()))
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'], attributes: true })

    return () => {
      themeObserver.disconnect()
      stopReadyListener()
      stopErrorListener()
      instance.destroy()
      wavesurfer.current = null
      loadedSrc.current = ''
    }
  }, [media])

  useEffect(() => {
    const instance = wavesurfer.current
    if (!instance || !src || loadedSrc.current === src) return

    const version = ++loadVersion.current
    loadedSrc.current = src
    setLoading(true)
    setUnavailable(false)
    void instance.load(src).then(() => {
      if (loadVersion.current === version) setLoading(false)
    }).catch(() => {
      if (loadVersion.current === version) {
        setLoading(false)
        setUnavailable(true)
      }
    })
  }, [media, src])

  return <div className={`audio-waveform ${loading ? 'loading' : ''} ${unavailable ? 'unavailable' : ''}`} aria-label="当前歌曲波形，可点击跳转播放位置">
    <div ref={container} className="audio-waveform-canvas" />
    {loading && <span className="audio-waveform-status">正在生成波形</span>}
    {unavailable && <span className="audio-waveform-status">波形暂不可用</span>}
  </div>
}
