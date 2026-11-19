import { useState } from 'react'
import { Button } from 'example-design-system'

/**
 * The search box. `action` is the host's search page URL: before hydration
 * (or without JavaScript) the form submits there. After hydration it calls
 * the host's `onSearch`, which navigates with the host's router.
 */
export default function SearchBox({
  action,
  onSearch,
  initial = '',
  label = 'Search',
}: {
  action: string
  onSearch?: (query: string) => void
  initial?: string
  label?: string
}) {
  const [query, setQuery] = useState(initial)
  return (
    <form
      role="search"
      action={action}
      method="get"
      className="header-search"
      onSubmit={(event) => {
        if (!onSearch) return
        event.preventDefault()
        onSearch(query.trim())
      }}
    >
      <input
        name="q"
        type="search"
        aria-label={label}
        placeholder={label}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />{' '}
      <Button type="submit" tone="quiet">
        {label}
      </Button>
    </form>
  )
}
