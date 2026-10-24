import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Trip } from '../lib/types';
import Modal from './Modal';

interface SettingsModalProps {
  open: boolean;
  trip: Trip | null;
  onClose: () => void;
}

export default function SettingsModal({ open, trip, onClose }: SettingsModalProps) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trip) return;
    setName(trip.name);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
  }, [trip]);

  if (!trip) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (startDate > endDate) {
      setError('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }
    setSaving(true);
    try {
      await api.updateTripSettings(trip.id, {
        name: name.trim() || trip.name,
        startDate,
        endDate,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajustes del viaje"
      size="sm"
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
            form="settings-form"
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <form id="settings-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="settings-name" className="mb-1 block text-sm font-medium text-slate-700">
            Nombre del viaje
          </label>
          <input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="settings-start" className="mb-1 block text-sm font-medium text-slate-700">
              Inicio
            </label>
            <input
              id="settings-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="settings-end" className="mb-1 block text-sm font-medium text-slate-700">
              Fin
            </label>
            <input
              id="settings-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
