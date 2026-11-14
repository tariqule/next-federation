import { useState } from 'react';

// Mode A remote component: rendered inside the HOST's React tree (design §6 Mode A).
export default function CartButton({
  count = 0,
  onOpen,
}: {
  count?: number;
  onOpen?: () => void;
}) {
  const [opened, setOpened] = useState(0); // a hook: fails loudly if host and remote React differ
  return (
    <button
      data-testid="mode-a-cart"
      onClick={() => {
        setOpened((n) => n + 1);
        onOpen?.();
      }}
    >
      Cart ({count}) opened {opened}
    </button>
  );
}
