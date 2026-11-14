'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Compass, MapPin, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { DEMO_FRIEND_ID, DEMO_USER_ID, localizeApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const { user, loading, signInDemo } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/');
    }
  }, [loading, user, router]);

  if (loading) return null;
  if (user) return null;

  const handleDemo = async (userId: string) => {
    setSubmitting(userId);
    try {
      await signInDemo(userId);
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="login-brand">
          <span className="rail-logo">
            <Compass className="icon" />
          </span>
          <strong>Triplanner</strong>
        </div>

        <div className="login-copy">
          <h1>
            {t('premium.login.headline')} <em>{t('premium.login.headlineAccent')}</em>
          </h1>
          <p>{t('premium.login.lead')}</p>
          <div className="login-features">
            <div className="login-feature">
              <span className="fi">
                <MapPin className="icon-sm" />
              </span>
              <div>
                <strong>{t('premium.login.feature1.title')}</strong>
                <span>{t('premium.login.feature1.body')}</span>
              </div>
            </div>
            <div className="login-feature">
              <span className="fi">
                <Users className="icon-sm" />
              </span>
              <div>
                <strong>{t('premium.login.feature2.title')}</strong>
                <span>{t('premium.login.feature2.body')}</span>
              </div>
            </div>
            <div className="login-feature">
              <span className="fi">
                <Sparkles className="icon-sm" />
              </span>
              <div>
                <strong>{t('premium.login.feature3.title')}</strong>
                <span>{t('premium.login.feature3.body')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-brand login-brand-mobile">
            <span className="rail-logo">
              <Compass className="icon" />
            </span>
            <strong>Triplanner</strong>
          </div>
          <span className="mono">{t('premium.login.eyebrow')}</span>
          <h2>{t('premium.login.title')}</h2>
          <p>{t('premium.login.subtitle')}</p>

          <div className="login-form">
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => handleDemo(DEMO_USER_ID)}
              disabled={submitting !== null}
            >
              {submitting === DEMO_USER_ID ? t('auth.signingIn') : t('auth.demoOwner')}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">{t('auth.demoOwnerHint')}</p>

            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => handleDemo(DEMO_FRIEND_ID)}
              disabled={submitting !== null}
            >
              {submitting === DEMO_FRIEND_ID ? t('auth.signingIn') : t('auth.demoFriend')}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">{t('auth.demoFriendHint')}</p>
          </div>

          <div className="login-foot">
            <Check className="icon-sm" />
            {t('premium.login.note')}
          </div>
        </div>
      </div>
    </div>
  );
}
