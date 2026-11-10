/**
 * Hand-sketched line icons (24×24, drawn in the current text colour).
 * The slightly wobbly, overshooting strokes are deliberate: they give a pen-on-paper feel.
 * To add one: draw it on a 24×24 grid with round line ends, and keep it to a few strokes so it reads at 18px.
 */

const svg = (body: string) =>
  `<svg class="hl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  hiking: svg(
    '<path d="M2.2 19.4 L8.6 8.3 L15.4 19.2"/><path d="M11.6 13.6 L15 8.8 L21.7 19.4"/>' +
      '<path d="M6.9 11.4 L8 12.3 L9.1 11.2 L10.2 11.9"/><path d="M1.6 19.8 C7.4 19.2 15.2 20 22.4 19.3"/>',
  ),
  camping: svg(
    '<path d="M3 19.5 L12.7 4.1"/><path d="M10.9 4.3 L21 19.6"/>' +
      '<path d="M11.9 10.1 L9.3 19.3"/><path d="M11.9 10.1 C12.8 13.2 13.8 16.6 15.1 19.3"/>' +
      '<path d="M1.7 19.7 C8 19.2 16 19.9 22.3 19.4"/>',
  ),
  surfing: svg(
    '<path d="M2.1 16.4 C4 10 9 5.4 15 6.1 C19.1 6.6 20.9 9.6 19.7 12 C18.7 13.9 16 13.7 15.6 11.6 C15.3 10.2 16.5 9.5 17.4 10.3"/>' +
      '<path d="M1.8 19.3 C5 18 7.2 20.1 10.2 18.8 C13 17.7 15.4 19.9 18.3 18.7 C19.8 18.1 21 18.6 22.2 18.4"/>' +
      '<path d="M20.6 5.6 L21.3 4.6"/><path d="M22 7.6 L22.6 7.3"/>',
  ),
  climbing: svg(
    '<path d="M10.4 2.9 C7.5 2.9 6.3 5.3 6.7 8.2 L8.1 17.4 C8.6 20.4 11.7 21.4 14 20.1 C15.6 19.2 16.3 17.7 16.5 16"/>' +
      '<path d="M16.1 14.4 L17.3 6.4 C17.6 4.3 15.6 2.9 13.2 2.9"/><path d="M16.6 15.8 L17.9 15.9"/>' +
      '<path d="M2.4 19.8 C4.6 17.6 6.4 20.6 8.6 18.6"/>',
  ),
  skiing: svg(
    '<path d="M5.6 3.5 C4.1 3.3 3.3 4.8 4.4 5.8 L19.8 20.5"/><path d="M18.4 3.5 C19.9 3.3 20.7 4.8 19.6 5.8 L4.2 20.5"/>' +
      '<path d="M8.6 21.4 L15.4 21.4"/>',
  ),
  diving: svg(
    '<path d="M3.6 10 C3.4 8.3 4.4 7.4 6 7.4 L10.6 7.6 C11.4 7.6 11.8 8.2 11.7 9 L11.2 13.2 C11 14.2 10.2 14.6 9.2 14.4 L5.6 13.8 C4.4 13.6 3.8 12.8 3.7 11.4"/>' +
      '<path d="M20.4 10 C20.6 8.3 19.6 7.4 18 7.4 L13.4 7.6 C12.6 7.6 12.2 8.2 12.3 9 L12.8 13.2 C13 14.2 13.8 14.6 14.8 14.4 L18.4 13.8 C19.6 13.6 20.2 12.8 20.3 11.4"/>' +
      '<path d="M3.6 10.2 L1.7 10.6"/><path d="M20.4 10.2 L22.3 10.6"/>' +
      '<circle cx="16.8" cy="18.6" r="1.2"/><circle cx="19.6" cy="20.6" r="0.7"/>',
  ),
  kayaking: svg(
    '<path d="M1.9 14.6 C6 17.5 18 17.5 22.1 14.2 C17.6 13.1 6.5 13.2 2.4 14.4"/>' +
      '<path d="M6.3 20.2 L17.7 4.7"/>' +
      '<path d="M17.7 4.7 C17.3 3.4 18.5 2.2 19.8 2.7 C20.9 3.3 20.5 4.8 19 5.4 C18.5 5.6 18 5.4 17.7 4.9"/>' +
      '<path d="M6.3 20.2 C6.7 21.5 5.5 22.6 4.3 22 C3.2 21.4 3.6 19.9 5 19.5 C5.6 19.3 6.1 19.6 6.3 20"/>',
  ),
  other: svg('<path d="M12 3 L14.4 9 L20.8 9.4 L15.8 13.4 L17.6 19.8 L12 16.2 L6.4 19.9 L8.2 13.4 L3.2 9.3 L9.6 9 L12.3 2.7"/>'),
  pin: svg('<path d="M12 21.2 C8.4 16.8 5.6 13.4 5.6 9.6 C5.6 5.9 8.5 3.2 12 3.2 C15.6 3.2 18.4 6 18.4 9.6 C18.4 13.4 15.5 16.9 11.8 21.4"/><circle cx="12" cy="9.6" r="2.3"/>'),
  map: svg('<path d="M3 6.2 L8.6 4 L15.4 6.4 L21 4.3 L21 17.8 L15.4 20 L8.6 17.6 L3 19.8 Z"/><path d="M8.6 4.2 L8.6 17.4"/><path d="M15.4 6.6 L15.4 19.8"/>'),
  list: svg('<path d="M4 6.4 L20.2 6.1"/><path d="M4 12.1 L20 12"/><path d="M4 17.8 L20.3 17.6"/>'),
};
