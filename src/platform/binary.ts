export function encodeBytes(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}
export function decodeBytes(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)) }
