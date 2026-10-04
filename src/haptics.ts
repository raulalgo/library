// Android Chrome supports the Vibration API. iOS Safari does not, but since iOS 18
// toggling an <input type="checkbox" switch> plays the system haptic. That is
// unofficial and may stop working; failing silently is fine.

let label: HTMLLabelElement | null = null;

function iosSwitch() {
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'haptic-switch';
  input.className = 'haptic';
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.className = 'haptic';
  document.body.append(input, label);
  return label;
}

export function tick() {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(6);
    return;
  }
  try {
    iosSwitch().click();
  } catch {}
}
