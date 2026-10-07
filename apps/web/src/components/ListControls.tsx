import { Search, SlidersHorizontal } from 'lucide-react';
import { Input, Select } from './ui';

export interface ListOption {
  value: string;
  label: string;
}

export interface ListFilter {
  label: string;
  value: string;
  options: ListOption[];
  onChange: (value: string) => void;
}

export function ListControls({
  search,
  onSearch,
  placeholder = 'Search this list…',
  filters = [],
  sortValue,
  sortOptions = [],
  onSort,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  filters?: ListFilter[];
  sortValue?: string;
  sortOptions?: ListOption[];
  onSort?: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
      <div className="relative min-w-[200px] flex-1">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" placeholder={placeholder} value={search} onChange={(event) => onSearch(event.target.value)} />
      </div>
      {filters.map((filter) => (
        <label key={filter.label} className="inline-flex items-center gap-1.5">
          <SlidersHorizontal size={14} className="text-slate-400" />
          <span className="sr-only">{filter.label}</span>
          <Select aria-label={filter.label} className="w-auto min-w-32 py-2" value={filter.value} onChange={(event) => filter.onChange(event.target.value)}>
            {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </label>
      ))}
      {sortOptions.length > 0 && onSort && (
        <label className="inline-flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">Sort</span>
          <Select aria-label="Sort list" className="w-auto min-w-36 py-2" value={sortValue} onChange={(event) => onSort(event.target.value)}>
            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </label>
      )}
    </div>
  );
}

export function compareListValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}
