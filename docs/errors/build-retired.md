# NF-023: Remote build has been retired

## Why This Error Occurred

The envelope refers to a remote build that has been removed. Builds are kept for a retention window and then retired; a page cached longer than that points at a build that no longer exists.

## Possible Ways to Fix It

- Reload the page so it picks up the current build.
- If this happens often, lengthen the remote's build retention. `nf-serve` keeps the newest 3 builds and any build younger than 24 hours:

  ```sh
  nf-serve --max-builds 5 --min-age-hours 48
  ```

## Useful Links

- [Self-hosted build retention](../guides/self-hosted-skew.md)
