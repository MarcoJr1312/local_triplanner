'use client';

import { ArrowUpDown } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { SORT_MODES, type SortMode } from '@/lib/sorting';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const SORT_KEYS: Record<SortMode, TranslationKey> = {
  manual: 'sort.manual',
  'time-asc': 'sort.timeAsc',
  'time-desc': 'sort.timeDesc',
  'price-asc': 'sort.priceAsc',
  'price-desc': 'sort.priceDesc',
};

interface SortSelectorProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

// Selector compacto del orden de la lista del día. Usa un DropdownMenu de
// Radix (RadioGroup) para que la opción activa quede marcada y sea accesible
// por teclado; funciona igual en móvil sin ensanchar el encabezado.
export default function SortSelector({ value, onChange }: SortSelectorProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('sort.by')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition duration-150 max-sm:min-h-11 hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ArrowUpDown className="h-4 w-4 shrink-0" />
          {t('sort.by')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('sort.by')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as SortMode)}>
          {SORT_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {t(SORT_KEYS[mode])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
