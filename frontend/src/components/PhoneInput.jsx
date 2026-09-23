/* Indian mobile number box: "+91" sits fixed in front, so staff type only the 10 digits.
   Anything that is not a digit is dropped, and a pasted "+91 98250 11111" or "098250 11111"
   keeps its last 10 digits. `onChange` gets the bare digits ('' when empty). Numbers saved
   before this box existed ("98250 11111") show as their 10 digits. */
export function tenDigits(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

export default function PhoneInput({
  id,
  value,
  onChange,
  className = 'fake-input',
  wrapClassName = '',
  ariaLabel = 'Mobile number',
  placeholder = '10-digit mobile number',
  invalid = false,
  showCount = true,
  style,
}) {
  const digits = tenDigits(value);
  const partial = digits.length > 0 && digits.length < 10;
  return (
    <div className={`phone-field ${wrapClassName}`} style={style}>
      <div className="phone-row">
        <span className="phone-prefix" aria-hidden="true">
          +91
        </span>
        <input
          id={id}
          className={`${className}${invalid ? ' error' : ''}`}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          value={digits}
          onChange={(e) => onChange(tenDigits(e.target.value))}
        />
      </div>
      {showCount && partial && (
        <p className="phone-count" aria-live="polite">
          {digits.length} of 10 digits
        </p>
      )}
    </div>
  );
}
