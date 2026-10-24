import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import { AuthProvider } from '@/hooks/useAuth';
import ClientOnly from '@/components/ClientOnly';
import ThemeProvider from '@/components/theme-provider';
import { I18nProvider } from '@/lib/i18n';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Triplanner',
  description: 'Triplanner — planifica viajes en equipo',
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t||t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" translate="no" suppressHydrationWarning>
      <head>
        {/* Evita que el auto-traductor del navegador reescriba el DOM y rompa la hidratacion */}
        <meta name="google" content="notranslate" />
        {/* Anti-flash: aplica el tema guardado antes del primer paint (default: claro) */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <ClientOnly>
                {children}
                <Toaster />
              </ClientOnly>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
