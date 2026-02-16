import { BrowserWorker } from '@cloudflare/puppeteer';

export interface Env {
  INVENTORY_KV: KVNamespace;
  BROWSER: BrowserWorker;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  EMAIL_TO: string;
  OUTLET_BASE_URL: string;
  CATEGORIES: string;
  SIZE_FILTER: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  url: string;
  image: string;
  sizes: string[];
  colors: string[];
  category: string;
  firstSeen: string;
}

export interface InventoryState {
  lastUpdated: string;
  products: Product[];
}

export interface InventoryChanges {
  newProducts: Product[];
  priceDrops: { product: Product; previousPrice: number }[];
  removedProducts: Product[];
}

export interface ScrapeResult {
  products: Product[];
  scrapedAt: string;
  category: string;
}
