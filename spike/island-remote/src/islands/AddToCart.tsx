'use client';
import { useState } from 'react';
import { Form } from './Form';

// The server action arrives as a prop from the server component, so it is bound to this
// island's own callServer (importing a 'use server' module here would use a page global).
export function AddToCart({
  sku,
  addToCart,
}: {
  sku: string;
  addToCart: (sku: string, qty: number) => Promise<string>;
}) {
  const [result, setResult] = useState('0');
  return (
    <Form
      action={async (fd) =>
        setResult(await addToCart(sku, Number(fd.get('qty') ?? 1)))
      }
    >
      <input
        name="qty"
        type="number"
        defaultValue={1}
        min={1}
        aria-label="quantity"
      />
      <button type="submit">Add {sku}</button>{' '}
      <output data-testid="cart-count">{result}</output>
    </Form>
  );
}
