import type { Presence } from '../lib/types';

export default function PresenceDots({ presence, currentUserId }: { presence: Presence[]; currentUserId: string | null }) {
  if (presence.length === 0) {
    return <span className="text-xs text-slate-400">Nadie más está conectado</span>;
  }

  const shown = presence.slice(0, 5);
  const extra = presence.length - shown.length;

  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <div key={p.userId} className="relative" title={`${p.displayName} — en línea`}>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white"
            style={{ backgroundColor: p.color }}
          >
            {p.displayName.slice(0, 1).toUpperCase()}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </div>
      ))}
      {extra > 0 && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600 ring-2 ring-white">
          +{extra}
        </div>
      )}
      {currentUserId && presence.some((p) => p.userId === currentUserId) && (
        <span className="ml-2 text-xs text-slate-500">Tú y otros están aquí</span>
      )}
    </div>
  );
}
