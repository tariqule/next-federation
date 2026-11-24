import defaultMdxComponents from 'fumadocs-ui/mdx'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import type { MDXComponents } from 'mdx/types'

// Card, Cards and Callout come from the default set. Every component a docs
// page may use is listed here: an unregistered one fails the build.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, Steps, Step, Tabs, Tab, ...components }
}
