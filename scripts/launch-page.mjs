// Builds the launcher's index.html from the game's own launch sequence (game/public/launch/launch.html),
// so the APK opens with exactly the same DOTCON -> logo -> welcome -> loading screens as the game.
// Pure function, no file access, so `npm test` can check it.

/**
 * @param {string} src        the game's launch.html
 * @param {string} bridgeJs   launcher/launch-bridge.js
 * @param {string} moduleTag  the <script type="module"> tag Vite wrote for launcher/src/main.ts
 */
export function buildLaunchPage(src, bridgeJs, moduleTag) {
  const need = (ok, what) => {
    if (!ok) throw new Error(`launch.html no longer matches what the launcher expects (${what}). Update scripts/launch-page.mjs / launcher/launch-bridge.js.`);
  };
  need(src.includes('</head>'), '</head>');
  need(src.includes('const CONFIG ='), 'const CONFIG');
  need(src.includes('async function runLoader()'), 'runLoader()');
  need(src.includes("document.querySelector"), 'script');
  need(src.includes('id="load"') && src.includes('class="ldw"'), 'loading screen markup');
  need(src.includes('function ui') || src.includes('const ui ='), 'ui helper');
  const end = src.lastIndexOf('</body>');
  need(end > 0, '</body>');
  const h = src.indexOf('</head>');
  const flag = '<script>window.__IS_LAUNCHER=true;</script>';
  // slices, not String.replace: the scripts contain "$" characters that replace() would treat specially
  return src.slice(0, h) + flag + src.slice(h, end) + '<script>\n' + bridgeJs + '\n</script>\n' + moduleTag + '\n' + src.slice(end);
}
