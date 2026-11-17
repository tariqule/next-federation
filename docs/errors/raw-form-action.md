# NF-035: Island form uses a raw `action` instead of `<Form>`

## What happened

The island build or dev server warned that a component passes a Server Action to a plain `<form
action={...}>` (or `formAction`).

## Why

Islands have no progressive enhancement: a plain form can submit before the island hydrates, and the
submission would go to the host page instead of the remote. `<Form>` from `@next-federation/island`
keeps the form disabled until the island has hydrated.

## How to fix

Replace `<form action={...}>` with `<Form action={...}>` imported from `@next-federation/island`.
