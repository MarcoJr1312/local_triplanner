import { categoryMeta } from '../lib/categories';

export default function CategoryBadge({ category, size = 'sm' }: { category: string; size?: 'sm' | 'xs' }) {
  const meta = categoryMeta(category);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${meta.badge} ${
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
