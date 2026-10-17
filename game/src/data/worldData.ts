import { ContinentData, DistrictData } from '../types/game';
import { getWorldLayout } from '../world/WorldLayout';
import { SEA_HALF } from '../world/CurvedRoads';
import { BARRACKS_MAX_Z, BARRACKS_SPAWN } from '../world/barracks/BarracksLayout';

export const IKEJA_DISTRICT_DATA: DistrictData = {
  id: 'district_ikeja',
  name: 'Ikeja',
  description: 'The vibrant capital district of Lagos State, famous for bustling commerce, tech markets, and residential neighborhoods.',
  countryId: 'country_nigeria',
  cityId: 'city_lagos',
  currencyCode: 'NGN',
  currencySymbol: '₦',
  // The map is now 1.8 km x 1.8 km: the hand-built core stays at the centre, the rest is streamed (see src/world).
  worldBounds: {
    // the walkable area now reaches out over the sea around the 1.8 km island (invisible wall at SEA_HALF)
    minX: -SEA_HALF,
    maxX: SEA_HALF,
    minZ: -SEA_HALF,
    maxZ: BARRACKS_MAX_Z, // the south wall now stands beyond the barracks island
  },
  spawnPoint: { ...BARRACKS_SPAWN }, // inside the barracks gate (see BarracksLayout.ts)
  roads: getWorldLayout().roads,
  buildings: [
    // North-West Block: Residential Haven
    {
      id: 'bldg_residence_apartments',
      name: 'Ikeja Residential Duplex',
      category: 'residential',
      position: { x: -24, z: -25 },
      size: { width: 18, height: 11, depth: 16 },
      colorScheme: {
        wall: '#e6ded3', // warm stucco
        roof: '#7d3c26', // terracotta tile
        trim: '#3d4451',
      },
      stories: 2,
      poiId: 'poi_player_home',
      signText: 'Home Residence',
    },
    {
      id: 'bldg_townhouse_cluster',
      name: 'GRA Green Villas',
      category: 'residential',
      position: { x: -24, z: -68 },
      size: { width: 22, height: 12, depth: 15 },
      colorScheme: {
        wall: '#ded5c5',
        roof: '#2d3748',
        trim: '#4a5568',
      },
      stories: 2,
      signText: 'GRA Villas',
    },

    // North-East Block: Commercial & Tech
    {
      id: 'bldg_ikeja_mall',
      name: 'Ikeja City Mall',
      category: 'commercial',
      position: { x: 26, z: -26 },
      size: { width: 26, height: 14, depth: 22 },
      colorScheme: {
        wall: '#f7fafc',
        roof: '#2b6cb0',
        trim: '#1a365d',
      },
      stories: 3,
      poiId: 'poi_city_mall',
      signText: 'Ikeja City Mall',
    },
    {
      id: 'bldg_tech_hub',
      name: 'Silicon Ikeja Tech Hub',
      category: 'office',
      position: { x: 26, z: -68 },
      size: { width: 20, height: 18, depth: 16 },
      colorScheme: {
        wall: '#2d3748',
        roof: '#1a202c',
        trim: '#3182ce',
      },
      stories: 4,
      poiId: 'poi_tech_hub',
      signText: 'Tech Ventures Hub',
    },

    // South-West Block: Dining & Markets
    {
      id: 'bldg_buka_restaurant',
      name: "Mama Put's Buka & Grill",
      category: 'restaurant',
      position: { x: -25, z: 26 },
      size: { width: 16, height: 9, depth: 15 },
      colorScheme: {
        wall: '#fbd38d', // warm yellow
        roof: '#9c4221', // deep amber roof
        trim: '#744210',
      },
      stories: 2,
      poiId: 'poi_buka',
      signText: 'Mama Put Buka',
    },
    {
      id: 'bldg_supermarket_corner',
      name: 'Alade Corner Supermarket',
      category: 'commercial',
      position: { x: -25, z: 68 },
      size: { width: 18, height: 10, depth: 14 },
      colorScheme: {
        wall: '#edf2f7',
        roof: '#2c5282',
        trim: '#319795',
      },
      stories: 2,
      signText: 'Supermarket',
    },

    // South-East Block: Healthcare & Administration
    {
      id: 'bldg_ikeja_hospital',
      name: 'Ikeja General Health Center',
      category: 'hospital',
      position: { x: 26, z: 26 },
      size: { width: 22, height: 13, depth: 18 },
      colorScheme: {
        wall: '#ffffff',
        roof: '#e53e3e', // red cross accent
        trim: '#cbd5e0',
      },
      stories: 3,
      poiId: 'poi_hospital',
      signText: 'Health Center',
    },
    {
      id: 'bldg_civic_offices',
      name: 'Lagos State Service Center',
      category: 'civic',
      position: { x: 26, z: 68 },
      size: { width: 22, height: 15, depth: 16 },
      colorScheme: {
        wall: '#e2e8f0',
        roof: '#285e61',
        trim: '#1d4044',
      },
      stories: 3,
      signText: 'Service Center',
    },
  ],
  pois: [
    {
      id: 'poi_player_home',
      name: 'Residential Apartment',
      type: 'residential',
      description: 'Your tranquil private home in Ikeja. A safe place to rest, recharge, sleep, and freshen up.',
      position: { x: -14, y: 0, z: -25 },
      bounds: { width: 18, depth: 16, height: 10 },
      interactionRadius: 6.5,
      actions: [
        {
          id: 'action_sleep_night',
          label: 'Sleep for the Night (8 Hours)',
          description: 'Rest deeply through the night to restore maximum energy and vitality.',
          durationMinutes: 480,
          effects: {
            energy: 90,
            health: 20,
            hunger: -30,
            stress: -40,
            hygiene: -10,
          },
        },
        {
          id: 'action_power_nap',
          label: 'Take a Power Nap (1 Hour)',
          description: 'A quick nap on the couch to recharge your batteries during the afternoon.',
          durationMinutes: 60,
          effects: {
            energy: 25,
            stress: -15,
            hunger: -5,
          },
        },
        {
          id: 'action_shower',
          label: 'Take a Refreshing Shower',
          description: 'Freshen up with cold running water and scented soap. Wash away sweat and fatigue.',
          durationMinutes: 20,
          effects: {
            hygiene: 60,
            energy: 10,
            stress: -10,
          },
        },
        {
          id: 'action_relax_balcony',
          label: 'Relax on the Balcony',
          description: 'Sip a drink and listen to the gentle rustling of Ikeja palm trees.',
          durationMinutes: 45,
          effects: {
            happiness: 15,
            stress: -25,
            energy: 5,
          },
        },
      ],
    },
    {
      id: 'poi_buka',
      name: "Mama Put's Buka & Kitchen",
      type: 'restaurant',
      description: 'Authentic local eatery serving steaming jollof rice, plantain, spicy peppered goat meat, and fresh cold drinks.',
      position: { x: -16, y: 0, z: 26 },
      bounds: { width: 16, depth: 15, height: 8 },
      interactionRadius: 6.0,
      actions: [
        {
          id: 'action_eat_jollof',
          label: 'Party Jollof Rice & Beef (₦2,500)',
          description: 'Rich firewood jollof with spiced stewed beef and sweet fried plantain.',
          durationMinutes: 30,
          cost: 2500,
          requirements: { minCash: 2500 },
          effects: {
            hunger: 55,
            energy: 20,
            happiness: 25,
            cash: -2500,
          },
          rewardItem: {
            id: 'jollof_rice',
            name: 'Takeaway Jollof Box',
            description: 'Packed hot jollof for later.',
            category: 'food',
            quantity: 1,
            effects: { hunger: 40, energy: 15 },
          },
        },
        {
          id: 'action_eat_suya',
          label: 'Fire-Grilled Suya Skewers (₦1,800)',
          description: 'Spiced beef suya with raw sliced red onions, tomatoes, and dry yaji pepper.',
          durationMinutes: 20,
          cost: 1800,
          requirements: { minCash: 1800 },
          effects: {
            hunger: 35,
            energy: 15,
            happiness: 20,
            cash: -1800,
          },
        },
        {
          id: 'action_drink_malt',
          label: 'Chilled Malt Drink & Water (₦1,000)',
          description: 'A cold revitalizing beverage to quench your thirst.',
          durationMinutes: 10,
          cost: 1000,
          requirements: { minCash: 1000 },
          effects: {
            hunger: 10,
            energy: 25,
            health: 5,
            happiness: 10,
            cash: -1000,
          },
        },
      ],
    },
    {
      id: 'poi_city_mall',
      name: 'Ikeja City Mall',
      type: 'commercial',
      description: 'A premier shopping center with supermarkets, boutiques, tech shops, and coffee bistros.',
      position: { x: 14, y: 0, z: -26 },
      bounds: { width: 26, depth: 22, height: 12 },
      interactionRadius: 7.0,
      actions: [
        {
          id: 'action_buy_groceries',
          label: 'Stock Up on Groceries (₦8,000)',
          description: 'Buy assorted bread, milk, fruit, and snacks for your home pantry.',
          durationMinutes: 45,
          cost: 8000,
          requirements: { minCash: 8000 },
          effects: {
            hunger: 30,
            happiness: 15,
            cash: -8000,
          },
          rewardItem: {
            id: 'energy_snack',
            name: 'Pantry Snack Pack',
            description: 'Packaged chips and groundnuts.',
            category: 'food',
            quantity: 2,
            effects: { hunger: 20, energy: 15 },
          },
        },
        {
          id: 'action_buy_paracetamol',
          label: 'Buy First Aid & Vitamins (₦3,500)',
          description: 'Purchase health supplements and pain relief medication from the pharmacy.',
          durationMinutes: 20,
          cost: 3500,
          requirements: { minCash: 3500 },
          effects: {
            health: 20,
            cash: -3500,
          },
          rewardItem: {
            id: 'paracetamol',
            name: 'Pain Relief Tablets',
            description: 'Over-the-counter pain relief.',
            category: 'medicine',
            quantity: 1,
            effects: { health: 25, stress: -20 },
          },
        },
        {
          id: 'action_window_shop',
          label: 'Stroll Through the Arcade (Free)',
          description: 'Walk through air-conditioned corridors, admire window displays, and enjoy music.',
          durationMinutes: 40,
          effects: {
            happiness: 20,
            stress: -15,
            energy: -10,
            hunger: -10,
          },
        },
      ],
    },
    {
      id: 'poi_tech_hub',
      name: 'Silicon Ikeja Tech Hub',
      type: 'office',
      description: 'A bustling technology incubator and freelance workspace. Work on digital tasks to earn money.',
      position: { x: 15, y: 0, z: -68 },
      bounds: { width: 20, depth: 16, height: 15 },
      interactionRadius: 6.5,
      actions: [
        {
          id: 'action_work_gig',
          label: 'Work a Coding / Tech Gig (4 Hours, Earn ₦25,000)',
          description: 'Complete freelance software tasks or technical assignments for local businesses.',
          durationMinutes: 240,
          earnings: 25000,
          requirements: { minEnergy: 30 },
          effects: {
            energy: -40,
            hunger: -30,
            stress: 20,
            cash: 25000,
            happiness: 5,
          },
        },
        {
          id: 'action_quick_task',
          label: 'Quick Design Task (1 Hour, Earn ₦6,500)',
          description: 'Create social media posters or graphics for a nearby retailer.',
          durationMinutes: 60,
          earnings: 6500,
          requirements: { minEnergy: 15 },
          effects: {
            energy: -15,
            hunger: -10,
            stress: 8,
            cash: 6500,
          },
        },
        {
          id: 'action_tech_networking',
          label: 'Attend Tech Networking Mixer (1.5 Hours)',
          description: 'Meet other professionals, exchange contacts, and learn new skills.',
          durationMinutes: 90,
          effects: {
            happiness: 25,
            stress: -10,
            energy: -15,
          },
        },
      ],
    },
    {
      id: 'poi_hospital',
      name: 'Ikeja General Health Center',
      type: 'hospital',
      description: 'Qualified medical staff providing consultations, treatments, and general health checkups.',
      position: { x: 15, y: 0, z: 26 },
      bounds: { width: 22, depth: 18, height: 12 },
      interactionRadius: 6.5,
      actions: [
        {
          id: 'action_doctor_checkup',
          label: 'Full Medical Checkup & Care (₦15,000)',
          description: 'Doctor examination, diagnostic check, and prescription treatment to restore full health.',
          durationMinutes: 60,
          cost: 15000,
          requirements: { minCash: 15000 },
          effects: {
            health: 50,
            stress: -30,
            energy: 10,
            cash: -15000,
          },
        },
        {
          id: 'action_wellness_consult',
          label: 'Wellness Counseling & Rest (₦4,000)',
          description: 'Mental health guidance, stress reduction session, and peaceful rest.',
          durationMinutes: 45,
          cost: 4000,
          requirements: { minCash: 4000 },
          effects: {
            stress: -50,
            happiness: 20,
            health: 15,
            cash: -4000,
          },
        },
      ],
    },
    {
      id: 'poi_botanical_park',
      name: 'Ikeja Green Recreation Park',
      type: 'park',
      description: 'Lush tropical trees, walking pathways, and fresh air right in the heart of the district.',
      position: { x: -68, y: 0, z: -25 },
      bounds: { width: 26, depth: 26, height: 4 },
      interactionRadius: 8.0,
      actions: [
        {
          id: 'action_park_jog',
          label: 'Jog Along the Tree-Lined Path (30 Mins)',
          description: 'Cardio exercise among royal palms. Improves stamina and burns off anxiety.',
          durationMinutes: 30,
          requirements: { minEnergy: 20 },
          effects: {
            health: 15,
            stress: -30,
            energy: -20,
            hunger: -15,
            hygiene: -20,
            happiness: 20,
          },
        },
        {
          id: 'action_park_meditate',
          label: 'Sit by the Shaded Bench & Meditate (40 Mins)',
          description: 'Deep breathing under the shade of neem trees. Calm your mind.',
          durationMinutes: 40,
          effects: {
            stress: -40,
            energy: 10,
            happiness: 25,
          },
        },
      ],
    },
  ],
  props: [
    // Streetlights along Awolowo Way (East-West)
    { id: 'light_awolowo_1', type: 'streetlight', position: { x: -65, z: -8 }, rotationY: 0 },
    { id: 'light_awolowo_2', type: 'streetlight', position: { x: -30, z: -8 }, rotationY: 0 },
    { id: 'light_awolowo_3', type: 'streetlight', position: { x: 30, z: -8 }, rotationY: 0 },
    { id: 'light_awolowo_4', type: 'streetlight', position: { x: 65, z: -8 }, rotationY: 0 },
    { id: 'light_awolowo_5', type: 'streetlight', position: { x: -65, z: 8 }, rotationY: Math.PI },
    { id: 'light_awolowo_6', type: 'streetlight', position: { x: -30, z: 8 }, rotationY: Math.PI },
    { id: 'light_awolowo_7', type: 'streetlight', position: { x: 30, z: 8 }, rotationY: Math.PI },
    { id: 'light_awolowo_8', type: 'streetlight', position: { x: 65, z: 8 }, rotationY: Math.PI },

    // Streetlights along Allen Avenue (North-South)
    { id: 'light_allen_1', type: 'streetlight', position: { x: -8, z: -65 }, rotationY: Math.PI / 2 },
    { id: 'light_allen_2', type: 'streetlight', position: { x: -8, z: -30 }, rotationY: Math.PI / 2 },
    { id: 'light_allen_3', type: 'streetlight', position: { x: -8, z: 30 }, rotationY: Math.PI / 2 },
    { id: 'light_allen_4', type: 'streetlight', position: { x: -8, z: 65 }, rotationY: Math.PI / 2 },
    { id: 'light_allen_5', type: 'streetlight', position: { x: 8, z: -65 }, rotationY: -Math.PI / 2 },
    { id: 'light_allen_6', type: 'streetlight', position: { x: 8, z: -30 }, rotationY: -Math.PI / 2 },
    { id: 'light_allen_7', type: 'streetlight', position: { x: 8, z: 30 }, rotationY: -Math.PI / 2 },
    { id: 'light_allen_8', type: 'streetlight', position: { x: 8, z: 65 }, rotationY: -Math.PI / 2 },

    // Palm trees in park and verges
    { id: 'tree_park_1', type: 'tree_palm', position: { x: -60, z: -20 }, rotationY: 0.4, scale: 1.1 },
    { id: 'tree_park_2', type: 'tree_palm', position: { x: -74, z: -28 }, rotationY: 1.2, scale: 1.2 },
    { id: 'tree_park_3', type: 'tree_palm', position: { x: -65, z: -35 }, rotationY: 2.1, scale: 0.95 },
    { id: 'tree_park_4', type: 'tree_shade', position: { x: -72, z: -18 }, rotationY: 0.8, scale: 1.0 },
    { id: 'tree_park_5', type: 'tree_shade', position: { x: -58, z: -32 }, rotationY: 2.7, scale: 1.15 },

    // Boulevard trees
    { id: 'tree_mall_1', type: 'tree_palm', position: { x: 14, z: -10 }, rotationY: 0.1, scale: 1.0 },
    { id: 'tree_mall_2', type: 'tree_palm', position: { x: 38, z: -10 }, rotationY: 0.5, scale: 1.05 },
    { id: 'tree_hosp_1', type: 'tree_shade', position: { x: 14, z: 12 }, rotationY: 1.3, scale: 0.9 },
    { id: 'tree_buka_1', type: 'tree_palm', position: { x: -14, z: 12 }, rotationY: 2.5, scale: 1.1 },
    { id: 'tree_res_1', type: 'tree_palm', position: { x: -14, z: -10 }, rotationY: 0.8, scale: 1.0 },

    // Park benches
    { id: 'bench_park_1', type: 'bench', position: { x: -68, z: -22 }, rotationY: Math.PI / 4 },
    { id: 'bench_mall_1', type: 'bench', position: { x: 16, z: -12 }, rotationY: 0 },
    { id: 'bench_buka_1', type: 'bench', position: { x: -18, z: 14 }, rotationY: Math.PI },

  ],
};

// Top-level Global World hierarchy representation
export const GLOBAL_WORLD_HIERARCHY: ContinentData[] = [
  {
    id: 'continent_africa',
    name: 'Africa',
    countries: [
      {
        id: 'country_nigeria',
        name: 'Nigeria',
        continentId: 'continent_africa',
        code: 'NG',
        currencyCode: 'NGN',
        currencySymbol: '₦',
        states: [
          {
            id: 'state_lagos',
            name: 'Lagos',
            countryId: 'country_nigeria',
            cities: [
              {
                id: 'city_lagos',
                name: 'Lagos',
                stateId: 'state_lagos',
                countryId: 'country_nigeria',
                districts: [IKEJA_DISTRICT_DATA],
              },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * Helper to locate district data by hierarchical IDs
 */
export function getDistrictData(
  continentId: string = 'continent_africa',
  countryId: string = 'country_nigeria',
  stateId: string = 'state_lagos',
  cityId: string = 'city_lagos',
  districtId: string = 'district_ikeja'
): DistrictData {
  const continent = GLOBAL_WORLD_HIERARCHY.find((c) => c.id === continentId);
  const country = continent?.countries.find((c) => c.id === countryId);
  const state = country?.states.find((s) => s.id === stateId);
  const city = state?.cities.find((ci) => ci.id === cityId);
  const district = city?.districts.find((d) => d.id === districtId);

  return district || IKEJA_DISTRICT_DATA;
}
