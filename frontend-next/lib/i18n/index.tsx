'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { es } from './es';
import { en } from './en';

export type Locale = 'es' | 'en';

export type TranslationKey = keyof typeof es;

export interface I18nContextValue {
  t: <K extends TranslationKey>(key: K, params?: Record<string, string | number>) => string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

// Tipo del traductor (sin acoplar al contexto React), útil para pasar `t`
// como parámetro a helpers fuera de componentes.
export type Translate = I18nContextValue['t'];

const DICTIONARIES: Record<Locale, typeof es> = { es, en };

export function isLocale(value: unknown): value is Locale {
  return value === 'es' || value === 'en';
}

const STORAGE_KEY = 'triplanner.locale.v2';

// The demo defaults to English; Spanish remains available in settings.
function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let output = template;
  for (const [name, value] of Object.entries(params)) {
    output = output.split(`{${name}}`).join(String(value));
  }
  return output;
}

function createTranslator(locale: Locale) {
  const dictionary = DICTIONARIES[locale] ?? en;
  return <K extends TranslationKey>(
    key: K,
    params?: Record<string, string | number>
  ): string => interpolate(dictionary[key] ?? en[key], params);
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage puede no estar disponible; el estado en memoria basta
    }
  }, []);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ t, locale, setLocale }),
    [t, locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n debe usarse dentro de <I18nProvider>');
  return ctx;
}
