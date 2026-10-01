// Netlify Function: Meta / Facebook Shop checkout redirect -> Squarespace cart
//
// Meta calls:
//   /.netlify/functions/checkout?products=<variantId>:<qty>,<variantId>:<qty>&coupon=XXX
//
// We translate each Meta retailer_id (= Squarespace variant id) into the
// {itemId, sku} pair that Squarespace's cart API needs, using the store's
// public shop JSON, then redirect the shopper to:
//
//   https://www.bonbonsilver.com/cart?add=<itemId>:<sku>:<qty>,...
//
// A small footer script injected on bonbonsilver.com (Settings -> Advanced ->
// Code Injection -> Footer) reads the ?add= parameter and POSTs each entry to
// /api/commerce/shopping-cart/entries on the same origin (with CSRF crumb),
// which is the only reliable way to build the shopper's cart.

const SHOP_URL = 'https://www.bonbonsilver.com';
const SHOP_JSON_URL = SHOP_URL + '/shop?format=json';
const CART_URL = SHOP_URL + '/cart';
const SHOP_FALLBACK_URL = SHOP_URL + '/shop';

// variantId -> { itemId, sku }; refreshed every few minutes
let variantCache = { at: 0, map: {} };
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getVariantMap() {
  const now = Date.now();
  if (Object.keys(variantCache.map).length > 0 && now - variantCache.at < CACHE_TTL_MS) {
    return variantCache.map;
  }
  const res = await fetch(SHOP_JSON_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'bonbon-checkout/1.0' },
  });
  if (!res.ok) throw new Error('shop JSON fetch failed: HTTP ' + res.status);
  const data = await res.json();
  const items = (data && data.collection && data.collection.items) || [];
  const map = {};
  for (const product of items) {
    const itemId = product.id;
    const variants = product.variants || [];
    for (const v of variants) {
      if (v && v.id && itemId) {
        map[v.id] = { itemId: itemId, sku: v.sku || '' };
      }
    }
  }
  variantCache = { at: now, map: map };
  return map;
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
    body: '',
  };
}

exports.handler = async (event) => { const params = (event && event.queryStringParameters) || {}; const productsParam = (params.products || '').trim(); let mapKeys = 0; let adds = []; let error = null; try { const map = await getVariantMap(); mapKeys = Object.keys(map).length; const chunks = productsParam.split(','); for (const chunk of chunks) { const parts = chunk.split(':'); const variantId = (parts[0] || '').trim(); const entry = map[variantId]; if (!entry || !entry.itemId || !entry.sku) continue; const qty = Math.max(1, parseInt(parts[1], 10) || 1); adds.push(entry.itemId + ':' + entry.sku + ':' + qty); } } catch (e) { error = String((e && e.message) || e); } return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ productsParam: productsParam, mapKeys: mapKeys, adds: adds, error: error }), }; };
