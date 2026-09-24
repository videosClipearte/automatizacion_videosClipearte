// src/app/settings/page.tsx
import { redirect } from 'next/navigation';

export default function SettingsRootPage() {
  redirect('/settings/accounts');
}
