# NF-006: Island server and client bundle run different React modes

## What happened

The island was rendered with one React mode (development or production) and hydrates with the other.

## Why

Mixing modes changes internal data structures and causes hydration errors that are hard to trace.

## How to fix

Build and run the remote with the same `NODE_ENV` on server and client, and do not serve a development bootstrap against a production render.
