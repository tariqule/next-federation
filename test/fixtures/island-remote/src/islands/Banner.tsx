import './ProductPanel.css'
import { Counter } from './Counter'

export default async function Banner({ text }: { text: string }) {
  return (
    <aside className="nf-product-panel" data-island="Banner">
      <strong data-testid="banner-text">{text}</strong>
      <Counter />
    </aside>
  )
}
