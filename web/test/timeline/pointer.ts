/**
 * jsdom nie zna klasy `PointerEvent` — sprawdzono: `typeof PointerEvent`
 * zwraca tam `undefined`. Przez to `fireEvent.pointerDown` buduje zwykłe
 * `Event` bez współrzędnych i React widzi `clientX` równe `null`, więc każdy
 * test przeciągania mierzyłby zero. `MouseEvent` o nazwie zdarzenia wskaźnika
 * niesie współrzędne i React czyta je poprawnie.
 */
export function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  clientX: number,
): void {
  element.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }))
}
