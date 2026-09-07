export const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function balanced(items) {
  const buckets = new Map();
  for (const item of items) {
    const key = `${item.category}|${item.merchant}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const groups = [...buckets.values()], result = [];
  for (let i = 0; groups.some(group => i < group.length); i++) {
    for (const group of groups) if (group[i]) result.push(group[i]);
  }
  return result;
}

export function selectProducts(items, { query = '', category = 'All', merchant = 'All', min = '', max = '', sale = false, saved = false, favorites = [], sort = 'relevance', currency = 'All' } = {}) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const results = items.filter(p => {
    const text = normalize(`${p.title} ${p.merchant} ${p.category} ${p.terms || ''}`);
    return (category === 'All' || p.category === category) && (merchant === 'All' || p.merchant === merchant)
      && tokens.every(token => text.includes(token)) && (min === '' || p.price >= Number(min))
      && (max === '' || p.price <= Number(max)) && (!sale || p.oldPrice > p.price)
      && (!saved || favorites.includes(p.id)) && (currency === 'All' || (p.currency || 'USD') === currency);
  });
  if (sort === 'price-low') return results.sort((a, b) => (a.currency || 'USD').localeCompare(b.currency || 'USD') || a.price - b.price);
  if (sort === 'price-high') return results.sort((a, b) => (a.currency || 'USD').localeCompare(b.currency || 'USD') || b.price - a.price);
  if (sort === 'discount') return results.sort((a, b) => saving(b) - saving(a));
  if (sort === 'newest') return results.sort((a, b) => (Date.parse(b.firstSeenAt) || 0) - (Date.parse(a.firstSeenAt) || 0));
  const mixed = balanced(results);
  if (tokens.length) mixed.sort((a, b) => score(b, tokens) - score(a, tokens));
  return mixed;
}

const saving = p => p.oldPrice > p.price ? 1 - p.price / p.oldPrice : 0;
const score = (p, tokens) => tokens.reduce((sum, token) => sum + (normalize(p.title).includes(token) ? 2 : 0) + (normalize(p.merchant).includes(token) ? 1 : 0), 0);
