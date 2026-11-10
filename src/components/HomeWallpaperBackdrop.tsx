import { useEffect, useMemo, useState } from 'react'
import { defaultHomeWallpaperCopy } from '../shared/defaults'
import type { HomeWallpaper } from '../shared/types'

export const defaultHomeWallpaper: HomeWallpaper = {
  id: 'default',
  image: `${import.meta.env.BASE_URL}images/wallpaper.webp`,
  ...defaultHomeWallpaperCopy,
}
const defaultWallpapers = [defaultHomeWallpaper]

export function useHomeWallpaper(customWallpapers: HomeWallpaper[] | undefined, paused: boolean) {
  const wallpapers = customWallpapers?.length ? customWallpapers : defaultWallpapers
  const [slide, setSlide] = useState<{ index: number; previous: number | null }>({ index: 0, previous: null })

  useEffect(() => {
    setSlide({ index: 0, previous: null })
  }, [wallpapers])

  useEffect(() => {
    if (wallpapers.length < 2 || paused) return
    const timer = window.setInterval(() => {
      setSlide(({ index }) => ({ index: (index + 1) % wallpapers.length, previous: index }))
    }, 7_000)
    return () => clearInterval(timer)
  }, [wallpapers, paused])

  const active = wallpapers[slide.index] ?? wallpapers[0]
  const backgroundImage = useMemo(() => `url(${JSON.stringify(active.image)})`, [active.image])
  return {
    active,
    backgroundImage,
    outgoing: slide.previous === null ? undefined : wallpapers[slide.previous],
    finishTransition: () => setSlide((current) => current === slide ? { ...current, previous: null } : current),
  }
}

export function HomeWallpaperBackdrop({ active, outgoing, finishTransition }: Omit<ReturnType<typeof useHomeWallpaper>, 'backgroundImage'>) {
  return <div className="home-backdrop" aria-hidden="true">
    <div key={active.id} className={`wallpaper-layer wallpaper-layer-active${active.id !== 'default' ? ' private-media' : ''}`} />
    {outgoing && outgoing.id !== active.id && <div key={outgoing.id} className={`wallpaper-layer wallpaper-layer-outgoing${outgoing.id !== 'default' ? ' private-media' : ''}`} style={{ backgroundImage: `url(${JSON.stringify(outgoing.image)})` }} onAnimationEnd={finishTransition} />}
  </div>
}
