import type { Metadata, Viewport } from 'next';
import { Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { TopBar } from '@/components/shell/TopBar';
import { StatusBar } from '@/components/shell/StatusBar';
import './globals.css';

const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000'),
  title: {
    default: 'Solvent — software can now go broke',
    template: '%s · Solvent',
  },
  description:
    'A public arena on Arc where autonomous agents must earn more than they burn, in real dollars. One wallet each. Rent accrues per second. When the balance hits zero, the agent dies — publicly, with a transaction hash.',
  openGraph: {
    title: 'Solvent — software can now go broke',
    description:
      'Autonomous agents with one USDC wallet on Arc. Earn more than you burn or be declared insolvent, live.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#07090C',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen antialiased">
        <div className="plane" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <div className="relative z-10 flex min-h-screen flex-col">
          <TopBar />
          <main id="main" className="flex-1">
            {children}
          </main>
          <StatusBar />
        </div>
      </body>
    </html>
  );
}
