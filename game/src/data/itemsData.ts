import { InventoryItem } from '../types/game';

export const INITIAL_AVAILABLE_ITEMS: Record<string, InventoryItem> = {
  jollof_rice: {
    id: 'jollof_rice',
    name: 'Smoky Jollof Rice & Plantain',
    description: 'Hot fragrant Nigerian party jollof with fried dodo. Hearty and satisfying.',
    category: 'food',
    quantity: 1,
    effects: {
      hunger: 45,
      energy: 15,
      happiness: 20,
    },
  },
  suya_skewer: {
    id: 'suya_skewer',
    name: 'Spiced Beef Suya',
    description: 'Tender fire-grilled beef seasoned with yaji spice, onions, and pepper.',
    category: 'food',
    quantity: 1,
    effects: {
      hunger: 30,
      energy: 10,
      happiness: 15,
    },
  },
  malt_drink: {
    id: 'malt_drink',
    name: 'Cold Malt Beverage',
    description: 'Rich non-alcoholic malt drink. Refreshes and restores stamina.',
    category: 'beverage',
    quantity: 1,
    effects: {
      hunger: 10,
      energy: 25,
      happiness: 10,
    },
  },
  bottled_water: {
    id: 'bottled_water',
    name: 'Bottled Spring Water',
    description: 'Cold pure water to stay hydrated under the Lagos tropical sunshine.',
    category: 'beverage',
    quantity: 1,
    effects: {
      hunger: 5,
      energy: 10,
      health: 5,
    },
  },
  meat_pie: {
    id: 'meat_pie',
    name: 'Freshly Baked Meat Pie',
    description: 'Golden flaky pastry filled with minced beef, carrots, and potatoes.',
    category: 'food',
    quantity: 1,
    effects: {
      hunger: 25,
      energy: 10,
      happiness: 10,
    },
  },
  energy_snack: {
    id: 'energy_snack',
    name: 'Groundnut & Plantain Chips',
    description: 'Crunchy salted chips and roasted peanuts for a fast energy boost on the go.',
    category: 'food',
    quantity: 1,
    effects: {
      hunger: 15,
      energy: 15,
    },
  },
  paracetamol: {
    id: 'paracetamol',
    name: 'Pain Relief Tablets',
    description: 'Over-the-counter medicine to relieve headaches and fatigue.',
    category: 'medicine',
    quantity: 1,
    effects: {
      health: 20,
      stress: -20,
    },
  },
};
