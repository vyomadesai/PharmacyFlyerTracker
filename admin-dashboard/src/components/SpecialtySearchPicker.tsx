'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SpecialtyOption = {
  RecID: number;
  SpecialityCode: string;
  Description: string;
  source?: 'local' | 'npi' | 'matched';
  taxonomyCodes?: string[];
  npiDescriptions?: string[];
};

type Props = {
  options: SpecialtyOption[];
  onSelect: (option: SpecialtyOption) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
};

function specialtyLabel(option: SpecialtyOption) {
  const code = option.SpecialityCode || '';
  const desc = option.Description || '';
  const base = code && desc && code !== desc ? `${code} — ${desc}` : desc || code || 'Unknown';
  if (option.source === 'matched' && option.taxonomyCodes?.length) {
    return `${base}  ·  ${option.taxonomyCodes.length} NPI taxonom${option.taxonomyCodes.length === 1 ? 'y' : 'ies'}`;
  }
  if (option.source === 'npi') return `${base}  ·  NPI`;
  if (option.source === 'local') return `${base}  ·  local`;
  return base;
}

function matchesQuery(option: SpecialtyOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const code = option.SpecialityCode.toLowerCase();
  const desc = option.Description.toLowerCase();
  const label = specialtyLabel(option).toLowerCase();
  return code.includes(q) || desc.includes(q) || label.includes(q);
}

export default function SpecialtySearchPicker({
  options,
  onSelect,
  disabled = false,
  loading = false,
  placeholder = 'Search local specialties or NPI taxonomy…',
  emptyMessage = 'No specialties available',
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);

  const filtered = useMemo(
    () => options.filter((option) => matchesQuery(option, query)).slice(0, 100),
    [options, query],
  );

  const updateDropdownPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, openUp ? spaceAbove : spaceBelow);

    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      zIndex: 1300,
      maxHeight: Math.max(160, maxHeight),
    });
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.specialty-search-dropdown')) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    const onLayoutChange = () => updateDropdownPosition();
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('scroll', onLayoutChange, true);
    return () => {
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('scroll', onLayoutChange, true);
    };
  }, [open, query, filtered.length, updateDropdownPosition]);

  function pickOption(option: SpecialtyOption) {
    onSelect(option);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !filtered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((index) => (index <= 0 ? filtered.length - 1 : index - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pickOption(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const showDropdown = open && !loading && options.length > 0;
  const inputDisabled = disabled || loading || options.length === 0;

  const dropdown = showDropdown ? (
    <ul
      id={listId}
      className="addr-ac-dropdown specialty-search-dropdown"
      role="listbox"
      style={dropdownStyle}
    >
      {filtered.length === 0 ? (
        <li className="addr-ac-item addr-ac-muted">No specialties match your search.</li>
      ) : (
        filtered.map((option, index) => (
          <li key={option.SpecialityCode || `${option.RecID}-${index}`}>
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`addr-ac-item${index === activeIndex ? ' addr-ac-item-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickOption(option)}
            >
              <span className="addr-ac-primary">{specialtyLabel(option)}</span>
              {option.source === 'matched' && option.npiDescriptions?.length ? (
                <span className="addr-ac-secondary">
                  {option.npiDescriptions.slice(0, 2).join(' · ')}
                  {option.npiDescriptions.length > 2 ? ` +${option.npiDescriptions.length - 2} more` : ''}
                </span>
              ) : null}
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <div className="addr-ac specialty-search-picker" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        disabled={inputDisabled}
        placeholder={
          loading
            ? 'Loading specialties…'
            : options.length
              ? placeholder
              : emptyMessage
        }
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {mounted && dropdown ? createPortal(dropdown, document.body) : null}
      {!loading && options.length > 0 ? (
        <small className="specialty-search-hint">
          {query.trim()
            ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
            : `${options.length} specialties — click and search to filter`}
        </small>
      ) : null}
    </div>
  );
}
