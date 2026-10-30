import { storageKey } from './storageEnvironment'
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

function useStorageState<T>(storage: Storage, key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = storage.getItem(key)
      return saved === null ? initialValue : JSON.parse(saved) as T
    } catch {
      return initialValue
    }
  })

  const setPersistentValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    setValue((currentValue) => {
      const next = typeof nextValue === 'function'
        ? (nextValue as (value: T) => T)(currentValue)
        : nextValue
      try {
        storage.setItem(key, JSON.stringify(next))
      } catch {
        // Navigation should remain usable when browser storage is unavailable.
      }
      return next
    })
  }, [key, storage])

  return [value, setPersistentValue]
}

/** Keeps a preference across app launches. */
export function usePersistentState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  return useStorageState(window.localStorage, storageKey(key), initialValue)
}

/** Keeps transient navigation through reloads, but resets when the window is closed. */
export function useSessionState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  return useStorageState(window.sessionStorage, storageKey(key), initialValue)
}
