/** Production names remain unchanged so existing user data stays in place. */
export const applicationDatabaseName = import.meta.env.DEV ? 'siyue-workshop-development' : 'siyue-workshop'
export function storageKey(key: string): string {
  return import.meta.env.DEV ? `development:${key}` : key
}
