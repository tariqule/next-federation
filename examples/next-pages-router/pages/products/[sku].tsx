import { ProductPage } from '../../lib/ProductPage'
import { getProductPageProps } from '../../lib/product-props'

export const getServerSideProps = getProductPageProps()
export default ProductPage
