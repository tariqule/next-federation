# NF-001: Unknown remote

## What happened

A host asked for a remote name that is not declared in `defineFederation()`.

## Why

Remotes are resolved by name from the federation config. A typo, a missing entry, or a config that was not loaded on this side of the build produces an unknown name.

## How to fix

Check the remote name against the `remotes` map passed to `defineFederation()`, and make sure the config module is the one the host actually imports.
