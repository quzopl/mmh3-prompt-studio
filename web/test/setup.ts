import '@testing-library/jest-dom/vitest'

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
