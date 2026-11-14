'use client';

import { useState } from 'react';
import { ChevronRight, Search, Star } from 'lucide-react';
import { searchLocations } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Location } from '@/lib/types';
import AppShell from '@/components/AppShell';
import RequireAuth from '@/components/RequireAuth';
import SearchLocationModal from '@/components/SearchLocationModal';

function categoryClass(category: string): string {
  if (category === 'food') return 'badge-food';
  if (category === 'activity') return 'badge-activity';
  if (category === 'nightlife') return 'badge-night';
  return 'badge-sight';
}

function SearchContent() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Location | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      setResults(await searchLocations(term));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const categoryLabel = (category: string) =>
    category === 'food'
      ? t('categories.food')
      : category === 'activity'
        ? t('categories.activity')
        : category === 'nightlife'
          ? t('categories.nightlife')
          : t('categories.sight');

  return (
    <AppShell>
      <div className="search-hero">
        <span className="mono">{t('premium.explore')}</span>
        <h1>{t('premium.search.title')}</h1>
        <p>{t('premium.search.subtitle')}</p>
        <form className="search-bar" onSubmit={onSubmit}>
          <Search className="icon" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('premium.search.placeholder')}
            autoComplete="off"
          />
          <kbd>↵</kbd>
        </form>
      </div>

      {error && (
        <p style={{ textAlign: 'center', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </p>
      )}

      <div className="results">
        {results.map((loc) => (
          <div
            className="result result-button"
            key={loc.id}
            role="button"
            tabIndex={0}
            aria-label={`${t('search.viewDetails')}: ${loc.name}`}
            onClick={() => setSelected(loc)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelected(loc);
              }
            }}
          >
            <div
              className={`result-thumb${loc.category === 'food' ? ' food' : loc.category === 'nightlife' ? ' night' : ''}`}
              style={
                loc.imageUrl
                  ? {
                      backgroundImage: `url(${loc.imageUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              {!loc.imageUrl && <span>{loc.name.trim().charAt(0).toUpperCase()}</span>}
            </div>
            <div className="result-main">
              <strong>
                {loc.name}{' '}
                <span className={`badge ${categoryClass(loc.category)}`}>
                  {categoryLabel(loc.category)}
                </span>
              </strong>
              <p>{loc.description ?? loc.address ?? ''}</p>
            </div>
            <div className="result-meta">
              <span className="result-rating">
                <Star /> {loc.rating != null ? loc.rating.toFixed(1) : '—'}
              </span>
              <span className="result-price">{loc.cost != null ? formatMoney(loc.cost) : ''}</span>
              <ChevronRight className="result-chevron" aria-hidden="true" />
            </div>
          </div>
        ))}
        {!loading && searched && results.length === 0 && !error && (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 32 }}>
            {t('premium.search.empty')}
          </p>
        )}
        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 32 }}>
            {t('common.loading')}
          </p>
        )}
      </div>
      <SearchLocationModal location={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}

export default function SearchPage() {
  return (
    <RequireAuth>
      <SearchContent />
    </RequireAuth>
  );
}
