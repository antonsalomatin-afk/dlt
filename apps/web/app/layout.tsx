import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'ThaiDLT · Your road starts here', description: 'Prepare for your Thai driving theory exam with ThaiDLT.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f5f3eb' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
