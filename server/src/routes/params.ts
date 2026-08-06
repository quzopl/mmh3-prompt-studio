import type { FastifyReply } from 'fastify'
import { z } from 'zod'

/** Wyłącznie kształt, jaki produkuje slugify — nic z separatorem ani kropką. */
export const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Niepoprawny identyfikator projektu')

/** Kształt, jaki produkuje `saveAsset`: `asset-` i UUID. Nic, co byłoby przedrostkiem cudzej nazwy. */
export const AssetIdSchema = z.string().regex(/^asset-[0-9a-f-]{36}$/, 'Niepoprawny identyfikator assetu')

export const SlugParams = z.object({ slug: SlugSchema })
export const AssetParams = z.object({ slug: SlugSchema, assetId: AssetIdSchema })

/**
 * Klucz wątku rozmowy (`threadKey` w `llm/chatStore.ts`): `style`,
 * `audio:<pole>`, `speaker:<id>:<pole>`, `shot:<id>:<indeks>`. Nie jest częścią
 * żadnej ścieżki na dysku — służy wyłącznie do odfiltrowania wątku z listy —
 * więc nie potrzebuje straży przed przejściem po katalogach, jaką ma
 * `AssetIdSchema`. Górna granica długości jest tu po to, żeby żądanie z
 * absurdalnie długim kluczem odpadło na wejściu, a nie po przeczytaniu pliku.
 */
export const ChatParams = z.object({
  slug: SlugSchema,
  key: z.string().min(1).max(200),
})

/**
 * Jedno miejsce dla trzech plików tras. Straż zakładana per miejsce rozjeżdża się
 * przy pierwszym kolejnym pliku tras — a ustalenie o przejściu po ścieżce
 * pokazało, ile taka rozbieżność kosztuje.
 */
export function parseParamsOrReply<T>(
  schema: z.ZodType<T>,
  params: unknown,
  reply: FastifyReply,
): T | null {
  const parsed = schema.safeParse(params)
  if (parsed.success) return parsed.data
  reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Niepoprawne parametry' })
  return null
}
