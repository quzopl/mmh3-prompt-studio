import { rm } from 'node:fs/promises'

/**
 * Katalog danych testu e2e czyszczony przed każdym przebiegiem. Bez tego
 * projekty z poprzednich uruchomień zostają na liście i ich nazwy zaczynają
 * kolidować z selektorami — test przechodził tylko za pierwszym razem.
 */
export default async function globalSetup(): Promise<void> {
  await rm('/tmp/mmh3-e2e', { recursive: true, force: true })
}
