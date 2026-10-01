// Bonbon Silver — Meta Shops checkout redirect.
// Meta sends customers here like:
//   /.netlify/functions/checkout?products=<retailer_id>:<qty>,...&coupon=<code>
// This converts it to a Squarespace cart URL that pre-adds the item:
//   https://www.bonbonsilver.com/cart?addProductId=<retailer_id>&quantity=<qty>

const SHOP = 'https://www.bonbonsilver.com';

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-cache' },
  };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const productsParam = (params.products || '').trim();

  if (!productsParam) {
    // No product info (e.g. Meta's URL check) -> send to the shop page.
    return redirect(`${SHOP}/shop`);
  }

  const items = productsParam
    .split(',')
    .map((pair) => {
      const idx = pair.lastIndexOf(':');
      if (idx < 0) return null;
      const id = pair.slice(0, idx).trim();
      const qty = parseInt(pair.slice(idx + 1).trim(), 10);
      if (!id) return null;
      return { id, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
    })
    .filter(Boolean);

  if (items.length === 0) {
    return redirect(`${SHOP}/shop`);
  }

  // Squarespace's cart accepts one addProductId; use the first item.
  // (Antiques here are one-of-a-kind, so single-item checkout is the norm.)
  const first = items[0];
  const cartUrl =
    `${SHOP}/cart?addProductId=${encodeURIComponent(first.id)}` +
    `&quantity=${first.qty}`;

  return redirect(cartUrl);
};
