import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { TripItem } from '../lib/types';
import Modal from './Modal';

interface ItemEditModalProps {
  open: boolean;
  item: TripItem | null;
  tripId: string;
  onClose: () => void;
}

export default function ItemEditModal({ open, item, tripId, onClose }: ItemEditModalProps) {
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('0');
  const [startTime, setStartTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setCost(String(item.cost));
    setStartTime(item.startTime ?? '');
    setNotes(item.notes ?? '');
  }, [item]);

  if (!item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedCost = Number(cost);
    if (Number.isNaN(parsedCost) || parsedCost < 0) {
      setError('El costo debe ser un número válido.');
      return;
    }
    setSaving(true);
    try {
      await api.updateItem(tripId, item.id, {
        title: title.trim() || item.title,
        startTime: startTime.trim() || null,
        notes: notes.trim() || null,
      });
      if (parsedCost !== item.cost) {
        await api.setItemCost(tripId, item.id, parsedCost);
      }
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
      title="Editar actividad"
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
            form="item-edit-form"
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <form id="item-edit-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="edit-title" className="mb-1 block text-sm font-medium text-slate-700">
            Título
          </label>
          <input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-cost" className="mb-1 block text-sm font-medium text-slate-700">
              Costo (USD)
            </label>
            <input
              id="edit-cost"
              type="number"
              min={0}
              step="0.5"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="edit-time" className="mb-1 block text-sm font-medium text-slate-700">
              Hora (opcional)
            </label>
            <input
              id="edit-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="edit-notes" className="mb-1 block text-sm font-medium text-slate-700">
            Notas
          </label>
          <textarea
            id="edit-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            placeholder="Notas, reservas, tips…"
          />
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
