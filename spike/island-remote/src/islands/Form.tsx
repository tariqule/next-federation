'use client';
import { useEffect, useState, type ReactNode } from 'react';

// Island forms are not submittable until hydrated (design §6 "Forms before hydration").
export function Form({
  action,
  children,
}: {
  action: (fd: FormData) => void | Promise<void>;
  children: ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <form action={action}>
      <fieldset
        disabled={!hydrated}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        {children}
      </fieldset>
    </form>
  );
}
