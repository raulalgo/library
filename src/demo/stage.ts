// demo.html: the site in an iPhone-sized frame, played by the demo script (see player.ts).
// ?from=<section> starts from a section, ?lang=en|es picks the language, ?clean hides the controls and the frame.

const params = new URLSearchParams(location.search);
const site = document.querySelector<HTMLIFrameElement>('#site')!;
const from = document.querySelector<HTMLSelectElement>('#from')!;
const langPick = document.querySelector<HTMLSelectElement>('#lang')!;
const where = document.querySelector<HTMLElement>('#where')!;

document.body.classList.toggle('clean', params.has('clean'));
langPick.value = params.get('lang') === 'es' ? 'es' : 'en';

function fit() {
  const room = params.has('clean') ? 1 : Math.min((innerHeight - 90) / 852, (innerWidth - 32) / 393);
  document.documentElement.style.setProperty('--fit', String(Math.min(1, room)));
}
addEventListener('resize', fit);
fit();

function replay() {
  const q = new URLSearchParams({ demo: params.get('from') ?? '', lang: langPick.value });
  where.textContent = 'loading…';
  site.src = `/?${q}`;
}

function remember(key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
  history.replaceState(null, '', `?${params}`.replace(/=(&|$)/g, '$1'));
  replay();
}

document.querySelector('#replay')!.addEventListener('click', replay);
from.addEventListener('change', () => remember('from', from.value));
langPick.addEventListener('change', () => remember('lang', langPick.value));
addEventListener('keydown', (e) => e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && replay());

// The status bar takes the page's background.
site.addEventListener('load', () => {
  const bg = site.contentDocument && getComputedStyle(site.contentDocument.body).backgroundColor;
  if (bg) document.documentElement.style.setProperty('--page', bg);
});

const seconds = (ms: number) => (ms / 1000).toFixed(1);
let total = 0;
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data?.demo) return;
  const d = e.data;
  if (d.outline) {
    total = d.total;
    // the sections, as the script has them now
    const keep = params.get('from') ?? '';
    from.replaceChildren(new Option('From the start', ''), ...d.outline.map((name: string) => new Option(`From ${name}`, name)));
    from.value = d.outline.includes(keep) ? keep : '';
  } else if (d.done) {
    where.textContent = `done · ${seconds(total)} s`;
  } else {
    where.textContent = `${seconds(d.t)} / ${seconds(total)} s · ${d.section}${d.label ? ` · ${d.label}` : ''}`;
  }
});

replay();
