import type { AppSnapshot } from '../shared/types'

export async function resolveAndroidFiles(snapshot: AppSnapshot, check: (paths: string[]) => Promise<Record<string, boolean>>): Promise<AppSnapshot> {
  const paths = [...new Set([...snapshot.tracks.map((track) => track.path), ...snapshot.imageLibrary.assets.map((asset) => asset.path), ...snapshot.imageLibrary.roots.map((root) => root.path)])]
  const exists = await check(paths)
  return { ...snapshot,
    tracks: snapshot.tracks.map((track) => ({ ...track, missing: !exists[track.path] })),
    imageLibrary: { ...snapshot.imageLibrary,
      roots: snapshot.imageLibrary.roots.map((root) => ({ ...root, missing: !exists[root.path] })),
      assets: snapshot.imageLibrary.assets.map((asset) => ({ ...asset, missing: !exists[asset.path] })),
    },
  }
}
