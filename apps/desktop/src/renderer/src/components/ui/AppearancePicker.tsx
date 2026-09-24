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
          <AppearanceControls />
        </Popover>
      )}
    </>
  );
}

export function AppearanceControls({ layout = 'compact' }: { layout?: 'compact' | 'settings' }) {
  const { typography, setTypography } = useTypography();
  const { theme, setTheme } = useTheme();
  const labelClass =
    layout === 'settings' ? 'text-sm font-medium text-text' : 'text-xs text-text-muted';
  const groupClass =
    layout === 'settings'
      ? 'grid items-center gap-3 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)]'
      : 'space-y-1.5';
  return (
    <div className={layout === 'settings' ? 'space-y-6' : 'space-y-3'}>
      <div className={layout === 'settings' ? 'workspace-config-section space-y-3' : 'space-y-1.5'}>
        <p className={layout === 'settings' ? 'workspace-section-heading' : labelClass}>
          Color scheme
        </p>
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
      <div className={layout === 'settings' ? 'workspace-config-section space-y-4' : 'space-y-3'}>
        {layout === 'settings' && <h3 className="workspace-section-heading">Fonts</h3>}
        <div className={groupClass}>
          <p className={labelClass}>Chinese font</p>
          <ChoiceGroup
            label="Chinese font"
            value={typography.cjk}
            onValueChange={(cjk) => setTypography({ ...typography, cjk })}
            options={CJK_FONTS.map((font) => ({ value: font.id, label: font.label }))}
          />
        </div>
        <div className={groupClass}>
          <p className={labelClass}>Western font</p>
          <ChoiceGroup
            label="Western font"
            value={typography.latin}
            onValueChange={(latin) => setTypography({ ...typography, latin })}
            options={LATIN_FONTS.map((font) => ({ value: font.id, label: font.label }))}
          />
        </div>
        <div className={groupClass}>
          <p className={labelClass}>Font size</p>
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
    </div>
  );
}
