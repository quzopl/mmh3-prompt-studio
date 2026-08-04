const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** Timestamp cięcia w formacie MM:SS.mmm wymaganym przez guide. */
export function formatShotTime(ms: number): string {
  const total = Math.round(ms)
  const totalSeconds = Math.floor(total / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const millis = total % 1000
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`
}

/** Czas w linii alignmentu: sekundy z dokładnie dwoma miejscami po przecinku. */
export function formatAlignSeconds(ms: number): string {
  return (Math.round(ms / 10) / 100).toFixed(2)
}
