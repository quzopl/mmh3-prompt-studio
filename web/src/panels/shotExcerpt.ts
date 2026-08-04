import type { Token } from '@mmh3/shared'
import type { ShotSpan } from '../timeline/spans.js'

/** Playhead na granicy należy do ujęcia, które się w tym miejscu zaczyna. */
export function shotAtMs(spans: ShotSpan[], ms: number): ShotSpan | undefined {
  const hit = spans.find(span => ms >= span.startMs && ms < span.endMs)
  if (hit) return hit
  return spans[spans.length - 1]
}

/**
 * Fragment gotowego promptu należący do ujęcia — od jego nagłówka do nagłówka
 * następnego. Monitor pokazuje wtedy dokładnie tekst, który pójdzie do modelu,
 * zamiast własnej rekonstrukcji, która mogłaby się z nim rozjechać. Offsety
 * bierzemy wyłącznie z mapy tokenów — żadnego własnego szukania w tekście.
 */
export function shotExcerpt(prompt: string, tokens: Token[], shotId: string): string {
  const shotTokens = tokens
    .filter(token => token.ref.kind === 'shot')
    .sort((a, b) => a.start - b.start)
  const position = shotTokens.findIndex(token => token.ref.id === shotId)
  const current = shotTokens[position]
  if (!current) return ''
  const next = shotTokens[position + 1]
  // `slice` samo obcina indeksy spoza zakresu, więc niespójne offsety (np.
  // token z poprzedniej kompilacji) dają co najwyżej pusty ciąg, nigdy wyjątek.
  return prompt.slice(current.start, next?.start ?? prompt.length).trim()
}
