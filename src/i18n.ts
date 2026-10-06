export type Lang = 'es' | 'en';

const strings = {
  es: {
    title: 'La biblioteca de Isabel & Linda',
    titleWord: 'Biblioteca',
    subtitle: 'Linda le ha regalado a su nieta, Isabel, un amor por los libros que hace de la hora de dormir una diversión sin fin.',
    intro: 'Los libros de las estanterías de Isabel son una mezcla de los que Linda aprendió a querer en sus años de bibliotecaria y de regalos que hemos recibido a lo largo de los años.',
    viewAll: 'Ver todos los libros',
    allBooks: 'Todos los libros',
    close: 'Cerrar',
    disclosure: 'Algunos enlaces de compra son de afiliado.',
    langButton: 'English',
    spanish: 'Español',
    english: 'Inglés',
    placeholderNote: 'Ficha provisional. La portada y los datos llegarán con el escaneo.',
    prevBook: 'Libro anterior',
    nextBook: 'Libro siguiente',
    polaroid: ['La isla', 'Isabel y Linda'],
    binding: { hardback: 'Tapa dura', paperback: 'Tapa blanda', board: 'Libro de cartón', 'box set': 'Estuche' },
    langName: { es: 'español', en: 'inglés', fr: 'francés', de: 'alemán', nl: 'neerlandés', sv: 'sueco', pl: 'polaco' } as Record<string, string>,
    illustratedBy: 'Ilustraciones de',
    translatedBy: 'Traducción de',
    original: 'Original',
    firstPublished: 'Primera edición',
    series: 'Colección',
    contents: 'Contenido',
    edition: 'Esta edición',
    pages: (n: number) => `${n} páginas`,
  },
  en: {
    title: "Isabel & Linda's Library",
    titleWord: 'Library',
    subtitle: 'Linda has gifted her granddaughter, Isabel, with a love for books that makes bedtime endless fun.',
    intro: 'The books on Isabel’s shelves are a mix of those Linda grew to love in her years as a librarian and gifts we’ve received over the years.',
    viewAll: 'View all books',
    allBooks: 'All the books',
    close: 'Close',
    disclosure: 'Some shop links are affiliate links.',
    langButton: 'Español',
    spanish: 'Spanish',
    english: 'English',
    placeholderNote: 'Placeholder entry. The cover and details arrive with the scan.',
    prevBook: 'Previous book',
    nextBook: 'Next book',
    polaroid: ['The island', 'Isabel & Linda'],
    binding: { hardback: 'Hardback', paperback: 'Paperback', board: 'Board book', 'box set': 'Box set' },
    langName: { es: 'Spanish', en: 'English', fr: 'French', de: 'German', nl: 'Dutch', sv: 'Swedish', pl: 'Polish' } as Record<string, string>,
    illustratedBy: 'Illustrated by',
    translatedBy: 'Translated by',
    original: 'Original',
    firstPublished: 'First published',
    series: 'Series',
    contents: 'Contents',
    edition: 'This edition',
    pages: (n: number) => `${n} pages`,
  },
};

let current: Lang = detect();

function detect(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'es' || saved === 'en') return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function lang(): Lang {
  return current;
}

export function t() {
  return strings[current];
}

export function setLang(next: Lang) {
  current = next;
  try {
    localStorage.setItem('lang', next);
  } catch {}
  apply();
}

export function apply() {
  document.documentElement.lang = current;
  const s = strings[current] as Record<string, unknown>;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = s[el.dataset.i18n!];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => {
    const v = s[el.dataset.i18nLabel!];
    if (typeof v === 'string') el.setAttribute('aria-label', v);
  });
  document.title = strings[current].title;
}
