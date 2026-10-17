/**
 * Wardrobe catalog: the clothing that REALLY exists in the game build.
 *
 * Only models that are shipped and can be drawn on the player figure are listed here (see FigureCharacter.setOutfit):
 *   - Leather jacket : the textured jacket mesh inside figure.glb, worn over the knit top
 *   - Knit top       : the procedural knit tank (FigureMaterials.createInnerWearMaterial), worn alone
 * Head, Trousers and Accessories have NO shipped models yet, so those categories are intentionally empty and the showroom
 * shows blank placeholders for them. To add a garment later: ship its model, add an entry to WARDROBE_ITEMS and teach
 * FigureCharacter.setOutfit how to show / hide it. Nothing else (UI, saving, game start) needs to change.
 */

export type WardrobeCategoryId = 'head' | 'shirts' | 'trousers' | 'accessories';

/** one equipped item id per category (null / missing = nothing worn in that category) */
export type Outfit = Partial<Record<WardrobeCategoryId, string | null>>;

export interface WardrobeCategory {
  id: WardrobeCategoryId;
  label: string;
  /** a category the figure cannot be without: its equipped item cannot be taken off */
  required?: boolean;
}

export interface WardrobeItem {
  id: string;
  category: WardrobeCategoryId;
  name: string;
  /** short line under the name on the card */
  tag: string;
  /** what the character wears in this item's preview card (the item's own category entry is added automatically) */
  previewOutfit?: Outfit;
}

export const WARDROBE_CATEGORIES: WardrobeCategory[] = [
  { id: 'head', label: 'Head' },
  { id: 'shirts', label: 'Shirts', required: true },
  { id: 'trousers', label: 'Trousers' },
  { id: 'accessories', label: 'Accessories' },
];

export const ITEM_LEATHER_JACKET = 'leather_jacket';
export const ITEM_KNIT_TOP = 'knit_top';

export const WARDROBE_ITEMS: WardrobeItem[] = [
  { id: ITEM_LEATHER_JACKET, category: 'shirts', name: 'Leather Jacket', tag: 'Open jacket over knit' },
  { id: ITEM_KNIT_TOP, category: 'shirts', name: 'Knit Top', tag: 'Sleeveless knit' },
];

/** what a new player wears: the look the game has always had (leather jacket over the knit top) */
export const DEFAULT_OUTFIT: Outfit = { head: null, shirts: ITEM_LEATHER_JACKET, trousers: null, accessories: null };

export const itemsOf = (category: WardrobeCategoryId): WardrobeItem[] => WARDROBE_ITEMS.filter((i) => i.category === category);

export const findItem = (id: string | null | undefined): WardrobeItem | undefined =>
  id ? WARDROBE_ITEMS.find((i) => i.id === id) : undefined;

/** Drops ids that are not in the catalog (an old save, a removed item) and fills the required categories with the default. */
export function sanitizeOutfit(outfit: Outfit | null | undefined): Outfit {
  const out: Outfit = {};
  for (const c of WARDROBE_CATEGORIES) {
    const raw = outfit?.[c.id] ?? null;
    const item = findItem(raw);
    out[c.id] = item && item.category === c.id ? item.id : c.required ? (DEFAULT_OUTFIT[c.id] ?? null) : null;
  }
  return out;
}

/** the outfit shown on an item's preview card: the default look with that one item swapped in */
export function previewOutfitFor(item: WardrobeItem): Outfit {
  return sanitizeOutfit({ ...DEFAULT_OUTFIT, ...item.previewOutfit, [item.category]: item.id });
}
