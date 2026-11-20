'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AppShell from '@/components/AppShell';
import RequireAuth from '@/components/RequireAuth';
import AccountSettingsCard from '@/components/settings/AccountSettingsCard';
import LlmSettingsCard from '@/components/settings/LlmSettingsCard';
import EmailSettingsCard from '@/components/settings/EmailSettingsCard';
import { useI18n } from '@/lib/i18n';

function SettingsContent() {
  const { t } = useI18n();

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <span className="mono">{t('settings.eyebrow')}</span>
          <h1>{t('settings.pageTitle')}</h1>
          <p>{t('settings.pageSubtitle')}</p>
        </div>
        <Link href="/" className="btn btn-ghost btn-sm">
          <ArrowLeft className="h-4 w-4" />
          {t('settings.backToApp')}
        </Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <AccountSettingsCard />

        <div className="space-y-5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {t('settings.serviceConnections')}
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              {t('settings.serviceConnectionsHint')}
            </p>
          </div>
          <LlmSettingsCard />
          <EmailSettingsCard />
        </div>
      </div>
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsContent />
    </RequireAuth>
  );
}
