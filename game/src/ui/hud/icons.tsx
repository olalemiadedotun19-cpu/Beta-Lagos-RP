import React from 'react';
import {
  AIM_ICON,
  BRAKE_PEDAL_ICON,
  CAR_AJAR_ICON,
  CAR_DOOR_ICON,
  GAS_PEDAL_ICON,
  HANDBRAKE_ICON,
  PUNCH_ICON,
  SPRINT_ICON,
  STEER_LEFT_ICON,
  STEER_RIGHT_ICON,
} from './hudImages';

/**
 * HUD icon set: one consistent 24x24 grid, 1.8 px stroke, mitred corners (a tactical, console-HUD look instead of the
 * soft rounded glyphs of a generic icon pack). Solid shapes are used only where a filled glyph reads better at 12-16 px
 * (wanted stars, stamina bolt, health cross). Everything inherits `currentColor` so the HUD CSS owns the palette.
 */
interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

const Svg: React.FC<IconProps & { children: React.ReactNode; fill?: boolean }> = ({ className, style, children, fill }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    style={style}
    aria-hidden
    focusable="false"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={1.8}
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    {children}
  </svg>
);

// ---- vitals ---------------------------------------------------------------------------------
export const IconHealth: React.FC<IconProps> = (p) => (
  <Svg {...p} fill><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></Svg>
);
export const IconStamina: React.FC<IconProps> = (p) => (
  <Svg {...p} fill><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" /></Svg>
);
export const IconHunger: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M7 3v6.5M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10" />
    <path d="M17.5 21V3c-2.2 1.2-3.5 4-3.5 7.5 0 1.6 1.2 2.5 3.5 2.5" />
  </Svg>
);
export const IconArmor: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M12 2.5 20 5.5v6c0 4.7-3.2 8.3-8 10-4.8-1.7-8-5.3-8-10v-6z" /></Svg>
);
export const IconFun: React.FC<IconProps> = (p) => (
  <Svg {...p} fill><path d="M12 2c.7 5.2 2.8 7.3 8 8-5.2.7-7.3 2.8-8 8-.7-5.2-2.8-7.3-8-8 5.2-.7 7.3-2.8 8-8z" /></Svg>
);
export const IconHygiene: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M12 3c3.6 4.4 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.4-6.6 6-11z" /></Svg>
);
export const IconMood: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M3.5 17a8.5 8.5 0 0 1 17 0" /><path d="m12 17 4.5-6" /><path d="M3.5 17h2.5M18 17h2.5" /></Svg>
);
export const IconCash: React.FC<IconProps> = (p) => (
  <Svg {...p}><rect x="2.5" y="6" width="19" height="12" /><circle cx="12" cy="12" r="2.8" /><path d="M5.5 9v.01M18.5 15v.01" strokeWidth={2.4} /></Svg>
);
export const IconStar: React.FC<IconProps> = (p) => (
  <Svg {...p} fill><path d="m12 2.5 2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7-4.9-4.6 6.6-.8z" /></Svg>
);

// ---- utility buttons ------------------------------------------------------------------------
export const IconBag: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9 7V4.5h6V7" />
    <rect x="3.5" y="7" width="17" height="13" />
    <path d="M3.5 12.5h17M10.5 12.5v2.5h3v-2.5" />
  </Svg>
);
export const IconPhone: React.FC<IconProps> = (p) => (
  <Svg {...p}><rect x="6.5" y="2.5" width="11" height="19" rx="1.5" /><path d="M10.5 18.5h3" /></Svg>
);
export const IconMenu: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>
);
export const IconOrientation: React.FC<IconProps & { portrait?: boolean }> = ({ portrait, ...p }) => (
  <Svg {...p}>
    {portrait ? <rect x="7" y="3" width="10" height="14" rx="1" /> : <rect x="3" y="7" width="14" height="10" rx="1" />}
    <path d="M14.5 20.5h6V17.5M20.5 20.5 17 17" />
  </Svg>
);
export const IconSun: React.FC<IconProps> = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></Svg>
);
export const IconMoon: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></Svg>
);
export const IconChevronDown: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="m6 9.5 6 6 6-6" /></Svg>
);
export const IconClose: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
);

// ---- actions --------------------------------------------------------------------------------
export const IconJump: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="m5.5 12.5 6.5-6.5 6.5 6.5M5.5 19l6.5-6.5L18.5 19" /></Svg>
);
/**
 * Picture icons (sprint / punch / aim): the supplied artwork used as a mask, so it takes `currentColor` like every other HUD icon
 * (white on the glass buttons, gold when toggled on, dark on the yellow primary button). The soft shadow sits on a wrapper because a
 * filter on the masked element itself would be cut away by the mask.
 */
const IconMask: React.FC<IconProps & { src: string }> = ({ src, className, style }) => {
  const url = `url("${src}")`;
  return (
    <span aria-hidden className={`inline-block ${className ?? ''}`} style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.6))', ...style }}>
      <span
        className="block w-full h-full"
        style={{
          backgroundColor: 'currentColor',
          WebkitMaskImage: url,
          maskImage: url,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    </span>
  );
};
export const IconSprint: React.FC<IconProps> = (p) => <IconMask {...p} src={SPRINT_ICON} />;
export const IconPunch: React.FC<IconProps> = (p) => <IconMask {...p} src={PUNCH_ICON} />;
export const IconAim: React.FC<IconProps> = (p) => <IconMask {...p} src={AIM_ICON} />;
/** car button: the car door (get in) and the open door seen from above (get out) */
export const IconCarDoor: React.FC<IconProps> = (p) => <IconMask {...p} src={CAR_DOOR_ICON} />;
export const IconCarAjar: React.FC<IconProps> = (p) => <IconMask {...p} src={CAR_AJAR_ICON} />;
export const IconEnter: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M14 4.5h5.5v15H14M3.5 12h11M10.5 8l4 4-4 4" /></Svg>
);
export const IconExit: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M10 4.5H4.5v15H10M9.5 12h11M16.5 8l4 4-4 4" /></Svg>
);
// driving controls (car): the supplied artwork. Gas / brake are the two halves of the pedals image; the right chevrons are the left ones mirrored.
export const IconSteerLeft: React.FC<IconProps> = (p) => <IconMask {...p} src={STEER_LEFT_ICON} />;
export const IconSteerRight: React.FC<IconProps> = (p) => <IconMask {...p} src={STEER_RIGHT_ICON} />;
export const IconGas: React.FC<IconProps> = (p) => <IconMask {...p} src={GAS_PEDAL_ICON} />;
export const IconBrake: React.FC<IconProps> = (p) => <IconMask {...p} src={BRAKE_PEDAL_ICON} />;
/** the handbrake lever: this is the drift button */
export const IconDrift: React.FC<IconProps> = (p) => <IconMask {...p} src={HANDBRAKE_ICON} />;
export const IconDoor: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M5.5 21V3.5h13V21M3.5 21h17" /><path d="M14.5 12v.01" strokeWidth={2.6} /></Svg>
);
export const IconWaypoint: React.FC<IconProps> = (p) => (
  <Svg {...p} fill><path d="M12 2.5 19 21l-7-4.2L5 21z" /></Svg>
);

// ---- notification types ---------------------------------------------------------------------
export const IconInfo: React.FC<IconProps> = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" strokeWidth={2.2} /></Svg>
);
export const IconWork: React.FC<IconProps> = (p) => (
  <Svg {...p}><rect x="3" y="7.5" width="18" height="12" /><path d="M9 7.5V5h6v2.5M3 13h18" /></Svg>
);
export const IconChat: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M4 4.5h16v12H10l-4.5 3.5v-3.5H4z" /></Svg>
);
export const IconBell: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 1.5h-15zM10 21h4" /></Svg>
);
