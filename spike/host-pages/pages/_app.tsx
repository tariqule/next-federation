import type { AppProps } from 'next/app';
import Link from 'next/link';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <nav>
        <Link href="/">home</Link> | <Link href="/static">static</Link> |{' '}
        <Link href="/nav/one">nav</Link>
      </nav>
      <Component {...pageProps} />
    </>
  );
}
