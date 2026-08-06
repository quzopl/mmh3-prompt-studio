import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { useLang } from '../src/i18n/useT.js'

// Domyślnym językiem interfejsu jest angielski (`src/i18n/useT.ts`). Pakiet
// jednostkowy szuka jednak elementów po polskich nazwach dostępności, więc
// przypina język JAWNIE zamiast dziedziczyć domyślny: test ma padać na
// asercji, a nie dlatego, że ktoś przestawił wartość domyślną i selektor
// przestał cokolwiek znajdować. Sam fakt, że domyślny jest angielski,
// pilnuje osobny test w `web/test/i18n.test.tsx`.
beforeEach(() => {
  useLang.setState({ lang: 'pl' })
})

// jsdom nie implementuje `Blob.prototype.text`, więc `await file.text()` rzuca
// TypeError. Testy wgrywania pliku łapały ten wyjątek zamiast wyniku parsowania
// i przechodziły z niewłaściwego powodu — żaden nie sprawdzał ścieżki, w której
// plik daje się odczytać.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}
