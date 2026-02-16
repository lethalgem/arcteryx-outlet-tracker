import { Env, InventoryChanges, Product } from './types';

function formatPrice(price: number): string {
  return `$${price.toFixed(0)}`;
}

function productCard(product: Product, label: string, extraInfo?: string): string {
  const imageHtml = product.image
    ? `<img src="${product.image}" alt="${product.name}" style="width:100%;max-width:280px;border-radius:8px;margin-bottom:12px;" />`
    : '';

  return `
    <div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin-bottom:16px;max-width:400px;">
      <div style="background:#1a1a1a;color:#fff;display:inline-block;padding:4px 12px;border-radius:16px;font-size:12px;font-weight:600;margin-bottom:12px;">
        ${label}
      </div>
      ${imageHtml}
      <h3 style="margin:0 0 8px;font-size:16px;color:#1a1a1a;">${product.name}</h3>
      <div style="margin-bottom:8px;">
        <span style="font-size:20px;font-weight:700;color:#c41e3a;">${formatPrice(product.price)}</span>
        ${product.originalPrice > product.price ? `
          <span style="font-size:14px;color:#888;text-decoration:line-through;margin-left:8px;">${formatPrice(product.originalPrice)}</span>
          <span style="font-size:14px;font-weight:600;color:#2e7d32;margin-left:8px;">${product.discount}% off</span>
        ` : ''}
      </div>
      ${extraInfo ? `<div style="font-size:13px;color:#666;margin-bottom:8px;">${extraInfo}</div>` : ''}
      ${product.sizes.length > 0 ? `<div style="font-size:13px;color:#666;margin-bottom:8px;">Sizes: ${product.sizes.join(', ')}</div>` : ''}
      ${product.colors.length > 0 ? `<div style="font-size:13px;color:#666;margin-bottom:12px;">Colors: ${product.colors.join(', ')}</div>` : ''}
      <a href="${product.url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
        View Product →
      </a>
    </div>
  `;
}

function buildEmailHtml(changes: InventoryChanges): string {
  const sections: string[] = [];

  if (changes.newProducts.length > 0) {
    const cards = changes.newProducts
      .map((p) => productCard(p, 'NEW'))
      .join('');
    sections.push(`
      <div style="margin-bottom:32px;">
        <h2 style="color:#1a1a1a;font-size:20px;margin-bottom:16px;">
          🆕 ${changes.newProducts.length} New Product${changes.newProducts.length > 1 ? 's' : ''}
        </h2>
        ${cards}
      </div>
    `);
  }

  if (changes.priceDrops.length > 0) {
    const cards = changes.priceDrops
      .map(({ product, previousPrice }) =>
        productCard(product, 'PRICE DROP', `Was ${formatPrice(previousPrice)} → Now ${formatPrice(product.price)}`)
      )
      .join('');
    sections.push(`
      <div style="margin-bottom:32px;">
        <h2 style="color:#1a1a1a;font-size:20px;margin-bottom:16px;">
          💰 ${changes.priceDrops.length} Price Drop${changes.priceDrops.length > 1 ? 's' : ''}
        </h2>
        ${cards}
      </div>
    `);
  }

  if (changes.removedProducts.length > 0) {
    const names = changes.removedProducts.map((p) => `<li>${p.name} (was ${formatPrice(p.price)})</li>`).join('');
    sections.push(`
      <div style="margin-bottom:32px;">
        <h2 style="color:#888;font-size:16px;margin-bottom:8px;">
          Removed: ${changes.removedProducts.length} product${changes.removedProducts.length > 1 ? 's' : ''}
        </h2>
        <ul style="color:#888;font-size:13px;">${names}</ul>
      </div>
    `);
  }

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
        <div style="text-align:center;margin-bottom:32px;">
          <h1 style="color:#1a1a1a;font-size:24px;margin:0;">Arc'teryx Outlet Alert</h1>
          <p style="color:#666;font-size:14px;margin:8px 0 0;">New deals detected on outlet.arcteryx.com</p>
        </div>
        ${sections.join('')}
        <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #e0e0e0;">
          <a href="https://outlet.arcteryx.com/us/en/c/mens/pants" style="color:#1a1a1a;font-size:14px;">Browse All Outlet Pants</a>
          <p style="color:#aaa;font-size:11px;margin-top:16px;">Automated monitoring by Arc'teryx Outlet Tracker</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildSubject(changes: InventoryChanges): string {
  const parts: string[] = [];
  if (changes.newProducts.length > 0) {
    parts.push(`${changes.newProducts.length} new`);
  }
  if (changes.priceDrops.length > 0) {
    parts.push(`${changes.priceDrops.length} price drop${changes.priceDrops.length > 1 ? 's' : ''}`);
  }
  return `Arc'teryx Outlet: ${parts.join(', ')}`;
}

export async function sendAlertEmail(env: Env, error: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: env.EMAIL_TO,
      subject: 'Arc\'teryx Outlet Tracker: Monitor Failure',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8" /></head>
        <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
            <h1 style="color:#c41e3a;font-size:20px;">Outlet Tracker Failed</h1>
            <p style="color:#333;font-size:14px;">The Arc'teryx outlet monitor encountered an error and may not be tracking inventory correctly.</p>
            <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
              <pre style="margin:0;font-size:13px;color:#666;white-space:pre-wrap;">${error}</pre>
            </div>
            <p style="color:#888;font-size:12px;">This alert is sent at most once every 6 hours. Check the Cloudflare Workers logs for more details.</p>
          </div>
        </body>
        </html>
      `,
    }),
  });

  if (!response.ok) {
    const respError = await response.text();
    console.error(`Failed to send alert email: ${response.status} ${respError}`);
  }
}

export async function sendNotification(env: Env, changes: InventoryChanges): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: env.EMAIL_TO,
      subject: buildSubject(changes),
      html: buildEmailHtml(changes),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${response.status} ${error}`);
  }

  console.log('Notification email sent successfully');
}
