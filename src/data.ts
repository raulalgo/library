import data from '../data/books.json';

export type Bilingual = { es: string; en: string };
export type Binding = 'hardback' | 'paperback' | 'board' | 'box set';

export type Book = {
  id: string;
  title: string;
  author: string;
  lang: 'es' | 'en';
  placeholder: boolean;
  flat: boolean;
  boxSet: boolean;
  // dimensions in metres: height, cover width, thickness
  h: number;
  w: number;
  t: number;
  color: string;
  // straightened spine photo and front cover image, relative to the site root
  spine?: string;
  cover?: string;
  // shown in the detail view
  // real height, cover width and thickness in mm (h, w and t above get scaled down where the book is too big for the shelf)
  mm: { h: number; w: number; t: number };
  authors: string[];
  illustrators: string[];
  translators: string[];
  about?: Bilingual;
  original?: { title: string; lang: string; year?: number };
  firstPublished?: number;
  series?: string;
  contents?: Bilingual;
  publisher: string;
  year: number | null;
  binding: Binding;
  pages: number;
};

// One entry of data/books.json; sizes there are in millimetres.
type Entry = {
  slug: string;
  shelf: 'es' | 'en';
  title: string;
  authors: string[];
  illustrators: string[];
  translators?: string[];
  about?: Bilingual;
  original?: { title: string; lang: string; year?: number };
  firstPublished?: number;
  series?: string;
  contents?: Bilingual;
  publisher: string;
  year: number | null;
  binding: Binding;
  pages: number;
  isbn: string;
  flat?: boolean;
  boxSet?: boolean;
  size: { h: number; w: number; t: number };
  spine?: string;
  cover?: string;
  color?: string;
};

// Stand-in colours for a book without a spine photo.
const palette = [
  '#e4572e', '#f3a712', '#29335c', '#669bbc', '#a8c686', '#db2763', '#7d5ba6',
  '#f0e2a3', '#2f9c95', '#ef8354', '#4f5d75', '#ffd23f', '#3bceac', '#ee4266',
  '#540d6e', '#0e79b2', '#bf1363', '#f39237', '#6a994e', '#f6f1e9', '#c1121f',
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function make(e: Entry): Book {
  return {
    id: e.slug,
    title: e.title,
    author: (e.authors.length ? e.authors : e.illustrators).join(', '),
    lang: e.shelf,
    placeholder: false,
    flat: !!e.flat,
    boxSet: !!e.boxSet,
    h: e.size.h / 1000,
    w: e.size.w / 1000,
    t: e.size.t / 1000,
    color: e.color ?? palette[hash(e.slug) % palette.length],
    spine: e.spine,
    cover: e.cover,
    mm: { h: e.size.h, w: e.size.w, t: e.size.t },
    authors: e.authors,
    illustrators: e.illustrators,
    translators: e.translators ?? [],
    about: e.about,
    original: e.original,
    firstPublished: e.firstPublished,
    series: e.series,
    contents: e.contents,
    publisher: e.publisher,
    year: e.year,
    binding: e.binding,
    pages: e.pages,
  };
}

export function loadBooks() {
  const books = (data.books as unknown as Entry[]).map(make);
  return { es: books.filter((b) => b.lang === 'es'), en: books.filter((b) => b.lang === 'en') };
}
