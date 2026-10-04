// Temporary: open the site with ?debug to see what the phone reports during a touch, for the flick up on the shelf.

const on = new URLSearchParams(location.search).has('debug');
let box: HTMLPreElement | null = null;
const lines: string[] = [];

export function touchLog(line: string) {
  if (!on) return;
  if (!box) {
    box = document.createElement('pre');
    box.style.cssText =
      'position:fixed;left:8px;right:8px;top:8px;z-index:99;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;' +
      'background:rgba(0,0,0,.75);color:#fff;border-radius:6px;pointer-events:none;white-space:pre-wrap';
    document.body.append(box);
  }
  lines.push(line);
  if (lines.length > 14) lines.shift();
  box.textContent = lines.join('\n');
}
