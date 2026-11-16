# NF-025: Unsupported `@vitejs/plugin-rsc` version

## What happened

The installed `@vitejs/plugin-rsc` is outside the supported range.

## Why

The Vite adapter depends on plugin behaviour that can change between versions.

## How to fix

Install a version inside the range stated in the `@next-federation/vite` peer dependencies.
