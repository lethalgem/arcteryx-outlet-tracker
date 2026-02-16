# Arc'teryx Outlet Tracker

A Cloudflare Worker that monitors the [Arc'teryx outlet](https://outlet.arcteryx.com) for new products and price drops. Runs on a cron schedule, tracks inventory changes in KV storage, and sends HTML email notifications via [Resend](https://resend.com).

## How It Works

1. **Scrape** — A headless browser (Cloudflare Browser Rendering) loads the outlet category listing page to extract product tiles and the Next.js `buildId`.
2. **Fetch sizes** — For each product, a direct `fetch()` call to the Next.js data route (`/catalog-pages/_next/data/{buildId}/...`) retrieves size and stock data. This endpoint is not behind Kasada bot protection, so no browser is needed per-product.
3. **Filter** — Products are optionally filtered by size (e.g. `SIZE_FILTER=L` matches sizes like `L-R`).
4. **Compare** — New scrape results are compared against the previous inventory stored in Workers KV to detect new products, price drops, and removals.
5. **Notify** — If there are new products or price drops, an HTML email is sent via the Resend API with product images, prices, discounts, and available sizes.
6. **Store** — Updated inventory is saved back to KV for the next run.

## Project Structure

```
src/
├── index.ts           # Hono app, cron handler, HTTP endpoints
├── scraper.ts         # Puppeteer scraping + Next.js data route fetching
├── inventory.ts       # KV storage, inventory comparison, and merging
├── notifications.ts   # Resend email formatting and sending
└── types.ts           # TypeScript interfaces (Env, Product, etc.)
wrangler.toml          # Worker config, cron schedule, bindings, env vars
```

## Setup

Prerequisites: Node.js, a [Cloudflare](https://dash.cloudflare.com) account with Browser Rendering enabled, and a [Resend](https://resend.com) API key.

```sh
npm install

# Set secrets
wrangler secret put RESEND_API_KEY
wrangler secret put EMAIL_TO        # recipient email address

# Deploy
npm run deploy
```

The cron trigger runs every 30 minutes. You can also trigger manually:

```sh
curl -X POST https://<your-worker>.workers.dev/trigger
```

## Configuration

Environment variables in `wrangler.toml`:

| Variable | Description | Example |
|---|---|---|
| `CATEGORIES` | Comma-separated outlet category slugs to monitor | `mens/pants` |
| `SIZE_FILTER` | Only include products with this size in stock (optional) | `L` |
| `EMAIL_FROM` | Sender email (must be verified in Resend) | `Arc'teryx Outlet Monitor <outlet@example.com>` |
| `OUTLET_BASE_URL` | Base URL of the outlet site | `https://outlet.arcteryx.com` |

### Size filter matching

Arc'teryx uses sizes like `L-R` (Large, Regular inseam), `XS-R`, `M-R`, etc. Some pants use numeric sizes (`30-R`, `32-R`). Setting `SIZE_FILTER=L` will match `L-R` via prefix matching after normalizing hyphens and spaces.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check — returns service name and configured categories |
| `POST` | `/trigger` | Manually run the full scrape-compare-notify cycle |
| `GET` | `/inventory` | View the current stored inventory |
