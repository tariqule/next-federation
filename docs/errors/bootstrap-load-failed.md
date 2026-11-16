# NF-011: Island bootstrap failed to load

## What happened

The browser could not load the island's client bootstrap script.

## Why

The script URL returned an error, was blocked by a Content Security Policy, or the network dropped.

## How to fix

Open the bootstrap URL from the envelope in the browser. Allow the remote's origin in `script-src` and make sure the build is still deployed.
