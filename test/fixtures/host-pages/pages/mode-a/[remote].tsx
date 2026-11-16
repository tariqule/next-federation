import { ModeAPage, getModeAProps } from '../../lib/ModeAPage'

// /mode-a/tampered, /unsigned, /redeploy, /down.
export const getServerSideProps = getModeAProps()
export default ModeAPage
