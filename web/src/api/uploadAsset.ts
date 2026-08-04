import type { Asset, Project } from '@mmh3/shared'
import { ApiError } from './client.js'

export async function uploadAsset(
  slug: string,
  file: File,
): Promise<{ asset: Asset; project: Project }> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/projects/${slug}/assets`, { method: 'POST', body: form })
  if (!response.ok) {
    let message = `Serwer odpowiedział kodem ${response.status}`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Odpowiedź bez JSON-a — zostaje komunikat z kodem statusu.
    }
    throw new ApiError(message, response.status)
  }
  return await response.json() as { asset: Asset; project: Project }
}
