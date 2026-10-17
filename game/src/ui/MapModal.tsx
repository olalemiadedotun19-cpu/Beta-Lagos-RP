import React, { useEffect, useMemo, useState } from 'react';
import { POILocation, WorldCoordinate } from '../types/game';
import { IKEJA_DISTRICT_DATA } from '../data/worldData';
import { getLocationDefinition } from '../data/locationCatalog';
import { MapCanvas } from './MapCanvas';
import { MapMarker, getMarkers } from '../navigation/drawMap';
import { NavSnapshot, Pt } from '../navigation/NavMap';
import { getWorldLayout } from '../world/WorldLayout';
import type { WaypointState } from '../core/GameEngine';
import { areaNameAt } from '../world/CityDistricts';
import { X, Navigation, House, Utensils, ShoppingBag, Briefcase, HeartPulse, Trees, Landmark, MapPin, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MapModalProps {
  playerPosition: WorldCoordinate;
  onClose: () => void;
  /** live player / waypoint / route state shared with the minimap */
  getNav: () => NavSnapshot | null;
  waypoint: WaypointState | null;
  onSetWaypoint: (x: number, z: number, name?: string) => void;
  onSetPoiWaypoint: (poi: POILocation) => void;
  onClearWaypoint: () => void;
}

/** one list section per kind of place: label, icon, colour (muted, so the list reads as a directory, not a toy) */
interface Category {
  id: string;
  label: string;
  singular: string;
  Icon: LucideIcon;
  color: string;
}
const CATEGORIES: Category[] = [
  { id: 'residential', label: 'Homes', singular: 'Home', Icon: House, color: '#7aa2f7' },
  { id: 'restaurant', label: 'Food & drink', singular: 'Restaurant', Icon: Utensils, color: '#f0a35e' },
  { id: 'shopping', label: 'Shopping', singular: 'Shopping', Icon: ShoppingBag, color: '#5fbf8f' },
  { id: 'office', label: 'Offices', singular: 'Office', Icon: Briefcase, color: '#6cb6e8' },
  { id: 'hospital', label: 'Health', singular: 'Health', Icon: HeartPulse, color: '#ef7a85' },
  { id: 'park', label: 'Parks', singular: 'Park', Icon: Trees, color: '#7cc576' },
  { id: 'landmark', label: 'Landmarks', singular: 'Landmark', Icon: Landmark, color: '#d6b25e' },
];
const OTHER: Category = { id: 'other', label: 'Other places', singular: 'Place', Icon: MapPin, color: '#9aa3af' };

const categoryOf = (m: MapMarker): Category => {
  const key = m.kind === 'landmark' ? 'landmark' : m.type === 'commercial' || m.type === 'market' ? 'shopping' : m.type;
  return CATEGORIES.find((c) => c.id === key) ?? OTHER;
};

const formatDistance = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

// one neutral, professional UI face for the whole screen (the HUD's condensed game face is not used here)
const UI_FONT = "Inter, 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, system-ui, sans-serif";

export const MapModal: React.FC<MapModalProps> = ({ playerPosition, onClose, getNav, waypoint, onSetWaypoint, onSetPoiWaypoint, onClearWaypoint }) => {
  const pois = IKEJA_DISTRICT_DATA.pois;
  const [selectedPoi, setSelectedPoi] = useState<POILocation | null>(null);
  const [selectedLandmark, setSelectedLandmark] = useState<MapMarker | null>(null);
  const [focus, setFocus] = useState<{ p: Pt | null; key: number }>({ p: null, key: 0 });
  /** the crosshair at the centre of the map: shown once a place has been centred, gone when the selection is dismissed */
  const [reticle, setReticle] = useState(0);

  // Gameplay input is paused while this map is open, so the player cannot move: one read is a stable origin.
  const here = useMemo<WorldCoordinate>(() => {
    const n = getNav();
    return n ? { x: n.x, y: 0, z: n.z } : playerPosition;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const districtName = useMemo(() => areaNameAt(getWorldLayout(), here.x, here.z), [here]);
  const directTo = (x: number, z: number) => Math.round(Math.hypot(x - here.x, z - here.z));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.code === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // every place on the map, grouped by kind, nearest first
  const groups = useMemo(() => {
    const all = getMarkers();
    const out: { cat: Category; items: { m: MapMarker; dist: number }[] }[] = [];
    for (const cat of [...CATEGORIES, OTHER]) {
      const items = all
        .filter((m) => categoryOf(m).id === cat.id)
        .map((m) => ({ m, dist: directTo(m.x, m.z) }))
        .sort((a, b) => a.dist - b.dist);
      if (items.length) out.push({ cat, items });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here]);

  const selectedId = selectedPoi?.id ?? selectedLandmark?.id ?? null;
  const selectedLocDef = selectedPoi ? getLocationDefinition(selectedPoi.id) : null;

  /** pick a place: select it, centre the map on it and put the crosshair on the centre */
  const choose = (m: MapMarker) => {
    if (m.kind === 'poi') {
      const poi = pois.find((p) => p.id === m.id);
      if (!poi) return;
      setSelectedPoi(poi);
      setSelectedLandmark(null);
    } else {
      setSelectedPoi(null);
      setSelectedLandmark(m);
    }
    setFocus((f) => ({ p: { x: m.x, z: m.z }, key: f.key + 1 }));
    setReticle((k) => k + 1);
  };
  const dismiss = () => {
    setSelectedPoi(null);
    setSelectedLandmark(null);
    setReticle(0);
  };
  const handleTapGround = (p: Pt) => {
    dismiss();
    onSetWaypoint(p.x, p.z, 'Waypoint');
  };

  const selectedMarker: MapMarker | null = selectedPoi
    ? getMarkers().find((m) => m.id === selectedPoi.id) ?? null
    : selectedLandmark;
  const selectedCat = selectedMarker ? categoryOf(selectedMarker) : null;

  const card =
    'absolute z-10 left-3 right-16 bottom-3 max-w-[380px] rounded-xl bg-[#14181d]/95 backdrop-blur border border-[#2a313a] shadow-xl p-3.5 text-[13px] text-[#c9d0d9]';
  const primary =
    'mt-3 w-full h-11 rounded-lg bg-[#3b82f6] hover:bg-[#2f74e0] active:bg-[#2a68cc] text-white text-[14px] font-medium cursor-pointer touch-manipulation';

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0e1115] flex flex-col select-none text-[#e6e9ee]"
      style={{ fontFamily: UI_FONT, letterSpacing: 'normal', paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <header
        className="h-12 shrink-0 px-4 flex items-center justify-between gap-3 bg-[#14181d] border-b border-[#252b33]"
        style={{ paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' }}
      >
        <div className="min-w-0 leading-tight">
          <h2 className="text-[15px] font-semibold text-white">Map</h2>
          <div className="text-[12px] text-[#8b95a3] truncate">Ikeja · {districtName}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {waypoint && (
            <button
              onClick={onClearWaypoint}
              data-testid="clear-waypoint"
              className="h-8 px-3 rounded-lg border border-[#323a45] text-[#c9d0d9] hover:bg-[#1c222a] text-[13px] flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear route
            </button>
          )}
          <button
            onClick={onClose}
            data-testid="close-map"
            aria-label="Close map"
            className="w-8 h-8 rounded-lg text-[#9aa3af] hover:text-white hover:bg-[#1c222a] flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Places: a plain directory down the left-hand side */}
        <nav
          aria-label="Places"
          data-testid="places-list"
          className="shrink-0 overflow-y-auto bg-[#12161b] border-r border-[#252b33]"
          style={{ width: 'clamp(168px, 36vw, 268px)', paddingLeft: 'env(safe-area-inset-left)', scrollbarWidth: 'thin' }}
        >
          {groups.map(({ cat, items }) => (
            <section key={cat.id} className="pb-1">
              <h3 className="sticky top-0 z-[1] px-3 pt-3 pb-1.5 bg-[#12161b] text-[11px] font-medium text-[#7d8795] flex items-center justify-between">
                <span>{cat.label}</span>
                <span className="text-[#5f6875]">{items.length}</span>
              </h3>
              {items.map(({ m, dist }) => {
                const active = selectedId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => choose(m)}
                    data-testid={`place-${m.id}`}
                    className={`w-full min-h-[48px] px-3 py-1.5 flex items-center gap-2.5 text-left cursor-pointer touch-manipulation border-l-2 ${
                      active ? 'bg-[#1b2431] border-[#3b82f6]' : 'border-transparent hover:bg-[#181d24] active:bg-[#1b2431]'
                    }`}
                  >
                    <span
                      className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
                    >
                      <cat.Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className={`block text-[13px] line-clamp-2 ${active ? 'text-white font-medium' : 'text-[#dde2e9]'}`}>{m.name}</span>
                      <span className="block text-[11.5px] text-[#7d8795]">{formatDistance(dist)}</span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </nav>

        {/* Map */}
        <div className="relative flex-1 min-w-0">
          <MapCanvas
            getNav={getNav}
            selectedId={selectedId}
            focus={focus.p}
            focusKey={focus.key}
            onTapMarker={choose}
            onTapGround={handleTapGround}
          />

          {/* Crosshair at the centre of the map: the centred place sits under it */}
          {reticle > 0 && selectedMarker && (
            <div key={reticle} className="map-reticle absolute left-1/2 top-1/2 pointer-events-none z-[5]" aria-hidden>
              <svg width="72" height="72" viewBox="-36 -36 72 72" fill="none" strokeLinecap="round">
                <g stroke="#000" strokeOpacity="0.45" strokeWidth="4.2">
                  <circle r="17" />
                  <path d="M0 -33V-10M0 10V33M-33 0H-10M10 0H33" />
                </g>
                <g stroke="#fff" strokeWidth="2">
                  <circle r="17" />
                  <path d="M0 -33V-10M0 10V33M-33 0H-10M10 0H33" />
                </g>
                <circle r="2.6" fill="#fff" stroke="#000" strokeOpacity="0.45" strokeWidth="1" />
              </svg>
            </div>
          )}

          {/* Selected place: details + waypoint (you walk there yourself) */}
          {selectedMarker && selectedCat && (
            <div className={card}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-[#8b95a3]">
                  <selectedCat.Icon className="w-3.5 h-3.5" style={{ color: selectedCat.color }} />
                  {selectedCat.singular}
                </span>
                <button onClick={dismiss} aria-label="Dismiss" className="text-[#7d8795] hover:text-white cursor-pointer -mr-1 p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <h3 className="text-[16px] font-semibold text-white mt-1 leading-snug">{selectedMarker.name}</h3>
              {selectedPoi && <p className="text-[12.5px] text-[#9aa3af] mt-1 line-clamp-2">{selectedPoi.description}</p>}
              {selectedLocDef && selectedLocDef.activities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedLocDef.activities.slice(0, 4).map((act: string, i: number) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-[#1c222a] text-[#aab3bf]">
                      {act}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2.5 text-[12.5px] text-[#9aa3af]">
                {selectedPoi && waypoint?.poiId === selectedPoi.id
                  ? `${waypoint.distanceMeters} m by road${waypoint.viaRoad ? ` · via ${waypoint.viaRoad}` : ''}`
                  : `${formatDistance(directTo(selectedMarker.x, selectedMarker.z))} from you (straight line)`}
              </div>
              {selectedPoi ? (
                <button onClick={() => onSetPoiWaypoint(selectedPoi)} data-testid="set-poi-waypoint" className={primary}>
                  Set waypoint
                </button>
              ) : (
                <button
                  onClick={() => onSetWaypoint(selectedMarker.entrance.x, selectedMarker.entrance.z, selectedMarker.name)}
                  data-testid="set-landmark-waypoint"
                  className={primary}
                >
                  Set waypoint
                </button>
              )}
            </div>
          )}

          {/* Active route summary / hint */}
          {!selectedMarker && (
            <div className={`${card} flex items-center gap-3 !p-3`}>
              {waypoint ? (
                <>
                  <span className="w-8 h-8 rounded-lg bg-[#3b82f6]/15 text-[#6aa3f8] flex items-center justify-center shrink-0">
                    <Navigation className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 leading-snug" data-testid="waypoint-summary">
                    <div className="text-[14px] font-medium text-white truncate">{waypoint.name}</div>
                    <div className="text-[12.5px] text-[#9aa3af]">
                      {waypoint.distanceMeters} m {waypoint.viaRoad ? `by road · via ${waypoint.viaRoad}` : 'on foot'}
                    </div>
                    <div className="text-[11.5px] text-[#6f7987]">{waypoint.directMeters} m in a straight line</div>
                  </div>
                </>
              ) : (
                <>
                  <Navigation className="w-5 h-5 text-[#6f7987] shrink-0" />
                  <p className="text-[12.5px] text-[#9aa3af]">Choose a place from the list, or tap the map to drop a waypoint. Drag to pan, pinch or use + / − to zoom.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
