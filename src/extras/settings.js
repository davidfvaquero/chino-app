/**
 * Settings screen — #/extras/settings
 * Theme (auto/light/dark), font size (3 steps), tone colors on/off with preview,
 * daily goal (10/20/30/50), language selector.
 *
 * Contract: titleKey + render(container, ctx)
 * All UI text via t() from src/locales/en.d/settings.json
 */

import { t, getLocale, setLocale, availableLocales, localeLabel, subscribe } from '../i18n.js';
import { getSettings, setSetting, applySettings, DEFAULTS } from '../settings.js';
import storage from '../storage.js';
import { isToneColorsOn } from '../tone.js';
import { h, reset } from '../dom.js';

export const titleKey = 'hubs.extras.settings';

const THEME_OPTIONS = [
  { value: 'auto', labelKey: 'settings.theme.auto' },
  { value: 'light', labelKey: 'settings.theme.light' },
  { value: 'dark', labelKey: 'settings.theme.dark' },
];

const FONT_SCALE_OPTIONS = [
  { value: 1, labelKey: 'settings.fontScale.small' },
  { value: 1.15, labelKey: 'settings.fontScale.medium' },
  { value: 1.3, labelKey: 'settings.fontScale.large' },
];

const DAILY_GOAL_OPTIONS = [10, 20, 30, 50];

export async function render(container, ctx) {
  let unsubLocale = null;
  let unsubSettings = null;

  async function renderSettings() {
    const settings = await getSettings();
    const currentLocale = getLocale();
    const locales = availableLocales();

    reset(container);

    // Header
    const header = h('header', { class: 'app-header' }, t(titleKey));
    container.append(header);

    const main = h('main', { class: 'screen' });

    // Theme
    main.append(renderThemeSection(settings.theme));

    // Font scale
    main.append(renderFontScaleSection(settings.fontScale));

    // Tone colors with preview
    main.append(await renderToneColorsSection());

    // Pinyin shown or hidden everywhere (quick toggle lives in screen headers)
    main.append(renderPinyinSection(settings.pinyin));

    // Daily goal
    main.append(renderDailyGoalSection(settings.dailyGoal));

    // Language selector
    main.append(renderLanguageSelector(currentLocale, locales));

    // Licences and credits (the "about" group lives here)
    main.append(renderCreditsSection());

    container.append(main);
    container.focus({ preventScroll: true });
  }

  function renderThemeSection(current) {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { text: t('settings.theme.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.theme.hint') }));

    const select = h('select', {
      class: 'field',
      value: current,
      onchange: async (e) => {
        await setSetting('theme', e.target.value);
        applySettings();
      },
    }, ...THEME_OPTIONS.map((opt) =>
      h('option', { value: opt.value, selected: opt.value === current }, t(opt.labelKey))
    ));

    section.append(select);
    return section;
  }

  function renderFontScaleSection(current) {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { text: t('settings.fontScale.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.fontScale.hint') }));

    const select = h('select', {
      class: 'field',
      value: String(current),
      onchange: async (e) => {
        const val = Number(e.target.value);
        await setSetting('fontScale', val);
        applySettings();
      },
    }, ...FONT_SCALE_OPTIONS.map((opt) =>
      h('option', { value: String(opt.value), selected: opt.value === current }, t(opt.labelKey))
    ));

    section.append(select);
    return section;
  }

  async function renderToneColorsSection() {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { id: 'settings-toneColors-title', text: t('settings.toneColors.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.toneColors.hint') }));

    const current = isToneColorsOn();

    const toggle = h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(current),
      'aria-labelledby': 'settings-toneColors-title',
      text: `${t('settings.toneColors.title')}: ${t(current ? 'settings.toneColors.on' : 'settings.toneColors.off')}`,
      onclick: async () => {
        await setSetting('toneColors', !current);
        renderSettings(); // re-render to update preview
      },
    });
    section.append(toggle);

    // Preview
    const preview = h('div', { class: 'settings-preview py-keep' });
    preview.append(h('p', { class: 'settings-preview-label', text: t('settings.toneColors.previewLabel') }));
    preview.append(h('p', { class: 'settings-preview-pinyin', html: await import('../tone.js').then(m => m.pinyinHtml('nǐ hǎo wǒ men')) }));
    preview.append(h('p', { class: 'settings-preview-pinyin', html: await import('../tone.js').then(m => m.pinyinHtml('zhōng guó rén')) }));
    section.append(preview);

    return section;
  }

  function renderPinyinSection(current) {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { id: 'settings-pinyin-title', text: t('settings.pinyin.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.pinyin.hint') }));
    section.append(h('button', {
      type: 'button',
      class: 'chip',
      'data-action': 'settings-pinyin',
      'aria-pressed': String(current),
      'aria-labelledby': 'settings-pinyin-title',
      text: `${t('settings.pinyin.title')}: ${t(current ? 'settings.pinyin.on' : 'settings.pinyin.off')}`,
      onclick: () => setSetting('pinyin', !current),
    }));
    return section;
  }

  function renderDailyGoalSection(current) {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { text: t('settings.dailyGoal.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.dailyGoal.hint') }));

    const select = h('select', {
      class: 'field',
      value: String(current),
      onchange: async (e) => {
        await setSetting('dailyGoal', Number(e.target.value));
      },
    }, ...DAILY_GOAL_OPTIONS.map((val) =>
      h('option', { value: String(val), selected: val === current }, t('settings.dailyGoal.option', { count: val }))
    ));

    section.append(select);
    return section;
  }

  function renderCreditsSection() {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { text: t('settings.credits.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.credits.dictEs') }));
    // CC BY-SA 4.0 §3(a): attribution, changes and the licence URI, linked.
    const link = (href, label) =>
      h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: t(`settings.credits.${label}`) });
    section.append(h('p', { class: 'settings-hint' },
      link('https://creativecommons.org/licenses/by-sa/4.0/', 'licenceName'),
      ' · ',
      link('https://www.mdbg.net/chinese/dictionary?page=cc-cedict', 'sourceName'),
      ' · ',
      link('data/es/dict/LICENSE.md', 'licenceFile')));
    return section;
  }

  function renderLanguageSelector(currentLocale, locales) {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { text: t('settings.language.title') }));
    section.append(h('p', { class: 'settings-hint', text: t('settings.language.hint') }));

    const currentLabel = localeLabel(currentLocale);
    section.append(h('p', { class: 'settings-current', text: t('settings.language.current', { name: currentLabel }) }));

    const select = h('select', {
      class: 'field',
      value: currentLocale,
      onchange: async (e) => {
        setLocale(e.target.value);
        // main.js restores the locale from storage 'settings'/'locale' on boot.
        await storage.set('settings', 'locale', e.target.value);
      },
    }, ...locales.map((code) =>
      h('option', { value: code, selected: code === currentLocale }, localeLabel(code))
    ));

    section.append(select);
    return section;
  }

  // Subscribe to locale changes
  unsubLocale = subscribe(() => renderSettings());

  // Subscribe to settings changes from other tabs/modules
  if (typeof window !== 'undefined') {
    unsubSettings = () => window.addEventListener('chino:settings_changed', renderSettings);
    window.addEventListener('chino:settings_changed', renderSettings);
  }

  // Initial render
  renderSettings();

  // Cleanup
  return () => {
    if (unsubLocale) unsubLocale();
    if (unsubSettings) window.removeEventListener('chino:settings_changed', renderSettings);
  };
}