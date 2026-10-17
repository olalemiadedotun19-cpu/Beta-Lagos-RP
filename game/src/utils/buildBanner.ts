/**
 * Temporary check: shows a small banner for 6 seconds at launch so you can tell the NEW graphics build is the one
 * running (phones have no easy console). Delete this file and its two lines in main.tsx once you've seen it.
 */
export function showBuildBanner(text: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:99999;' +
    'padding:8px 14px;border-radius:10px;background:rgba(10,17,40,.92);color:#9fe3ff;font:600 13px system-ui,sans-serif;' +
    'pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.4)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
  console.info(`[International Life] ${text}`);
}
