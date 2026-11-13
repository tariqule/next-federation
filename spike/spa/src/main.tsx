import { createRoot } from 'react-dom/client'
import { Islands } from './routes/Islands'

const routes: Record<string, () => JSX.Element> = { '/islands': Islands }
const Page = routes[location.pathname] ?? (() => <p>next-federation SPA host</p>)
createRoot(document.getElementById('root')!).render(<Page />)
