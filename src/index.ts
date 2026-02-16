import { Hono } from 'hono';
import { Env } from './types';
import { scrapeAllCategories } from './scraper';
import { compareInventory, getStoredInventory, hasChanges, mergeInventory, saveInventory } from './inventory';
import { sendAlertEmail, sendNotification } from './notifications';

const app = new Hono<{ Bindings: Env }>();

const ALERT_KV_KEY = 'last-alert-sent';
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours
const SUCCESS_KV_KEY = 'last-successful-scrape';

async function sendThrottledAlert(env: Env, error: string): Promise<void> {
  try {
    const lastAlert = await env.INVENTORY_KV.get(ALERT_KV_KEY);
    if (lastAlert) {
      const elapsed = Date.now() - new Date(lastAlert).getTime();
      if (elapsed < ALERT_THROTTLE_MS) {
        console.log(`Alert throttled (last sent ${Math.round(elapsed / 60000)}m ago)`);
        return;
      }
    }
    await sendAlertEmail(env, error);
    await env.INVENTORY_KV.put(ALERT_KV_KEY, new Date().toISOString());
    console.log('Alert email sent');
  } catch (e) {
    console.error(`Failed to send alert: ${e}`);
  }
}

async function recordSuccess(kv: KVNamespace): Promise<void> {
  await kv.put(SUCCESS_KV_KEY, new Date().toISOString());
}

async function runMonitor(env: Env): Promise<{ success: boolean; message: string }> {
  const categories = env.CATEGORIES.split(',').map((c) => c.trim());
  console.log(`Starting monitor for categories: ${categories.join(', ')}`);

  // Scrape all categories using headless browser
  const sizeFilter = env.SIZE_FILTER || undefined;
  const scrapeResults = await scrapeAllCategories(env.BROWSER, env.OUTLET_BASE_URL, categories, sizeFilter);
  const totalProducts = scrapeResults.reduce((sum, r) => sum + r.products.length, 0);
  console.log(`Scraped ${totalProducts} products across ${categories.length} categories`);

  if (totalProducts === 0 && !sizeFilter) {
    const msg = 'No products found - scraping may have been blocked or site structure changed';
    console.log(msg);
    await sendThrottledAlert(env, msg);
    return { success: false, message: msg };
  }

  if (totalProducts === 0 && sizeFilter) {
    console.log(`No products found with size ${sizeFilter} - this may be normal`);
  }

  // Compare with stored inventory
  const stored = await getStoredInventory(env.INVENTORY_KV);
  const changes = compareInventory(stored, scrapeResults);

  console.log(
    `Changes: ${changes.newProducts.length} new, ${changes.priceDrops.length} price drops, ${changes.removedProducts.length} removed`
  );

  // Send notification if there are meaningful changes
  if (hasChanges(changes)) {
    try {
      await sendNotification(env, changes);
      console.log('Email notification sent');
    } catch (e) {
      console.error(`Failed to send notification: ${e}`);
    }
  } else {
    console.log('No meaningful changes, skipping notification');
  }

  // Update stored inventory
  const updated = mergeInventory(stored, scrapeResults);
  await saveInventory(env.INVENTORY_KV, updated);
  console.log(`Inventory updated: ${updated.products.length} products stored`);

  await recordSuccess(env.INVENTORY_KV);

  return {
    success: true,
    message: `Scraped ${totalProducts} products. ${changes.newProducts.length} new, ${changes.priceDrops.length} price drops.`,
  };
}

// Cron trigger handler
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runMonitor(env).catch(async (error) => {
        console.error('Monitor failed:', error);
        await sendThrottledAlert(env, `Unhandled error: ${error}`);
      })
    );
  },

  // HTTP handler for manual triggers and status checks
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

// Manual trigger endpoint
app.post('/trigger', async (c) => {
  try {
    const result = await runMonitor(c.env);
    return c.json(result);
  } catch (e) {
    console.error('Manual trigger failed:', e);
    return c.json({ success: false, message: `Error: ${e}` }, 500);
  }
});

// View current inventory
app.get('/inventory', async (c) => {
  const stored = await getStoredInventory(c.env.INVENTORY_KV);
  if (!stored) {
    return c.json({ message: 'No inventory data yet' }, 404);
  }
  return c.json(stored);
});

// Health check
app.get('/', async (c) => {
  const lastSuccess = await c.env.INVENTORY_KV.get(SUCCESS_KV_KEY);
  const lastAlert = await c.env.INVENTORY_KV.get(ALERT_KV_KEY);
  return c.json({
    service: 'arcteryx-outlet-tracker',
    status: 'running',
    categories: c.env.CATEGORIES.split(',').map((c) => c.trim()),
    lastSuccessfulScrape: lastSuccess || null,
    lastAlertSent: lastAlert || null,
  });
});
