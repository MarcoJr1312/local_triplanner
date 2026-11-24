'use client';

import { useState } from 'react';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// Search keywords shared by the English and Spanish UI. The catalogue and the
// agent index are English, so the default chips are English; legacy Spanish
// terms are canonicalized on load.
export const PREDEFINED_INTERESTS = [
  'Cars',
  'Jazz',
  'Nature',
  'Beach',
  'Shopping',
  'Video games',
  'Food',
  'Coffee',
  'Museums',
  'Art',
  'Sports',
  'Hiking',
  'Nightlife',
  'Live music',
  'Photography',
  'History',
] as const;

const LEGACY_SPANISH_INTERESTS: Record<string, string> = {
  carros: 'cars',
  naturaleza: 'nature',
  playa: 'beach',
  compras: 'shopping',
  videojuegos: 'video games',
  comida: 'food',
  café: 'coffee',
  museos: 'museums',
  arte: 'art',
  deportes: 'sports',
  senderismo: 'hiking',
  'vida nocturna': 'nightlife',
  'música en vivo': 'live music',
  fotografía: 'photography',
  historia: 'history',
};

const MAX_INTERESTS = 20;

function normalize(term: string): string {
  return term.trim().toLowerCase();
}

function canonical(term: string): string {
  const value = normalize(term);
  return LEGACY_SPANISH_INTERESTS[value] ?? value;
}

function dedupe(terms: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of terms) {
    const term = canonical(raw);
    if (!term || out.includes(term)) continue;
    out.push(term);
    if (out.length === MAX_INTERESTS) break;
  }
  return out;
}

function labelFor(term: string): string {
  return (
    PREDEFINED_INTERESTS.find((chip) => normalize(chip) === canonical(term)) ?? term
  );
}

interface InterestsPickerProps {
  initial: string[];
  onSave: (terms: string[]) => Promise<void>;
  onClose?: () => void;
  closeLabel?: string;
  title?: string;
  subtitle?: string;
}

export default function InterestsPicker({
  initial,
  onSave,
  onClose,
  closeLabel,
  title,
  subtitle,
}: InterestsPickerProps) {
  const { t } = useI18n();
  const [terms, setTerms] = useState<string[]>(() => dedupe(initial));
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (chip: string) => {
    const term = normalize(chip);
    setTerms((prev) => {
      if (prev.includes(term)) return prev.filter((item) => item !== term);
      if (prev.length >= MAX_INTERESTS) return prev;
      return [...prev, term];
    });
  };

  const addManual = () => {
    const term = normalize(input);
    if (!term) return;
    setTerms((prev) => {
      if (prev.includes(term) || prev.length >= MAX_INTERESTS) return prev;
      return [...prev, term];
    });
    setInput('');
  };

  const handleSave = async () => {
    if (terms.length === 0 || saving) return;
    setSaving(true);
    try {
      await onSave(terms);
      toast.success(t('interests.saved'));
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {(title || subtitle) && (
        <div>
          {title && <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>}
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PREDEFINED_INTERESTS.map((chip) => {
          const term = normalize(chip);
          const active = terms.includes(term);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => toggle(chip)}
              aria-pressed={active}
              className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                active
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-border bg-card text-foreground hover:border-muted-foreground/30 hover:bg-muted/40'
              }`}
            >
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{chip}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addManual();
            }
          }}
          maxLength={40}
          placeholder={t('interests.manualPlaceholder')}
          className="min-h-11 w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-base outline-none transition duration-150 placeholder:text-muted-foreground focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 md:text-sm"
        />
        <button
          type="button"
          onClick={addManual}
          disabled={!input.trim()}
          aria-label={t('interests.add')}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {terms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {terms.map((term) => (
            <span
              key={term}
              className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300"
            >
              {labelFor(term)}
              <button
                type="button"
                onClick={() => toggle(term)}
                aria-label={`${t('common.delete')} ${labelFor(term)}`}
                className="rounded-full p-0.5 transition duration-150 hover:bg-brand-600/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={terms.length === 0 || saving}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
      >
        {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {saving ? t('common.saving') : t('interests.save')}
      </button>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          {closeLabel ?? t('interests.later')}
        </button>
      )}
    </div>
  );
}
