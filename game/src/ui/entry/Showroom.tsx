import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Crown, Loader2, LogOut, Play, RotateCw, Shirt, Watch, ZoomIn, ZoomOut } from 'lucide-react';
import type { Account } from '../../auth/AccountStore';
import { useOrientation } from '../../utils/useOrientation';
import {
  WARDROBE_CATEGORIES,
  WARDROBE_ITEMS,
  itemsOf,
  sanitizeOutfit,
  type Outfit,
  type WardrobeCategoryId,
  type WardrobeItem,
} from '../../wardrobe/Wardrobe';
import { ShowroomScene, type FocusRect, type ViewMode } from './ShowroomScene';

interface ShowroomProps {
  account: Account;
  initialOutfit: Outfit | undefined;
  /** shown under the title (e.g. "Starting a new life replaces your saved progress") */
  note?: string;
  onStart: (outfit: Outfit) => void;
  onSignOut: () => void;
}

const SLOTS_PER_EMPTY_CATEGORY = 6; // two rows of three blank placeholders
const HOME_YAW_LANDSCAPE = -0.38; // the character turns a little toward the panel
const isMobileDevice = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

const TrousersIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3h10l1.2 18h-4.3L12 10.5 10.1 21H5.8L7 3Z" />
    <path d="M7.3 7h9.4" />
  </svg>
);

const CATEGORY_ICON: Record<WardrobeCategoryId, React.ReactNode> = {
  head: <Crown size={18} />,
  shirts: <Shirt size={18} />,
  trousers: <TrousersIcon />,
  accessories: <Watch size={18} />,
};

/**
 * Step 2 of the entry flow: the clothing showroom.
 * Full-screen 3D room behind (ShowroomScene), a glass selection panel on the left (a bottom sheet in portrait). Picking a card
 * equips it on the character at once. Categories without shipped models show blank placeholders, never invented clothes.
 */
export const Showroom: React.FC<ShowroomProps> = ({ account, initialOutfit, note, onStart, onSignOut }) => {
  const { effectiveIsPortrait: portrait } = useOrientation();
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<ShowroomScene | null>(null);

  const [category, setCategory] = useState<WardrobeCategoryId>('shirts');
  const [outfit, setOutfit] = useState<Outfit>(() => sanitizeOutfit(initialOutfit));
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [view, setView] = useState<ViewMode>('full');
  const [hintOn, setHintOn] = useState(true);
  const [rect, setRect] = useState<FocusRect | null>(null);
  const [starting, setStarting] = useState(false);
  const outfitRef = useRef(outfit);
  outfitRef.current = outfit;
  const updateFocusRef = useRef<() => void>(() => undefined);

  // ---- the 3D room: created once, disposed when the showroom closes (that hands the character back to the game)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let alive = true;
    let scene: ShowroomScene | null = null;
    try {
      scene = new ShowroomScene(stage, { isMobile: isMobileDevice(), onInteract: () => setHintOn(false) });
    } catch (e) {
      console.error('Showroom could not start', e);
      setStatus('failed');
      return;
    }
    sceneRef.current = scene;
    scene.setOutfit(outfitRef.current, false);
    updateFocusRef.current(); // the layout effect below ran before the scene existed
    void scene
      .prepare()
      .then((ok) => {
        if (!alive) return null;
        if (!ok) {
          setStatus('failed');
          return null;
        }
        return scene!.makeThumbnails(WARDROBE_ITEMS);
      })
      .then((t) => {
        if (!alive || !t) return;
        setThumbs(t);
        setStatus('ready');
      })
      .catch((e) => {
        console.error('Showroom preparation failed', e);
        if (alive) setStatus('failed');
      });
    return () => {
      alive = false;
      sceneRef.current = null;
      scene?.dispose();
    };
  }, []);

  // ---- tell the scene where the free area (next to the panel) is
  const updateFocus = useCallback(() => {
    const stage = stageRef.current;
    const panel = panelRef.current;
    const scene = sceneRef.current;
    if (!stage || !panel) return;
    const s = stage.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    let r: FocusRect;
    if (portrait) {
      const top = 56;
      r = { left: 0, top, width: s.width, height: Math.max(120, p.top - s.top - top - 6) };
    } else {
      const left = p.right - s.left + 8;
      r = { left, top: 52, width: Math.max(160, s.width - left), height: Math.max(160, s.height - 52 - 20) };
    }
    setRect(r);
    scene?.setFocus(r, portrait ? 0 : HOME_YAW_LANDSCAPE);
  }, [portrait]);

  updateFocusRef.current = updateFocus;
  useLayoutEffect(() => {
    updateFocus();
    const stage = stageRef.current;
    const panel = panelRef.current;
    const ro = new ResizeObserver(updateFocus);
    if (stage) ro.observe(stage);
    if (panel) ro.observe(panel);
    return () => ro.disconnect();
  }, [updateFocus]);

  const equip = (item: WardrobeItem): void => {
    const cat = WARDROBE_CATEGORIES.find((c) => c.id === item.category);
    const wearing = outfit[item.category] === item.id;
    if (wearing && cat?.required) return; // the shirt layer cannot be taken off
    const next: Outfit = { ...outfit, [item.category]: wearing ? null : item.id };
    setOutfit(next);
    sceneRef.current?.setOutfit(next);
  };

  const changeView = (v: ViewMode): void => {
    setView(v);
    sceneRef.current?.setView(v);
  };

  const start = (): void => {
    if (starting) return;
    setStarting(true);
    onStart(sanitizeOutfit(outfitRef.current));
  };

  const items = useMemo(() => itemsOf(category), [category]);
  const initials = (account.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2) || account.username[0] || '?').toUpperCase();
  const catLabel = WARDROBE_CATEGORIES.find((c) => c.id === category)?.label ?? '';

  const accountChip = (
    <div className="sr-account">
      <span className="sr-avatar" aria-hidden="true">{initials}</span>
      <span className="sr-account-text">
        <span className="sr-account-name">{account.name}</span>
        <span className="sr-account-user">@{account.username}</span>
      </span>
      <button type="button" className="sr-icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out" disabled={starting}>
        <LogOut size={17} />
      </button>
    </div>
  );

  return (
    <div className="ef-root sr-root" data-portrait={portrait ? '1' : '0'}>
      {/* full-screen 3D room */}
      <div ref={stageRef} className="sr-stage" />
      <div className="sr-vignette" aria-hidden="true" />

      {/* overlays on the free area */}
      {portrait && <div className="sr-top-left">{accountChip}</div>}
      <div className="sr-top-right">
        <div className="sr-seg" role="group" aria-label="Camera framing">
          <button type="button" data-on={view === 'full'} onClick={() => changeView('full')}>Full body</button>
          <button type="button" data-on={view === 'close'} onClick={() => changeView('close')}>Close-up</button>
        </div>
        <div className="sr-tools">
          <button type="button" className="sr-icon-btn" onClick={() => sceneRef.current?.zoomBy(0.85)} aria-label="Zoom in"><ZoomIn size={17} /></button>
          <button type="button" className="sr-icon-btn" onClick={() => sceneRef.current?.zoomBy(1.18)} aria-label="Zoom out"><ZoomOut size={17} /></button>
          <button type="button" className="sr-icon-btn" onClick={() => sceneRef.current?.resetView()} aria-label="Reset view"><RotateCw size={17} /></button>
        </div>
      </div>

      {rect && status === 'loading' && (
        <div className="sr-loading" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <Loader2 size={26} className="ef-spin" />
          <span>Preparing the showroom</span>
        </div>
      )}
      {rect && hintOn && status !== 'loading' && (
        <div className="sr-hint" style={{ left: rect.left, width: rect.width, top: rect.top + rect.height - 34 }}>
          <span>Drag to turn · Pinch or scroll to zoom</span>
        </div>
      )}

      {/* selection panel */}
      <aside ref={panelRef} className="sr-panel" aria-label="Wardrobe">
        {!portrait && (
          <header className="sr-panel-head">
            <div>
              <h1 className="sr-heading">Wardrobe</h1>
              <p className="sr-note">{note ?? 'Pick your look. It is worn when the game starts.'}</p>
            </div>
            {accountChip}
          </header>
        )}
        {portrait && note && <p className="sr-note sr-note-portrait">{note}</p>}

        <nav className="sr-tabs" role="tablist" aria-label="Clothing categories">
          {WARDROBE_CATEGORIES.map((c) => {
            const n = itemsOf(c.id).length;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={category === c.id}
                data-on={category === c.id}
                data-empty={n === 0}
                className="sr-tab"
                onClick={() => setCategory(c.id)}
              >
                {CATEGORY_ICON[c.id]}
                <span>{c.label}</span>
                <b className="sr-count">{n}</b>
              </button>
            );
          })}
        </nav>

        <div className="sr-scroll" role="tabpanel" aria-label={catLabel}>
          <div className="sr-grid-wrap">
            {items.length > 0 ? (
              <div className="sr-grid">
                {items.map((item) => {
                  const on = outfit[item.category] === item.id;
                  const src = thumbs[item.id];
                  return (
                    <button key={item.id} type="button" className="sr-card" data-on={on} aria-pressed={on} onClick={() => equip(item)}>
                      <span className="sr-art">
                        {src ? <img src={src} alt={item.name} draggable={false} /> : <span className="sr-shimmer" aria-hidden="true" />}
                        {on && (
                          <span className="sr-badge" aria-hidden="true"><Check size={14} strokeWidth={3} /> Worn</span>
                        )}
                      </span>
                      <span className="sr-card-name">{item.name}</span>
                      <span className="sr-card-tag">{item.tag}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="sr-grid" aria-hidden="true">
                  {Array.from({ length: SLOTS_PER_EMPTY_CATEGORY }, (_, i) => (
                    <div key={i} className="sr-slot" />
                  ))}
                </div>
                <p className="sr-empty">Nothing available in {catLabel} yet.</p>
              </>
            )}
          </div>
        </div>

        <footer className="sr-foot">
          <button type="button" className="sr-start" onClick={start} disabled={status === 'loading' || starting}>
            {starting || status === 'loading' ? <Loader2 size={20} className="ef-spin" /> : <Play size={20} fill="currentColor" />}
            {starting ? 'STARTING' : status === 'loading' ? 'PREPARING' : 'START GAME'}
          </button>
        </footer>
      </aside>
    </div>
  );
};
