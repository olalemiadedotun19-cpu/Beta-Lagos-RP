/* Android launcher bridge. Injected at build time AFTER the Beta Lagos RP launch sequence script (see scripts/launch-page.mjs).
   The sequence is unchanged: DOTCON -> game logo -> "Welcome to Lagos" (tap) -> loading screen.
   Only the loading screen's job changes: instead of the demo loader it
     1. says CHECKING FOR UPDATES in the normal loading bar,
     2. if an update exists, asks UPDATE / LATER on that same screen,
     3. downloads it with the same bar (real bytes), then starts the game.
   The real work lives in launcher/src/main.ts (window.__LAUNCHER). */
(function () {
  if (typeof HOST !== 'undefined' && HOST) return; // inside the game: nothing to do
  CONFIG.onReady = function () {}; // the launcher switches to the game itself

  var css = document.createElement('style');
  css.textContent =
    '#upd{display:none;margin-bottom:calc(2.6*var(--vh))}' +
    '#upd.on{display:block}' +
    '#upd .k{font-size:clamp(11px,calc(2.8*var(--vh)),16px);letter-spacing:.16em;color:#e9e2d4;font-weight:600}' +
    '#upd .sz{font-size:clamp(26px,calc(8*var(--vh)),52px);font-weight:800;line-height:1.05;color:var(--gold);letter-spacing:.02em;margin:calc(.6*var(--vh)) 0}' +
    '#upd .s{font-size:clamp(10px,calc(2.4*var(--vh)),14px);letter-spacing:.12em;color:#cfc6d6;margin-top:calc(.6*var(--vh))}' +
    '#upd .w{color:#ffd34a}' +
    '#upd .r{display:flex;gap:calc(2.4*var(--vh));margin-top:calc(2.2*var(--vh))}' +
    '.btn.alt{background:rgba(255,255,255,.16);color:#fff}';
  document.head.appendChild(css);

  var box = document.createElement('div');
  box.id = 'upd';
  var ldw = document.querySelector('#load .ldw');
  ldw.insertBefore(box, ldw.firstChild);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // textContent: the notes come from the server, never as HTML
    return e;
  }

  function ask(info) {
    return new Promise(function (resolve) {
      box.textContent = '';
      box.appendChild(el('div', 'k', info.what.toUpperCase()));
      box.appendChild(el('div', 'sz', info.size));
      box.appendChild(el('div', 's', info.files + (info.files === 1 ? ' FILE' : ' FILES') + ' \u00b7 VERSION ' + info.version));
      if (info.notes) box.appendChild(el('div', 's', info.notes));
      if (info.cellular) box.appendChild(el('div', 's w', 'YOU ARE ON MOBILE DATA. WI-FI IS RECOMMENDED.'));
      var row = el('div', 'r');
      function done(answer) {
        box.classList.remove('on');
        resolve(answer);
      }
      if (info.canSkip) {
        var later = el('button', 'btn alt', 'LATER');
        later.onclick = function () { done(false); };
        row.appendChild(later);
      }
      var go = el('button', 'btn', info.first ? 'DOWNLOAD' : 'UPDATE');
      go.onclick = function () { done(true); };
      row.appendChild(go);
      box.appendChild(row);
      box.classList.add('on');
    });
  }

  async function api() {
    for (var i = 0; i < 60 && !window.__LAUNCHER; i++) await sleep(100);
    if (!window.__LAUNCHER) throw new Error('Launcher is not ready');
    return window.__LAUNCHER;
  }

  runLoader = async function () {
    box.classList.remove('on');
    ui.label('Checking for updates');
    ui.set(0.06);
    var L = await api();
    var res = await L.check(); // throws "Failed to fetch" when there is nothing installed and no connection
    if (res.kind === 'update') {
      ui.set(0);
      ui.label('Update available');
      var yes = await ask(res);
      if (yes) {
        ui.label('Downloading update');
        await L.download(function (p) {
          ui.set(p.totalBytes ? p.doneBytes / p.totalBytes : 1);
          ui.label('Downloading update \u00b7 ' + L.fmt(p.doneBytes) + ' / ' + L.fmt(p.totalBytes));
        });
      }
    }
    ui.full();
    ui.label('Starting game');
    await sleep(600);
    await L.launch();
  };
})();
