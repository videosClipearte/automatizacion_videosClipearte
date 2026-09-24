// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ScheduleModal } from '@/components/calendar/ScheduleModal';
import { VideoDetailModal } from '@/components/calendar/VideoDetailModal';

export const metadata: Metadata = {
  title: 'AutoPublish · Social Manager',
  description: 'Sistema de automatización, programación y verificación de contenido en redes sociales',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-base)' }}>
              {children}
            </main>
          </div>
        </div>
        <ScheduleModal />
        <VideoDetailModal />
      </body>
    </html>
  );
}
