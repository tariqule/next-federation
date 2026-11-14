import './ProductPanel.css';
import { addToCart } from '../actions';
import { getProduct } from '../data';
import { AddToCart } from './AddToCart';
import { Counter } from './Counter';

export default async function ProductPanel({ sku }: { sku: string }) {
  const product = await getProduct(sku);
  return (
    <section className="nf-product-panel" data-island="ProductPanel">
      <h2>{product.name}</h2>
      <p>${product.price}</p>
      <Counter />
      <AddToCart sku={sku} addToCart={addToCart} />
    </section>
  );
}
