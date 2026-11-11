interface ImportMetaEnv {
  readonly MAIN_VITE_RESOURCE_PUBLIC_BASE_URL?: string
  readonly MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
