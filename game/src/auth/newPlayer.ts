import type { CharacterAppearance, GameDate, PlayerData } from '../types/game';
import { BARRACKS_SPAWN } from '../world/barracks/BarracksLayout';
import { DEFAULT_OUTFIT, type Outfit } from '../wardrobe/Wardrobe';
import type { Account } from './AccountStore';

/**
 * A brand-new citizen for a freshly created account. The sign-in form only asks for name / username / password, so everything
 * else a citizen needs starts from the same defaults the old creation screen used. The figure ignores `appearance` (it is kept
 * so the PlayerData shape does not change); the clothes live in `outfit`.
 */
const DEFAULT_APPEARANCE: CharacterAppearance = {
  gender: 'male',
  skinTone: '#5c3826',
  hairStyle: 'fade',
  hairColor: '#111111',
  facialHair: 'none',
  facialHairColor: '#111111',
  glasses: 'none',
  shirtColor: '#059669',
  pantsColor: '#1e293b',
  shoesColor: '#f9fafb',
  heightScale: 1.0,
  bodyBuild: 'average',
};

const BIRTH_YEAR = 2003;
const BIRTH_MONTH = 5;
const BIRTH_DAY = 14;

export function createNewPlayer(account: Account, outfit: Outfit = DEFAULT_OUTFIT): PlayerData {
  const parts = account.name.trim().split(/\s+/);
  const firstName = parts[0] ?? account.username;
  const lastName = parts.slice(1).join(' ');
  const dateOfBirth: GameDate = { year: BIRTH_YEAR, month: BIRTH_MONTH, day: BIRTH_DAY, hour: 8, minute: 0 };
  const now = Date.now();
  return {
    identity: {
      id: `citizen_${now}_${Math.random().toString(36).substring(2, 7)}`,
      firstName,
      lastName,
      username: account.username,
      dateOfBirth,
      sex: 'male',
      nationality: 'Nigerian',
    },
    appearance: { ...DEFAULT_APPEARANCE },
    outfit: { ...outfit },
    stats: { health: 95, energy: 90, hunger: 85, happiness: 85, hygiene: 90, stress: 15 },
    finances: { cash: 35000, bankBalance: 120000, currencyCode: 'NGN', currencySymbol: '₦' },
    career: {
      jobTitle: 'Junior Software Engineer',
      employer: 'Silicon Ikeja Labs',
      hourlyWage: 5000,
      experienceYears: 1,
      isEmployed: true,
    },
    education: { level: 'Undergraduate', schoolName: 'University of Lagos', fieldOfStudy: 'Computer Science' },
    location: {
      continentId: 'continent_africa',
      countryId: 'country_nigeria',
      stateId: 'state_lagos',
      cityId: 'city_lagos',
      districtId: 'district_ikeja',
      position: { ...BARRACKS_SPAWN },
      rotationY: 0,
    },
    inventory: [
      {
        id: 'bottled_water',
        name: 'Bottled Spring Water',
        description: 'Cold pure water for hydration in Ikeja.',
        category: 'beverage',
        quantity: 2,
        effects: { hunger: 5, energy: 10, health: 5 },
      },
    ],
    createdAt: now,
    lastSavedAt: now,
  };
}
