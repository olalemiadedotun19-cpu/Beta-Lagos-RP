import type { ReactNode } from 'react';

/** Which full-screen panel the HUD asks the app to open ('home' = none). */
export type NavTab = 'home' | 'map' | 'phone' | 'inventory' | 'character' | 'more';

/**
 * ---------------------------------------------------------------------------------------------
 * INTEGRATION POINTS for systems the game does not have yet.
 *
 * The HUD only ever renders a field below when it is PROVIDED. Nothing is faked: today App passes
 * no `extras`, so no armour bar, wanted stars, weapon card or combat buttons appear. When you add
 * the system, feed its real state through `extras` (see App.tsx -> <GameHUD extras={...} />).
 * ---------------------------------------------------------------------------------------------
 */
export interface HudWeaponState {
  name: string;
  /** rounds in the magazine */
  ammo: number;
  /** rounds left in reserve */
  reserve: number;
}

export interface HudExtraAction {
  id: string;
  label: string;
  icon: ReactNode;
  /** pointer went down (hold-style actions: aim, shoot, crouch) */
  onPress?: () => void;
  /** pointer released / cancelled */
  onRelease?: () => void;
  /** tap-style actions (reload, switch weapon) */
  onTap?: () => void;
  /** toggled-on look (aim, crouch) */
  active?: boolean;
  disabled?: boolean;
}

export interface HudExtras {
  /** 0-100. Needs an armour system. */
  armor?: number;
  /** 0-5 stars. Needs a law-enforcement system. */
  wantedLevel?: number;
  /** Current weapon + ammo. Needs a combat system. */
  weapon?: HudWeaponState | null;
  /** Extra round buttons (shoot, aim, melee, reload, crouch, switch weapon...) shown beside Sprint/Jump. */
  actions?: HudExtraAction[];
}
