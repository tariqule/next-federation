// The build descriptor code lives in @next-federation/server/node, shared
// with `nf-describe` (remotes built by any Module Federation 2.0 bundler), so
// both write exactly the same file.
export {
  collectBrowserAssets,
  collectServerIntegrity,
  createDescriptorFile,
} from '@next-federation/server/node'
