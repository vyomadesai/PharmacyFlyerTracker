'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../services/api';

export type AddressSuggestion = {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputClassName?: string;
};

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  disabled,
  inputClassName,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const userTypingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const fetchSuggestions = useCallback(async (query: string, signal: AbortSignal) => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<AddressSuggestion[]>('/route-planner/address-suggest', {
        params: { q },
        signal,
      });
      const rows = res.data || [];
      setSuggestions(rows);
      setActiveIndex(-1);
      if (focusedRef.current && userTypingRef.current) {
        setOpen(rows.length > 0);
      }
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disabled || !focusedRef.current || !userTypingRef.current) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchSuggestions(value, controller.signal);
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, disabled, fetchSuggestions]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        focusedRef.current = false;
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pickSuggestion(item: AddressSuggestion) {
    userTypingRef.current = false;
    onChange(item.address);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="addr-ac" ref={rootRef}>
      <input
        type="text"
        className={inputClassName}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          userTypingRef.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              focusedRef.current = false;
              setOpen(false);
            }
          }, 150);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} className="addr-ac-dropdown" role="listbox">
          {loading && suggestions.length === 0 ? (
            <li className="addr-ac-item addr-ac-muted">Searching…</li>
          ) : null}
          {suggestions.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`addr-ac-item${index === activeIndex ? ' addr-ac-item-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSuggestion(item)}
              >
                <span className="addr-ac-primary">{item.address}</span>
                {item.label !== item.address ? (
                  <span className="addr-ac-secondary">{item.label}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
