import React from 'react';
import { LANGUAGE_OPTIONS } from './languageOptions';

interface LanguageSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  required?: boolean;
}

export const LanguageSelect: React.FC<LanguageSelectProps> = ({
  value,
  onChange,
  className = 'field-input',
  id,
  required = false,
}) => {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      required={required}
    >
      {LANGUAGE_OPTIONS.map((language) => (
        <option key={language.value} value={language.value}>
          {language.label}
        </option>
      ))}
    </select>
  );
};
