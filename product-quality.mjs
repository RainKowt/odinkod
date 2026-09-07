export function unsuitableProduct(text = '') {
  text=String(text).replace(/\s+/g,' ');
  return /\b(?:wholesale|factory(?:\s+direct)?|supplier|manufacturer|vendor|private label|custom(?:ized|izable|ization)?|oem|odm|low moq|sample order|dropshipping supplier|foreign trade|export quality|trade assurance)\b|(?:minimum order|moq|min\. order).{0,40}(?:\d+|pieces?|pcs?|units?|sets?|pairs?)|(?:\d{2,})\s*(?:pieces?|pcs?|units?|sets?|pairs?|packs?)\b|\b(?:pack|set|lot)\s+of\s+\d{2,}\b|\b(?:injectable|dermal filler|mesotherapy|microneedl\w*|cryolipolysis|fat freezing|hymen|vaginal tightening|skin tag removal|mole removal|weight loss|lose weight|slimming (?:cream|gel)|fat burning)\b/i.test(text);
}

export function retailCategory(value = '', title = '') {
  const text = `${title} ${/^\d+$/.test(value) ? '' : value}`;
  if (/\b(?:perfume|lipstick|shampoo|cosmetics?|makeup|nails?|eyelash|eyelashes|eyebrow|wig|wigs|hair|skincare|serum|manicure|pedicure)\b/i.test(text)) return 'Beauty';
  if (/\b(?:baby|maternity|diaper|diapers|nursing|menstrual|menstruation|sanitizer|toothpaste)\b/i.test(text)) return 'Personal Care';
  const categories = [
    ['Pet Supplies', /\b(?:pet|dog|cat|aquarium|leash|kennel)s?\b/i],
    ['Jewelry & Watches', /\b(?:jewelry|jewellery|necklace|bracelet|earring|pendant|watch|watches)s?\b/i],
    ['Bags & Accessories', /\b(?:handbag|backpack|wallet|sunglasses|luggage|purse)s?\b/i],
    ['Clothing & Fashion', /\b(?:dress|dresses|shirt|hoodie|jacket|jeans|shoe|sneaker|fashion|apparel|clothing|pants|socks|swimwear|boots|bra)s?\b/i],
    ['Electronics', /\b(?:phone|iphone|smartphone|earbuds|headphones|laptop|tablet|camera|charger|keyboard|speaker|smartwatch|usb|electronic)s?\b/i],
    ['Home & Living', /\b(?:home|furniture|kitchen|decor|chair|desk|table|lamp|bedding|pillow|blanket|cookware|storage|sofa)s?\b/i],
    ['Sports & Outdoors', /\b(?:sport|fitness|outdoor|camping|hiking|cycling|yoga|dumbbell|bicycle|fishing)s?\b/i],
    ['Toys & Games', /\b(?:toy|puzzle|doll|board game|plush)s?\b/i],
    ['Beauty', /\b(?:beauty|cosmetic|skin|skincare|hair|makeup|lipstick|shampoo|perfume|nail)s?\b/i],
    ['Automotive', /\b(?:automotive|car|motorcycle|vehicle|tire)s?\b/i],
  ];
  return categories.find(([, pattern]) => pattern.test(text))?.[0] || 'Other Products';
}

export function safeProduct(item) {
  if (!item || item.inStock === false || !Number.isFinite(Number(item.price)) || Number(item.price) <= 0) return false;
  if (unsuitableProduct(`${item.title || ''} ${item.terms || ''}`)) return false;
  if (/out[ _]of[ _]stock|sold out|unavailable|discontinued|preorder|pre-order|backorder/i.test(item.availability || '')) return false;
  try {
    const link = new URL(item.affiliateUrl), image = new URL(item.imageUrl);
    return !!item.title && !!item.merchant && /^https?:$/.test(link.protocol) && /^https?:$/.test(image.protocol) && link.pathname !== '/';
  } catch { return false; }
}
