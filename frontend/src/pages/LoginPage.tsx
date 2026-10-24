import { useState } from 'react';
import { Compass, MapPin, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('marco@demo.com');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await login();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-10 text-white md:flex">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-brand-400/20 blur-3xl" />

          <div className="relative flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/20">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold tracking-tight">Triplanner</span>
          </div>

          <div className="relative space-y-6">
            <h2 className="text-2xl font-bold leading-snug tracking-tight">Planifica viajes en equipo, sin fricción.</h2>
            <ul className="space-y-4 text-sm text-brand-50">
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <MapPin className="h-4 w-4" />
                </span>
                <span className="pt-1.5">Itinerarios día a día con actividades, costos y horarios.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Users className="h-4 w-4" />
                </span>
                <span className="pt-1.5">Colabora con amigos: roles, invitaciones y presencia en tiempo real.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="pt-1.5">Sugerencias de IA para descubrir planes según tu destino.</span>
              </li>
            </ul>
          </div>

          <p className="relative text-xs text-brand-100">Demo 100% local · sin conexión a AWS</p>
        </div>

        <div className="flex flex-col justify-center p-8 sm:p-10">
          <div className="mb-6 flex items-center gap-2 md:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">Triplanner</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bienvenido</h1>
          <p className="mt-1 text-sm text-slate-500">Inicia sesión para ver tus viajes.</p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition duration-150 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
                placeholder="tucorreo@ejemplo.com"
              />
              <p className="mt-1 text-xs text-slate-400">Input decorativo: la demo no valida credenciales.</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {loading ? 'Entrando…' : 'Entrar como Demo'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            Entrarás como <span className="font-medium text-slate-600">Marco Rossi</span> con datos de ejemplo.
          </p>
        </div>
      </div>
    </div>
  );
}
