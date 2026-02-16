import puppeteer, { BrowserWorker } from '@cloudflare/puppeteer';
import { Product, ScrapeResult } from './types';

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>;

/**
 * Fetches product size and stock data from the Next.js data route.
 * This endpoint is NOT behind Kasada and can be called directly.
 */
async function getProductSizeData(
  baseUrl: string,
  buildId: string,
  productPath: string
): Promise<{ sizes: string[]; allSizes: string[] } | null> {
  // productPath is like "/us/en/shop/mens/alpha-pant"
  const dataUrl = `${baseUrl}/catalog-pages/_next/data/${buildId}${productPath}.json`;

  try {
    const resp = await fetch(dataUrl);
    if (!resp.ok) {
      console.log(`  Data route ${resp.status} for ${productPath}`);
      return null;
    }

    const data = await resp.json() as any;
    const productStr = data?.pageProps?.product;
    if (!productStr) {
      console.log(`  No product data for ${productPath}`);
      return null;
    }

    const product = JSON.parse(productStr);
    const sizeOptions: { label: string; value: string }[] = product.sizeOptions?.options || [];
    const variants: { sizeId: string; stockStatus: string }[] = product.variants || [];

    // Build sizeId -> label mapping
    const sizeIdToLabel = new Map<string, string>();
    for (const opt of sizeOptions) {
      sizeIdToLabel.set(opt.value, opt.label);
    }

    // Find in-stock sizes
    const allSizes = sizeOptions.map((o) => o.label);
    const inStockSizes: string[] = [];
    for (const variant of variants) {
      if (variant.stockStatus === 'InStock' || variant.stockStatus === 'LowStock') {
        const label = sizeIdToLabel.get(variant.sizeId);
        if (label && !inStockSizes.includes(label)) {
          inStockSizes.push(label);
        }
      }
    }

    return { sizes: inStockSizes, allSizes };
  } catch (e) {
    console.log(`  Error fetching size data for ${productPath}: ${e}`);
    return null;
  }
}

/**
 * Checks if a size label matches the filter.
 * Handles formats like "L-R" matching filter "L", "L-R", or "LR".
 */
function sizeMatches(sizeLabel: string, filter: string): boolean {
  const normalized = sizeLabel.toUpperCase().replace(/[- ]/g, '');
  const normalizedFilter = filter.toUpperCase().replace(/[- ]/g, '');

  // Exact match after normalization (e.g., "LR" matches "LR")
  if (normalized === normalizedFilter) return true;

  // Filter is just the letter part (e.g., "L" matches "L-R" / "LR")
  if (normalized.startsWith(normalizedFilter)) return true;

  return false;
}

/**
 * Extracts products from a category listing page and enriches with size data.
 */
async function extractProducts(
  page: Page,
  baseUrl: string,
  category: string,
  sizeFilter?: string
): Promise<Product[]> {
  const url = `${baseUrl}/us/en/c/${category}`;
  console.log(`Navigating to ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForSelector('a[href*="/shop/"]', { timeout: 30000 });
  } catch {
    console.log('No /shop/ links after 30s');
  }

  await delay(3000);

  // Extract buildId and products from the page
  const pageData = await page.evaluate((baseUrl: string, category: string) => {
    // Get Next.js buildId
    let buildId = '';
    const nextDataScript = document.querySelector('#__NEXT_DATA__');
    if (nextDataScript) {
      try {
        const data = JSON.parse(nextDataScript.textContent || '');
        buildId = data.buildId || '';
      } catch {}
    }

    // Extract products from DOM
    const products: any[] = [];
    const tiles = document.querySelectorAll('[id^="mens-"], [id^="womens-"]');

    tiles.forEach((tile) => {
      const link = tile.querySelector('a[href*="/shop/"]') as HTMLAnchorElement;
      if (!link) return;

      const href = link.href;
      const slug = href.match(/\/shop\/(?:mens\/|womens\/)?(.+?)(?:\?|#|$)/)?.[1];
      if (!slug) return;

      // Get the path portion for the data route (e.g., /us/en/shop/mens/alpha-pant)
      const urlObj = new URL(href);
      const path = urlObj.pathname;

      const lines = (tile as HTMLElement).innerText.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const skipPatterns = /^(compare|veilance|fairtradecertified|new|sale)$/i;
      const nameLineIdx = lines.findIndex((l) =>
        l.match(/(?:Men's|Women's)$/i) && !l.match(/^\$/)
      );
      const name = nameLineIdx >= 0 ? lines[nameLineIdx] : (lines.find((l) => !l.match(/^\$/) && !skipPatterns.test(l)) || '');
      if (!name || name.length < 3) return;

      const tileText = (tile as HTMLElement).innerText;
      const priceMatches = tileText.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
      const prices = priceMatches.map((p) => parseFloat(p.replace(/[$,]/g, ''))).sort((a, b) => b - a);
      const originalPrice = prices[0] || 0;
      const salePrice = prices[1] || prices[0] || 0;

      const img = tile.querySelector('img');
      const image = img?.src || img?.getAttribute('data-src') || '';

      products.push({
        id: slug,
        name,
        price: salePrice,
        originalPrice,
        discount: originalPrice > salePrice ? Math.round(((originalPrice - salePrice) / originalPrice) * 100) : 0,
        url: href.startsWith('http') ? href : `${baseUrl}${href}`,
        path,
        image,
        sizes: [] as string[],
        colors: [] as string[],
        category,
        firstSeen: new Date().toISOString(),
      });
    });

    return { buildId, products };
  }, baseUrl, category);

  console.log(`Found ${pageData.products.length} products, buildId: ${pageData.buildId}`);

  if (!pageData.buildId) {
    console.log('WARNING: Could not extract buildId, skipping size data');
    return pageData.products;
  }

  // Fetch size data for each product via Next.js data route (no browser needed!)
  console.log('Fetching size data via Next.js data routes...');
  const products = pageData.products;

  for (const product of products) {
    const sizeData = await getProductSizeData(baseUrl, pageData.buildId, product.path);
    if (sizeData) {
      product.sizes = sizeData.sizes;
      console.log(`  ${product.name}: ${sizeData.sizes.length}/${sizeData.allSizes.length} sizes in stock [${sizeData.sizes.join(', ')}]`);
    }
    // Clean up the path field (not part of Product type)
    delete product.path;
  }

  // Apply size filter
  let filteredProducts = products;
  if (sizeFilter) {
    filteredProducts = products.filter((p: any) => {
      if (p.sizes.length === 0) {
        console.log(`  Including ${p.name} - no size data available`);
        return true;
      }
      const hasSize = p.sizes.some((s: string) => sizeMatches(s, sizeFilter));
      if (!hasSize) {
        console.log(`  Filtered out ${p.name} - size ${sizeFilter} not in stock (in stock: ${p.sizes.join(', ')})`);
      }
      return hasSize;
    });
    console.log(`Size filter: ${filteredProducts.length}/${products.length} products have size ${sizeFilter} in stock`);
  }

  console.log(`Returning ${filteredProducts.length} products`);
  return filteredProducts;
}

/**
 * Scrapes all categories using a single browser session.
 * Size data is fetched via Next.js data routes (no per-product browser navigation).
 */
export async function scrapeAllCategories(
  browserBinding: BrowserWorker,
  baseUrl: string,
  categories: string[],
  sizeFilter?: string
): Promise<ScrapeResult[]> {
  console.log(`Launching browser for ${categories.length} categories${sizeFilter ? `, filtering for size ${sizeFilter}` : ''}`);
  const browser = await puppeteer.launch(browserBinding);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const results: ScrapeResult[] = [];

  try {
    for (const category of categories) {
      console.log(`Scraping category: ${category}`);
      await delay(1000 + Math.random() * 2000);

      try {
        const products = await extractProducts(page, baseUrl, category, sizeFilter);
        console.log(`${products.length} products in ${category}`);
        results.push({ products, scrapedAt: new Date().toISOString(), category });
      } catch (e) {
        console.error(`Failed to scrape ${category}: ${e}`);
        results.push({ products: [], scrapedAt: new Date().toISOString(), category });
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
