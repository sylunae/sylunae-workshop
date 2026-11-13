export const workspacePaths = {
  home: { home: '/' },
  notes: { home: '/notes' },
  tasks: { goals: '/tasks/goals', todos: '/tasks/todos', pomodoro: '/tasks/pomodoro', countdown: '/tasks/countdown' },
  collection: { bangumi: '/collection/bangumi', images: '/collection/images', memes: '/collection/memes', stickers: '/collection/stickers' },
  music: { tracks: '/music/tracks', albums: '/music/albums', 'white-noise': '/music/white-noise' },
  tools: {
    home: '/tools',
    clipboard: '/tools/clipboard',
    translation: '/tools/translation',
    launcher: '/tools/launcher',
    image: '/tools/image',
    audio: '/tools/audio',
    birthdays: '/tools/birthdays',
    conversion: '/tools/conversion',
    'music-toolbox': '/tools/music-toolbox',
  },
} as const

export type Workspace = keyof typeof workspacePaths
export type WorkspaceView<T extends Workspace> = keyof typeof workspacePaths[T]
type WorkspaceRoute = { [T in Workspace]: { tool: T; view: WorkspaceView<T> } }[Workspace]

const routesByPath = new Map<string, WorkspaceRoute>(
  Object.entries(workspacePaths).flatMap(([tool, views]) =>
    Object.entries(views).map(([view, path]) => [path, { tool, view } as WorkspaceRoute] as const),
  ),
)

export function workspaceHref<T extends Workspace>(tool: T, view: WorkspaceView<T>) {
  const views = workspacePaths[tool]
  return '#' + (Object.hasOwn(views, view) ? views[view] : Object.values(views)[0])
}

export function readWorkspaceRoute(hash: string): WorkspaceRoute | undefined {
  if (!hash.startsWith('#/')) return undefined
  try {
    const path = decodeURIComponent(hash.slice(1))
    const normalizedPath = path.replace(/\/$/, '') || '/'
    return routesByPath.get(normalizedPath === '/collection/rss' ? workspacePaths.collection.bangumi : normalizedPath)
  } catch {
    return undefined
  }
}
