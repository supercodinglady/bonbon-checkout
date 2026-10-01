// Netlify Function: Meta / Facebook Shop checkout redirect -> Squarespace cart
//
// Meta calls:
//   /.netlify/functions/checkout?products=<variantId>:<qty>,<variantId>:<qty>&coupon=XXX
//
// We translate each Meta retailer_id (= Squarespace variant id) into the
// {itemId, sku} pair that Squarespace's cart API needs, then redirect the
// shopper to:
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

// Embedded variant map (generated 2026-10-01 from the store's public shop JSON).
// variantId -> { itemId, sku }. Used as fallback when the live fetch fails.
const EMBEDDED_VARIANT_MAP = {
  'bd66d0f6-6e8a-432d-af46-63f928eb825f': { itemId: '6abdb46bb3e6a6177ee532d6', sku: 'SQ6635166' },
  '7c86daae-68a5-4bc1-b955-cf799fee6dc9': { itemId: '6abdb154343e8e14aad53c27', sku: 'SQ9150783' },
  'bbbaa574-5ec3-4e0e-b6cd-b769d88b7177': { itemId: '6abbf7c1cee48d5ed3f0ea0f', sku: 'SQ1615941' },
  'd643afcd-4214-45fe-9e7d-ece17909a68a': { itemId: '6abbf772f1bc361a7caca7c0', sku: 'SQ3553995' },
  '96aab720-3ad5-4ade-9199-9d104d8575f1': { itemId: '6abbf71af1bc361a7caca73e', sku: 'SQ8141114' },
  '35dd7378-7669-4a45-bfda-9ad4cb67a9a9': { itemId: '6ab9be0cae14e00b87b0d3b1', sku: 'SQ3884445' },
  'c166025f-a7f3-476d-b633-281c7516385a': { itemId: '6ab9551fd5e67563c3b9503c', sku: 'SQ8410974' },
  '5d9af313-dadf-492b-96b4-011d03669b20': { itemId: '6ab7347044aea31d23e27e3b', sku: 'SQ4008289' },
  '2df518e2-e63c-42aa-8354-ffe666243620': { itemId: '6ab54b472efa7c342b3061ed', sku: 'SQ0312463' },
  '0f36e844-8f83-4ea1-9da8-cb1ef437e6bc': { itemId: '6ab544f7ae14e00b87ada00c', sku: 'SQ6386213' },
  '81ca45ca-6801-4a7b-b270-e27b99f74c92': { itemId: '6ab41a29d5e67563c3b58811', sku: 'SQ9862077' },
  '5ca2d08f-096c-483d-a5f8-8f60a6ef027d': { itemId: '6ab07e9c51e8655725fb98b6', sku: 'SQ5338194' },
  '59e73128-c7b3-42e6-85e4-49dbf86948f9': { itemId: '6ab0785b8f7bb96f8f6bca66', sku: 'SQ2202545' },
  '48d4bd3d-40e8-4a43-b52a-b8db844a3fe2': { itemId: '6ab047f78f7bb96f8f6ba3c9', sku: 'SQ5549727' },
  'c5cb6de5-2f26-4ad0-9141-882259fdb46b': { itemId: '6aaddd14d5e67563c3b0cbfe', sku: 'SQ7019898' },
  'eaa90dd7-0bf7-4317-a7d1-faebd8389882': { itemId: '6aad434e5271115dbddc9aea', sku: 'SQ4675133' },
  '7d771195-a9b8-4820-9db3-adc53e6f6e46': { itemId: '6aabff13f8197e7e5a2c12ab', sku: 'SQ5016008' },
  '23cec73d-1551-47f2-a26b-024d0db3f2c8': { itemId: '6aabff13f8197e7e5a2c129c', sku: 'SQ2437618' },
  '96ebe182-086b-4407-ad81-e3618468c4c2': { itemId: '6aabff13f8197e7e5a2c12a3', sku: 'SQ1041206' },
};

// variantId -> { itemId, sku }; refreshed every few minutes
let variantCache = { at: 0, map: {} };
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getVariantMap() {
  const now = Date.now();
  if (Object.keys(variantCache.map).length > 0 && now - variantCache.at < CACHE_TTL_MS) {
    return variantCache.map;
  }
  // Try the live shop JSON first (products live at data.items).
  try {
    const res = await fetch(SHOP_JSON_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'bonbon-checkout/1.0' },
    });
    if (res.ok) {
      const data = await res.json();
      const items = (data && data.items) || [];
      const map = {};
      for (const product of items) {
        const itemId = product.id;
        const variants = product.variants || [];
        for (const v of variants) {
          if (v && v.id && itemId && v.sku) {
            map[v.id] = { itemId: itemId, sku: v.sku };
          }
        }
      }
      if (Object.keys(map).length > 0) {
        variantCache = { at: now, map: map };
        return map;
      }
    }
  } catch (e) {
    // fall through to the embedded map
  }
  // Fallback: embedded map (always available).
  variantCache = { at: now, map: EMBEDDED_VARIANT_MAP };
  return EMBEDDED_VARIANT_MAP;
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
    body: '',
  };
}

exports.handler = async (event) => {
  const params = (event && event.queryStringParameters) || {};
  const productsParam = (params.products || '').trim();

  // No products: send the shopper to the shop instead of an empty cart.
  if (!productsParam) {
    return redirect(SHOP_FALLBACK_URL);
  }

  let adds = [];
  try {
    const map = await getVariantMap();
    const chunks = productsParam.split(',');
    for (const chunk of chunks) {
      const parts = chunk.split(':');
      const variantId = (parts[0] || '').trim();
      const entry = map[variantId];
      // Unknown variant or missing sku: skip it rather than breaking the redirect.
      if (!entry || !entry.itemId || !entry.sku) continue;
      const qty = Math.max(1, parseInt(parts[1], 10) || 1);
      adds.push(entry.itemId + ':' + entry.sku + ':' + qty);
    }
  } catch (e) {
    // Mapping failed (shop JSON unreachable): don't strand the shopper.
    return redirect(SHOP_FALLBACK_URL);
  }

  if (adds.length === 0) {
    return redirect(SHOP_FALLBACK_URL);
  }

  const target = CART_URL + '?add=' + encodeURIComponent(adds.join(','));
  return redirect(target);
};
