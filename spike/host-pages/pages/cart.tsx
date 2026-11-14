import { RemoteComponent } from '../lib/RemoteComponent';

export default function Cart() {
  return (
    <main>
      <h1>Cart (Mode A)</h1>
      <RemoteComponent
        module="./CartButton"
        props={{ count: 3 }}
        fallback={<span>loading cart</span>}
      />
    </main>
  );
}
