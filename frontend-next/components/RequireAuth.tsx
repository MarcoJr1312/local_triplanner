'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import VerificationGate from './VerificationGate';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsVerification } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !needsVerification) {
      router.replace('/login');
    }
  }, [loading, user, needsVerification, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600 dark:border-brand-500/30 dark:border-t-brand-400" />
      </div>
    );
  }

  if (needsVerification) {
    return <VerificationGate />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600 dark:border-brand-500/30 dark:border-t-brand-400" />
      </div>
    );
  }

  return <>{children}</>;
}
