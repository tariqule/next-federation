# NF-002: Invalid federation configuration

## What happened

The object passed to `defineFederation()` or `withNextFederation()` failed validation.

## Why

A required field is missing, has the wrong type, or two fields contradict each other. The error detail names the offending path.

## How to fix

Fix the field named in the message. Configuration is validated at startup so a bad value never reaches production traffic.
