import React from 'react';

const whitespaceClasses = new Map([
  [' ', 'cm-np-space'],
  ['\t', 'cm-np-tab'],
  ['\u00A0', 'cm-np-nbsp'],
  ['\u202F', 'cm-np-nnbsp'],
]);

export function NonPrintingText({ text, enabled }: { text: string; enabled: boolean }) {
  if (!enabled) return <>{text}</>;
  return (
    <>
      {text.split(/([ \t\u00A0\u202F\n])/).map((part, index) => {
        const className = whitespaceClasses.get(part);
        return className ? (
          <span key={index} className={className}>
            {part}
          </span>
        ) : part === '\n' ? (
          <React.Fragment key={index}>
            <span className="cm-np-newline" aria-hidden="true" />
            {'\n'}
          </React.Fragment>
        ) : (
          part
        );
      })}
    </>
  );
}
