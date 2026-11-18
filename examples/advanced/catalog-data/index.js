// Stands in for the product API that the CDP, PDP and SERP remotes read on
// their servers. Plain data, no framework: in a real company this is a
// service the three remotes call, not a package.
export const CATEGORIES = [
  { slug: 'shoes', name: { en: 'Shoes', fr: 'Chaussures' } },
  { slug: 'outdoor', name: { en: 'Outdoor', fr: 'Plein air' } },
]

export const PRODUCTS = [
  {
    sku: 'A1',
    category: 'shoes',
    price: 89,
    name: { en: 'Trail shoe', fr: 'Chaussure de trail' },
    tags: ['running', 'trail'],
  },
  {
    sku: 'A2',
    category: 'shoes',
    price: 119,
    name: { en: 'Road runner', fr: 'Chaussure de route' },
    tags: ['running', 'road'],
  },
  {
    sku: 'A3',
    category: 'shoes',
    price: 59,
    name: { en: 'Camp sandal', fr: 'Sandale de camp' },
    tags: ['camp', 'summer'],
  },
  {
    sku: 'B1',
    category: 'outdoor',
    price: 129,
    name: { en: 'Rain jacket', fr: 'Veste de pluie' },
    tags: ['rain', 'hiking'],
  },
  {
    sku: 'B2',
    category: 'outdoor',
    price: 14,
    name: { en: 'Camp mug', fr: 'Tasse de camp' },
    tags: ['camp'],
  },
  {
    sku: 'B3',
    category: 'outdoor',
    price: 45,
    name: { en: 'Head torch', fr: 'Lampe frontale' },
    tags: ['camp', 'hiking'],
  },
]

export function productName(product, locale) {
  return product.name[locale] ?? product.name.en
}

export function formatPrice(price, locale) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    style: 'currency',
    currency: 'EUR',
  }).format(price)
}

export function getProduct(sku) {
  return PRODUCTS.find((p) => p.sku === sku)
}

export function getCategory(slug) {
  return CATEGORIES.find((c) => c.slug === slug)
}

export function productsIn(category) {
  return PRODUCTS.filter((p) => p.category === category)
}

/** Products that share a tag with `sku`, best match first. */
export function related(sku, limit = 3) {
  const product = getProduct(sku)
  if (!product) return PRODUCTS.slice(0, limit)
  return PRODUCTS.filter((p) => p.sku !== sku)
    .map((p) => ({
      p,
      score: p.tags.filter((t) => product.tags.includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p)
}

/** A case-insensitive match on the name (any locale), sku and tags. */
export function search(query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 64)
  if (!q) return []
  return PRODUCTS.filter(
    (p) =>
      p.sku.toLowerCase() === q ||
      Object.values(p.name).some((n) => n.toLowerCase().includes(q)) ||
      p.tags.some((t) => t.includes(q))
  )
}
