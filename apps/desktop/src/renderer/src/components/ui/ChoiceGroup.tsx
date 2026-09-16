import { useId, type ReactNode } from 'react';
import { Radio } from './Checkbox';
import { cx } from './cx';

export interface ChoiceOption<Value extends string> {
  value: Value;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function ChoiceGroup<Value extends string>({
  label,
  value,
  onValueChange,
  options,
  variant = 'segmented',
  disabled,
  name,
  className,
}: {
  label: string;
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly ChoiceOption<Value>[];
  variant?: 'segmented' | 'cards';
  disabled?: boolean;
  name?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset
      disabled={disabled}
      className={cx('ui-choice-group', className)}
      data-variant={variant}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="ui-choice">
          <Radio
            name={name ?? id}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onValueChange(option.value)}
            aria-label={typeof option.label === 'string' ? option.label : undefined}
            className="sr-only"
          />
          <span className="ui-choice-content">
            <span className="block font-semibold">{option.label}</span>
            {option.description && (
              <span className="block text-[10px] opacity-70">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
