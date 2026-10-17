import React, { memo, useEffect, useRef } from 'react';
import { driveTelemetry, type Gear } from '../../vehicles/DriveTelemetry';

/**
 * Driving gauge, drawn to the reference: a round 0-200 km/h dial with a red needle and a glowing red zone (160-200), the speed in big
 * digits in the middle, a P R N D strip under it (the current gear in a blue box), a fuel gauge peeking out from behind on the left,
 * a speed chip at the top right and a trip chip at the bottom left.
 *
 * Everything is read from `driveTelemetry` in its own animation frame and written straight to the SVG / text nodes, so React never
 * re-renders while the car moves. Mounted only while sitting in the car (or while rearranging the HUD).
 */

const CX = 120;
const CY = 120;
const MAX_KMH = 200;
const SWEEP_FROM = -135; // degrees clockwise from 12 o'clock at 0 km/h
const SWEEP = 270;
const RED_FROM = 160;
const GEARS: Gear[] = ['P', 'R', 'N', 'D'];
const FUEL_TICKS = 11;

const angleOf = (kmh: number): number => SWEEP_FROM + (Math.min(Math.max(kmh, 0), MAX_KMH) / MAX_KMH) * SWEEP;
const at = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
};
const f = (n: number): string => n.toFixed(2);
const arc = (from: number, to: number, r: number): string => {
  const [x0, y0] = at(angleOf(from), r);
  const [x1, y1] = at(angleOf(to), r);
  const large = angleOf(to) - angleOf(from) > 180 ? 1 : 0;
  return `M${f(x0)} ${f(y0)}A${r} ${r} 0 ${large} 1 ${f(x1)} ${f(y1)}`;
};

// ---- static dial parts (built once)
const TICKS: { x0: number; y0: number; x1: number; y1: number; major: boolean; red: boolean }[] = [];
const LABELS: { x: number; y: number; text: string; red: boolean }[] = [];
for (let v = 0; v <= MAX_KMH; v += 10) {
  const major = v % 20 === 0;
  const deg = angleOf(v);
  const [x0, y0] = at(deg, 97);
  const [x1, y1] = at(deg, major ? 87 : 91);
  TICKS.push({ x0, y0, x1, y1, major, red: v >= RED_FROM });
  if (major) {
    const [x, y] = at(deg, 72);
    LABELS.push({ x, y, text: String(v), red: false });
  }
}
const GEAR_X = [86, 107, 128, 150];

/** fuel gauge: ticks down the left side of a small dial, F at the top, E at the bottom (angles are degrees clockwise from the top) */
const FUEL_TICK_GEOM = Array.from({ length: FUEL_TICKS }, (_, i) => {
  const deg = 360 - 25 - (i / (FUEL_TICKS - 1)) * 130; // from 335 (top) to 205 (bottom) going anticlockwise down the left side
  const a = (deg * Math.PI) / 180;
  const c = 60;
  return { x0: c + 50 * Math.sin(a), y0: c - 50 * Math.cos(a), x1: c + 41 * Math.sin(a), y1: c - 41 * Math.cos(a) };
});

const IconGauge = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4.5 18a9 9 0 1 1 15 0" />
    <path d="M12 14l4-5" />
  </svg>
);
const IconRoute = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M10.5 3h3l5 17h-3.2l-1-3.6h-4.6l-1 3.6H5.5l5-17zm.6 10.4h1.8L12 9.9l-.9 3.5z" />
  </svg>
);
const IconPump = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M5 10h10M15 8l3 2v7a1.5 1.5 0 0 0 3 0V9l-3-3" />
  </svg>
);

/** dial width (a CSS length): small enough that the car stays visible behind it */
export const speedoSize = (isPortrait: boolean): string => (isPortrait ? 'min(46vw, 190px)' : 'clamp(104px, 31vh, 180px)');

export const Speedometer = memo(({ isPortrait }: { isPortrait: boolean }) => {
  const needle = useRef<SVGGElement>(null);
  const digits = useRef<SVGTextElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const trip = useRef<HTMLSpanElement>(null);
  const gearBoxes = useRef<(SVGGElement | null)[]>([]);
  const fuelTicks = useRef<(SVGLineElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    let lastDigits = -1;
    let lastGear: Gear | '' = '';
    let lastTrip = '';
    let lastFuelOn = -1;
    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const t = driveTelemetry;
      shown += (t.speedKmh - shown) * Math.min(1, dt * 9); // the needle glides a little behind the real speed
      needle.current?.setAttribute('transform', `rotate(${f(angleOf(shown))} ${CX} ${CY})`);

      const kmh = Math.round(t.speedKmh);
      if (kmh !== lastDigits) {
        lastDigits = kmh;
        if (digits.current) digits.current.textContent = String(kmh);
        if (chip.current) chip.current.textContent = String(kmh);
      }
      if (t.gear !== lastGear) {
        lastGear = t.gear;
        GEARS.forEach((g, i) => gearBoxes.current[i]?.setAttribute('opacity', g === t.gear ? '1' : '0'));
      }
      const tripText = t.tripKm.toFixed(1);
      if (tripText !== lastTrip) {
        lastTrip = tripText;
        if (trip.current) trip.current.textContent = tripText;
      }
      const on = Math.round(t.fuel * FUEL_TICKS);
      if (on !== lastFuelOn) {
        lastFuelOn = on;
        fuelTicks.current.forEach((el, i) => {
          if (!el) return;
          const lit = i >= FUEL_TICKS - on; // i = 0 is F (top), so the lit ticks are the top ones
          const low = i >= FUEL_TICKS - 2;
          el.setAttribute('stroke', low ? '#ff3b30' : '#f4f6fa');
          el.setAttribute('opacity', lit ? '1' : '0.28');
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const size = speedoSize(isPortrait);

  return (
    <div className="relative pointer-events-none select-none" style={{ width: size, aspectRatio: '1 / 1' }} aria-label="Speedometer">
      {/* fuel gauge, half hidden behind the dial */}
      <svg viewBox="0 0 120 120" className="absolute" style={{ left: '-27%', top: '22%', width: '56%', height: '56%' }}>
        <defs>
          <radialGradient id="spd-fuel-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#14171c" />
            <stop offset="100%" stopColor="#07090c" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="59" fill="url(#spd-fuel-bg)" stroke="#2b3038" strokeWidth="2" />
        <circle cx="60" cy="60" r="55" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1" />
        {FUEL_TICK_GEOM.map((g, i) => (
          <line
            key={i}
            ref={(el) => {
              fuelTicks.current[i] = el;
            }}
            x1={g.x0}
            y1={g.y0}
            x2={g.x1}
            y2={g.y1}
            stroke="#f4f6fa"
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}
        <text x="22" y="27" fill="#f4f6fa" fontSize="13" fontWeight="700" textAnchor="middle">F</text>
        <text x="22" y="101" fill="#f4f6fa" fontSize="13" fontWeight="700" textAnchor="middle">E</text>
        <foreignObject x="22" y="46" width="24" height="26">
          <div style={{ width: '100%', height: '100%', color: '#f4f6fa' }}>
            <IconPump />
          </div>
        </foreignObject>
      </svg>

      {/* main dial */}
      <svg viewBox="0 0 240 240" className="absolute inset-0 w-full h-full" style={{ filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.55))' }}>
        <defs>
          <linearGradient id="spd-bezel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4a5058" />
            <stop offset="45%" stopColor="#15181d" />
            <stop offset="100%" stopColor="#2f343b" />
          </linearGradient>
          <radialGradient id="spd-face" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#1b1e24" />
            <stop offset="100%" stopColor="#050608" />
          </radialGradient>
          <pattern id="spd-carbon" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#0c0e11" />
            <rect width="3" height="3" fill="#171a1f" />
            <rect x="3" y="3" width="3" height="3" fill="#171a1f" />
          </pattern>
          <filter id="spd-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={CX} cy={CY} r="118" fill="url(#spd-bezel)" />
        <circle cx={CX} cy={CY} r="112" fill="#050608" />
        <circle cx={CX} cy={CY} r="107" fill="url(#spd-face)" />
        <circle cx={CX} cy={CY} r="107" fill="url(#spd-carbon)" opacity="0.55" />
        <circle cx={CX} cy={CY} r="118" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="1" />

        {/* scale ring: white up to the red zone, red (glowing) from there to the end */}
        <path d={arc(0, RED_FROM, 100)} fill="none" stroke="#f4f6fa" strokeWidth="2.2" strokeLinecap="round" />
        <path d={arc(RED_FROM, MAX_KMH, 100)} fill="none" stroke="#ff2a1f" strokeWidth="5" strokeLinecap="round" filter="url(#spd-glow)" />
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.x0}
            y1={t.y0}
            x2={t.x1}
            y2={t.y1}
            stroke={t.red ? '#ff3b30' : '#f4f6fa'}
            strokeOpacity={t.major ? 1 : 0.55}
            strokeWidth={t.major ? 2 : 1.2}
          />
        ))}
        {LABELS.map((l) => (
          <text key={l.text} x={l.x} y={l.y} fill="#f4f6fa" fontSize="12.5" fontWeight="600" textAnchor="middle" dominantBaseline="central">
            {l.text}
          </text>
        ))}

        {/* centre readout */}
        <circle cx={CX} cy={CY} r="46" fill="#0a0c0f" opacity="0.88" />
        <text ref={digits} x={CX} y="158" fill="#fff" fontSize="40" fontWeight="800" fontStyle="italic" textAnchor="middle">
          0
        </text>
        <text x={CX} y="176" fill="#cfd6e0" fontSize="10.5" fontWeight="600" textAnchor="middle" letterSpacing="0.5">
          KM/H
        </text>

        {/* needle */}
        <g ref={needle} transform={`rotate(${SWEEP_FROM} ${CX} ${CY})`} filter="url(#spd-glow)">
          <polygon points={`${CX - 3.2},${CY + 14} ${CX + 3.2},${CY + 14} ${CX + 1.1},${CY - 88} ${CX - 1.1},${CY - 88}`} fill="#ff2a1f" />
        </g>
        <circle cx={CX} cy={CY} r="7.5" fill="#101215" stroke="#ff2a1f" strokeWidth="2" />

        {/* gear strip */}
        <rect x="68" y="200" width="104" height="26" rx="13" fill="#0b0d10" stroke="#fff" strokeOpacity="0.14" />
        {GEARS.map((g, i) => (
          <g key={g}>
            <g
              ref={(el) => {
                gearBoxes.current[i] = el;
              }}
              opacity={g === 'P' ? 1 : 0}
            >
              <rect x={GEAR_X[i] - 11} y="203" width="22" height="20" rx="4" fill="#1f63e0" stroke="#fff" strokeWidth="1.6" />
            </g>
            <text x={GEAR_X[i]} y="213.5" fill="#fff" fontSize="13" fontWeight="700" textAnchor="middle" dominantBaseline="central" opacity={0.92}>
              {g}
            </text>
          </g>
        ))}
      </svg>

      {/* speed chip, top right */}
      <div
        className="hud-glass absolute flex items-center gap-1.5 px-2.5 h-7 text-[13px] font-bold text-white whitespace-nowrap"
        style={{ right: '-30%', top: '-4%' }}
      >
        <span className="text-[15px] opacity-90 flex">
          <IconGauge />
        </span>
        <span ref={chip}>0</span>
        <span className="text-[10px] font-semibold text-slate-300 tracking-wide">KM/H</span>
      </div>

      {/* trip chip, bottom left */}
      <div
        className="hud-glass absolute flex items-center gap-1.5 px-2.5 h-7 text-[13px] font-bold text-white whitespace-nowrap"
        style={{ left: '-30%', bottom: '2%' }}
      >
        <span className="text-[15px] opacity-90 flex">
          <IconRoute />
        </span>
        <span>
          <span ref={trip}>0.0</span> <span className="text-[10px] font-semibold text-slate-300">km</span>
        </span>
        <span className="text-[13px]">↑</span>
      </div>
    </div>
  );
});
Speedometer.displayName = 'Speedometer';
