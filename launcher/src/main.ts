import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import './style.css';
import { formatBytes, planUpdate, type Installed, type Manifest, type Plan } from './plan.ts';
import { UPDATE_URL, applyUpdate, fetchManifest, isNative, launchGame, readInstalled } from './updater.ts';

const root = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function show(html: string, handlers: Record<string, () => void> = {}): void {
  root.innerHTML = `<div class="card"><div class="brand">DOTCON</div><h1>International Life</h1>${html}</div>`;
  for (const [id, fn] of Object.entries(handlers)) root.querySelector<HTMLElement>(`#${id}`)?.addEventListener('click', fn);
}

const spinner = (text: string) => show(`<div class="spin"></div><p>${esc(text)}</p>`);

async function start(): Promise<void> {
  if (!isNative()) {
    location.href = `${UPDATE_URL}/index.html`; // opened in a normal browser: just play the web version
    return;
  }
  spinner('Checking for updates…');
  const installed = await readInstalled();
  let manifest: Manifest;
  try {
    manifest = await fetchManifest();
  } catch (e) {
    if (installed?.version && installed.status === 'ready') return play(); // offline: play what is on the phone
    return fail(installed ? 'The last download was not finished. Connect to the internet to finish it.' : 'Connect to the internet to download the game (first time only).', e, () => void start());
  }

  const plan = planUpdate(manifest, installed);
  if (!plan.todo.length) {
    if (installed?.status !== 'ready') await applyUpdate(manifest, installed, plan, () => undefined); // only the final bookkeeping is left
    return play();
  }
  await prompt(manifest, installed, plan);
}

async function prompt(m: Manifest, inst: Installed | null, plan: Plan): Promise<void> {
  let cellular = false;
  try {
    cellular = (await Network.getStatus()).connectionType === 'cellular';
  } catch {
    /* unknown connection: no warning */
  }
  const what = plan.first ? 'First-time download' : inst?.status === 'updating' ? 'Finish update' : 'Update available';
  const canSkip = !plan.mustUpdate;
  show(
    `<p>${what}</p><div class="big">${formatBytes(plan.bytes)}</div>
     <p>${plan.todo.length} file${plan.todo.length === 1 ? '' : 's'} to download${inst?.version ? ` · ${esc(inst.version)} → ${esc(m.version)}` : ` · version ${esc(m.version)}`}</p>
     ${m.notes ? `<p>${esc(m.notes)}</p>` : ''}
     ${cellular ? '<p class="warn small">You are on mobile data. Wi-Fi is recommended.</p>' : ''}
     <div class="row">${canSkip ? '<button id="skip">Later</button>' : ''}<button id="go" class="primary">Download</button></div>`,
    { go: () => void download(m, inst, plan), skip: () => void play() },
  );
}

async function download(m: Manifest, inst: Installed | null, plan: Plan): Promise<void> {
  show(
    `<p id="what">Downloading…</p><div class="bar"><i id="fill"></i></div><p id="stat" class="small">Starting…</p><p class="small">Keep the app open until it finishes.</p>`,
  );
  const fill = root.querySelector<HTMLElement>('#fill')!;
  const stat = root.querySelector<HTMLElement>('#stat')!;
  let last = 0;
  try {
    await applyUpdate(m, inst, plan, (p) => {
      const now = performance.now();
      if (now - last < 100 && p.doneBytes < p.totalBytes) return;
      last = now;
      const pct = p.totalBytes ? (p.doneBytes / p.totalBytes) * 100 : 100;
      fill.style.width = `${pct.toFixed(1)}%`;
      stat.textContent = `${formatBytes(p.doneBytes)} / ${formatBytes(p.totalBytes)} · ${p.doneFiles}/${p.totalFiles} files`;
    });
  } catch (e) {
    const again = await readInstalled();
    return fail('Download stopped. Your progress is saved, tap Retry to continue.', e, () => void download(m, again, planUpdate(m, again)), again?.status === 'ready' && !plan.mustUpdate);
  }
  return play();
}

function fail(message: string, e: unknown, retry: () => void, canSkip = false): void {
  console.error(e);
  const detail = e instanceof Error ? e.message : String(e);
  show(`<p class="err">${esc(message)}</p><p class="small">${esc(detail)}</p><div class="row">${canSkip ? '<button id="skip">Play anyway</button>' : ''}<button id="retry" class="primary">Retry</button></div>`, {
    retry,
    skip: () => void play(),
  });
}

async function play(): Promise<void> {
  spinner('Starting game…');
  try {
    await launchGame();
  } catch (e) {
    fail('Could not start the game.', e, () => void play());
  }
}

App.addListener('backButton', () => void App.exitApp());
void start();
