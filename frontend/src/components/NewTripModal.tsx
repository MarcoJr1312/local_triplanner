import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { listDays, toIsoDate } from '../lib/format';
import type { Destination } from '../lib/types';
import Modal from './Modal';
import SmartImage from './SmartImage';

interface NewTripModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (tripId: string) => void;
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
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(defaultStart());
  const [endDate, setEndDate] = useState(defaultEnd());
  const [totalBudget, setTotalBudget] = useState(1000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.listDestinations().then((d) => {
      if (!alive) return;
      setDestinations(d);
      if (d.length > 0) {
        setDestinationId(d[0].slug);
        setName(`${d[0].name} — Mi viaje`);
      }
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
    if (dest) setName(`${dest.name} — Mi viaje`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selected) return;
    if (startDate > endDate) {
      setError('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }
    setSaving(true);
    try {
      const trip = await api.createTrip({
        name: name.trim() || `${selected.name} — Mi viaje`,
        destinationId: selected.slug,
        destinationName: selected.name,
        startDate,
        endDate,
        totalBudget,
        displayName: 'Marco',
      });
      onCreated(trip.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el viaje.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo viaje"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition duration-150 hover:bg-slate-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="new-trip-form"
            disabled={saving || !selected}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {saving ? 'Creando…' : 'Crear viaje'}
          </button>
        </div>
      }
    >
      <form id="new-trip-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Destino</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {destinations.map((d) => (
              <button
                type="button"
                key={d.slug}
                onClick={() => handleDestination(d.slug)}
                className={`flex items-center gap-3 rounded-xl border p-2 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                  d.slug === destinationId
                    ? 'border-brand-500 ring-2 ring-brand-100'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <SmartImage src={d.imageUrl} alt={d.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" iconClassName="h-4 w-4" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{d.name}</p>
                  <p className="truncate text-xs text-slate-400">{d.country}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="trip-name" className="mb-1 block text-sm font-medium text-slate-700">
            Nombre del viaje
          </label>
          <input
            id="trip-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            placeholder="Nombre del viaje"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="start-date" className="mb-1 block text-sm font-medium text-slate-700">
              Inicio
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="mb-1 block text-sm font-medium text-slate-700">
              Fin
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="budget" className="mb-1 block text-sm font-medium text-slate-700">
            Presupuesto total
          </label>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-400">$</span>
            <input
              id="budget"
              type="number"
              min={0}
              step={10}
              value={totalBudget}
              onChange={(e) => setTotalBudget(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          {dayCount > 0 && <p className="mt-1 text-xs text-slate-400">{dayCount} días de viaje.</p>}
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
