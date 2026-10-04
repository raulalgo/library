export type Lang = 'es' | 'en';

const strings = {
  es: {
    title: 'La biblioteca de Isabel & Linda',
    titleWord: 'Biblioteca',
    subtitle: 'Tras una vida como bibliotecaria dedicada a la literatura infantil, Linda ha inspirado la preciosa biblioteca de Isabel',
    count: (books: number) => `${books} libros · 2 idiomas`,
    footer: 'Hecho por Raúl para Isabel, con los libros de Linda.',
    viewAll: 'Ver todos los libros',
    disclosure: 'Algunos enlaces de compra son de afiliado.',
    langButton: 'English',
    spanish: 'Español',
    english: 'Inglés',
    placeholderNote: 'Ficha provisional. La portada y los datos llegarán con el escaneo.',
    prevBook: 'Libro anterior',
    nextBook: 'Libro siguiente',
    polaroid: ['La isla, en casa', 'La estantería', 'Isabel y Linda'],
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
    subtitle: 'After a life as a librarian dedicated to children literature, Linda has inspired Isabel’s beautiful library',
    count: (books: number) => `${books} books · 2 languages`,
    footer: "Made by Raúl for Isabel, from Linda's books.",
    viewAll: 'View all books',
    disclosure: 'Some shop links are affiliate links.',
    langButton: 'Español',
    spanish: 'Spanish',
    english: 'English',
    placeholderNote: 'Placeholder entry. The cover and details arrive with the scan.',
    prevBook: 'Previous book',
    nextBook: 'Next book',
    polaroid: ['The island, at home', 'The shelf', 'Isabel & Linda'],
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
