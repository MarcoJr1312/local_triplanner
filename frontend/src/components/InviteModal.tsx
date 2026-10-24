import { useState } from 'react';
import { api } from '../lib/api';
import type { MemberRole } from '../lib/types';
import Modal from './Modal';
import { ROLE_LABELS } from './RoleBadge';

interface InviteModalProps {
  open: boolean;
  tripId: string;
  onClose: () => void;
}

export default function InviteModal({ open, tripId, onClose }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<MemberRole>('editor');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !displayName.trim()) {
      setError('Completa nombre y correo.');
      return;
    }
    setSaving(true);
    try {
      await api.inviteMember(tripId, {
        email: email.trim(),
        displayName: displayName.trim(),
        role,
      });
      setDone(true);
      setEmail('');
      setDisplayName('');
      setRole('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo invitar.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDone(false);
    setError(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Invitar miembro"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition duration-150 hover:bg-slate-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {done ? 'Cerrar' : 'Cancelar'}
          </button>
          {!done && (
            <button
              type="submit"
              form="invite-form"
              disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {saving ? 'Invitando…' : 'Invitar'}
            </button>
          )}
        </div>
      }
    >
      {done ? (
        <p className="py-4 text-center text-sm text-emerald-600">Miembro invitado correctamente.</p>
      ) : (
        <form id="invite-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-name" className="mb-1 block text-sm font-medium text-slate-700">
              Nombre
            </label>
            <input
              id="invite-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ej. Ana López"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-slate-700">
              Correo electrónico
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ana@ejemplo.com"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1 block text-sm font-medium text-slate-700">
              Rol
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="editor">{ROLE_LABELS.editor}</option>
              <option value="viewer">{ROLE_LABELS.viewer}</option>
            </select>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
      )}
    </Modal>
  );
}
