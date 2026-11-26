'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { listDays, normalizeDateRange, parseBudgetInput, toIsoDate } from '@/lib/format';
import type { Destination, Trip } from '@/lib/types';
import Modal from './Modal';
import SmartImage from './SmartImage';
import { Skeleton } from '@/components/ui/skeleton';

interface NewTripModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (trip: Trip) => void;
}

const defaultStart = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return toIsoDate(d);
};

const defaultEnd = () => {
  const d = new Date();
  d.setDate(d.getDate() + 18);
  return toIsoDate(d);
};

export default function NewTripModal({ open, onClose, onCreated }: NewTripModalProps) {
  const { t } = useI18n();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loadingDests, setLoadingDests] = useState(false);
  const [destinationId, setDestinationId] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(defaultStart());
  const [endDate, setEndDate] = useState(defaultEnd());
  const [totalBudget, setTotalBudget] = useState('1000');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadingDests(true);
    api
      .listDestinations()
      .then((d) => {
        if (!alive) return;
        setDestinations(d);
        if (d.length > 0) {
          setDestinationId(d[0].slug);
          setName(t('trips.defaultName', { destination: d[0].name }));
        }
      })
      .finally(() => {
        if (alive) setLoadingDests(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const selected = destinations.find((d) => d.slug === destinationId);
  const dayCount = startDate && endDate ? listDays(startDate, endDate).length : 0;

  const handleDestination = (slug: string) => {
    setDestinationId(slug);
    const dest = destinations.find((d) => d.slug === slug);
    if (dest) setName(t('trips.defaultName', { destination: dest.name }));
  };

  const handleStartDate = (value: string) => {
    const next = normalizeDateRange(value, endDate);
    setStartDate(next.start);
    setEndDate(next.end);
  };

  const handleEndDate = (value: string) => {
    if (!value) {
      setEndDate('');
      return;
    }
    setEndDate(startDate && value < startDate ? startDate : value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selected) return;
    if (!startDate || !endDate || startDate > endDate) {
      setError(t('errors.invalidDateRange'));
      return;
    }
    setSaving(true);
    try {
      const trip = await api.createTrip({
        name: name.trim() || t('trips.defaultName', { destination: selected.name }),
        destinationId: selected.slug,
        destinationName: selected.name,
        startDate,
        endDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        totalBudget: parseBudgetInput(totalBudget),
        displayName: 'Marco',
      });
      toast.success(t('trips.createdToast'));
      onCreated(trip);
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('trips.newTitle')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="new-trip-form"
            disabled={saving || !selected}
            className="btn btn-primary btn-sm"
          >
            {saving ? t('trips.creating') : t('trips.create')}
          </button>
        </div>
      }
    >
      <form id="new-trip-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 15 }}>
        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-foreground">{t('trips.destination')}</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {loadingDests
              ? [0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-2">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))
              : destinations.map((d) => (
                  <button
                    type="button"
                    key={d.slug}
                    onClick={() => handleDestination(d.slug)}
                    className={`dest-option flex items-center gap-3${d.slug === destinationId ? ' active' : ''}`}
                  >
                    <SmartImage src={d.imageUrl} alt={d.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" iconClassName="h-4 w-4" />
                    <div className="min-w-0">
                      <strong className="truncate">{d.name}</strong>
                      <span className="truncate">{d.country}</span>
                    </div>
                  </button>
                ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="trip-name">{t('trips.name')}</label>
          <input
            id="trip-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder={t('trips.namePlaceholder')}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="start-date">{t('trips.startDate')}</label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => handleStartDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor="end-date">{t('trips.endDate')}</label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => handleEndDate(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="budget">{t('budget.total')}</label>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-muted">$</span>
            <input
              id="budget"
              type="number"
              min={0}
              step={10}
              value={totalBudget}
              placeholder="0"
              onChange={(e) => setTotalBudget(e.target.value)}
              className="input"
            />
          </div>
          {dayCount > 0 && <p className="text-xs text-muted">{t('trips.daysOfTravel', { n: dayCount })}</p>}
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </form>
    </Modal>
  );
}
