export type Locale = 'en' | 'fr'
export type Category = { slug: string; name: Record<Locale, string> }
export type Product = {
  sku: string
  category: string
  price: number
  name: Record<Locale, string>
  tags: string[]
}

export declare const CATEGORIES: Category[]
export declare const PRODUCTS: Product[]
export declare function productName(product: Product, locale: string): string
export declare function formatPrice(price: number, locale: string): string
export declare function getProduct(sku: string): Product | undefined
export declare function getCategory(slug: string): Category | undefined
export declare function productsIn(category: string): Product[]
export declare function related(sku: string, limit?: number): Product[]
export declare function search(query: string): Product[]
