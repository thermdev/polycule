import { useEffect, useRef, useState } from 'react';

export function Button({ children, variant = 'default', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant}`} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint ? <em className="field-hint">{hint}</em> : null}
      </span>
      {children}
    </label>
  );
}

export function ColorField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <div className="color-row">
        <input
          type="color"
          value={value || '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="text"
          className="color-text"
          value={value || ''}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Field>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format }) {
  return (
    <Field label={label} hint={format ? format(value) : value?.toFixed?.(2) ?? value}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A file picker styled as a button, with pending + error states handled. */
export function ImagePicker({ label, onPick, accept = 'image/*' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-default"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={handleChange}
      />
      {error ? <p className="inline-error">{error}</p> : null}
    </>
  );
}

/** Text input that commits on blur/Enter, so typing does not thrash the scene. */
export function DebouncedInput({ value, onCommit, ...props }) {
  const [draft, setDraft] = useState(value);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    dirtyRef.current = false;
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      {...props}
      value={draft ?? ''}
      onChange={(event) => {
        dirtyRef.current = true;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          dirtyRef.current = false;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
