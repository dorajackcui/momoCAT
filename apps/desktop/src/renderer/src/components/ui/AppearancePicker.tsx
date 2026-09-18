import { useId, useRef, useState } from 'react';
import { IconButton } from './IconButton';
import { Popover } from './Popup';
import { ChoiceGroup } from './ChoiceGroup';
import {
  CJK_FONTS,
  LATIN_FONTS,
  CONTENT_FONT_SIZES,
  type TypographyPreference,
} from '../../theme/typography';
import { useTypography } from '../../theme/TypographyProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { COLOR_THEMES } from '../../theme/colorThemes';

export function AppearancePicker({ label = 'Appearance' }: { label?: string }) {
  const { typography, setTypography } = useTypography();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <IconButton
        ref={anchor}
        size="sm"
        tone={open ? 'brand' : 'neutral'}
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
      >
        <span aria-hidden="true">Aa</span>
      </IconButton>
      {open && (
        <Popover
          id={id}
          anchor={anchor}
          label={label}
          onClose={() => setOpen(false)}
          placement="bottom-start"
          className="w-96"
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs text-text-muted">Color scheme</p>
              <ChoiceGroup
                label="Color scheme"
                value={theme}
                onValueChange={setTheme}
                variant="cards"
                options={COLOR_THEMES.map((choice) => ({
                  value: choice.id,
                  label: (
                    <span className="appearance-color-swatch" data-color-theme={choice.id}>
                      {choice.label}
                    </span>
                  ),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-text-muted">Chinese font</p>
              <ChoiceGroup
                label="Chinese font"
                value={typography.cjk}
                onValueChange={(cjk) => setTypography({ ...typography, cjk })}
                options={CJK_FONTS.map((font) => ({ value: font.id, label: font.label }))}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-text-muted">Western font</p>
              <ChoiceGroup
                label="Western font"
                value={typography.latin}
                onValueChange={(latin) => setTypography({ ...typography, latin })}
                options={LATIN_FONTS.map((font) => ({ value: font.id, label: font.label }))}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-text-muted">Font size</p>
              <ChoiceGroup
                label="Font size"
                value={String(typography.fontSize)}
                onValueChange={(size) =>
                  setTypography({
                    ...typography,
                    fontSize: Number(size) as TypographyPreference['fontSize'],
                  })
                }
                options={CONTENT_FONT_SIZES.map((size) => ({
                  value: String(size),
                  label: `${size} px`,
                }))}
              />
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
