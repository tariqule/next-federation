import { createRoot } from 'react-dom/client';
import { Inject } from './routes/Inject';
import { Islands } from './routes/Islands';
import { Skew } from './routes/Skew';

const routes: Record<string, () => JSX.Element> = {
  '/islands': Islands,
  '/inject': Inject,
  '/skew': Skew,
};
const Page =
  routes[location.pathname] ?? (() => <p>next-federation SPA host</p>);
createRoot(document.getElementById('root')!).render(<Page />);
