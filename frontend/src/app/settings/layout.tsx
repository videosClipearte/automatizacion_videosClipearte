'use client';
// src/app/settings/layout.tsx
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Users, Zap, Clock, Megaphone, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const SETTINGS_TABS = [
  {
    href: '/settings/accounts',
    label: 'Cuentas de Redes',
    description: 'Instagram, TikTok, FB',
    icon: Users,
  },
  {
    href: '/settings/integrations',
    label: 'Integraciones y APIs',
    description: 'Gemini, Drive, Telegram',
    icon: Zap,
  },
  {
    href: '/settings/alerts',
    label: 'Avisos e Intervalos',
    description: 'Frecuencia Telegram & Tolerancia',
    icon: Clock,
  },
  {
    href: '/settings/campaigns',
    label: 'Campañas y Reglas IA',
    description: 'Prompts y tarifas RPM',
    icon: Megaphone,
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full">
      {/* Settings Navigation Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Panel de Control
          </span>
          <span className="text-xs text-[var(--text-muted)] hidden sm:inline">• Configuración Global del Sistema</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Configuración del Sistema</h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
          Administra credenciales de APIs, cuentas de publicación, intervalos de alertas automáticas y reglas de IA.
        </p>

        {/* Tab Navigation */}
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2 p-1.5 glass rounded-2xl border border-[var(--border)]">
          {SETTINGS_TABS.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            const Icon = tab.icon;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'relative flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 text-sm font-medium',
                  isActive
                    ? 'text-white shadow-lg bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30'
                    : 'text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.04]'
                )}
              >
                <Icon
                  size={16}
                  className={cn(
                    'transition-colors shrink-0',
                    isActive ? 'text-emerald-400' : 'text-[var(--text-muted)]'
                  )}
                />
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-xs leading-none">{tab.label}</span>
                  <span className="text-[10px] text-[var(--text-muted)] mt-1 hidden sm:inline">
                    {tab.description}
                  </span>
                </div>

                {isActive && (
                  <motion.div
                    layoutId="active-settings-tab"
                    className="absolute inset-0 rounded-xl bg-white/[0.03] pointer-events-none"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Settings Content */}
      <div className="mt-4">
        {children}
      </div>
    </div>
  );
}
