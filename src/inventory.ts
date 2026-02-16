import { Env, InventoryChanges, InventoryState, Product, ScrapeResult } from './types';

const KV_KEY = 'outlet-inventory';

export async function getStoredInventory(kv: KVNamespace): Promise<InventoryState | null> {
  const data = await kv.get(KV_KEY, 'json');
  return data as InventoryState | null;
}

export async function saveInventory(kv: KVNamespace, state: InventoryState): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(state));
}

export function compareInventory(
  stored: InventoryState | null,
  scrapeResults: ScrapeResult[]
): InventoryChanges {
  const currentProducts = scrapeResults.flatMap((r) => r.products);
  const storedProducts = stored?.products || [];

  const storedMap = new Map(storedProducts.map((p) => [p.id, p]));
  const currentMap = new Map(currentProducts.map((p) => [p.id, p]));

  const newProducts: Product[] = [];
  const priceDrops: { product: Product; previousPrice: number }[] = [];
  const removedProducts: Product[] = [];

  // Find new products and price drops
  for (const product of currentProducts) {
    const existing = storedMap.get(product.id);
    if (!existing) {
      newProducts.push(product);
    } else if (product.price < existing.price) {
      priceDrops.push({ product, previousPrice: existing.price });
    }
  }

  // Find removed products
  for (const product of storedProducts) {
    if (!currentMap.has(product.id)) {
      removedProducts.push(product);
    }
  }

  return { newProducts, priceDrops, removedProducts };
}

export function mergeInventory(
  stored: InventoryState | null,
  scrapeResults: ScrapeResult[]
): InventoryState {
  const currentProducts = scrapeResults.flatMap((r) => r.products);
  const storedMap = new Map((stored?.products || []).map((p) => [p.id, p]));

  // Preserve firstSeen from existing products
  const mergedProducts = currentProducts.map((product) => {
    const existing = storedMap.get(product.id);
    return {
      ...product,
      firstSeen: existing?.firstSeen || product.firstSeen,
    };
  });

  return {
    lastUpdated: new Date().toISOString(),
    products: mergedProducts,
  };
}

export function hasChanges(changes: InventoryChanges): boolean {
  return changes.newProducts.length > 0 || changes.priceDrops.length > 0;
}
