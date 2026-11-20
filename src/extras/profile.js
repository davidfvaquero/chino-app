/**
 * Profile & progress — streak, points, level, achievements, language selector.
 * Reads only from gamification.getStats() and public/data/achievements.json (via getStats).
 * All UI text via t() from src/locales/en.d/profile.json.
 */
import { t, getLocale, setLocale, availableLocales, localeLabel, subscribe } from '../i18n.js';
import { getStats } from '../gamification.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';

export const titleKey = 'hubs.extras.profile';

export function render(container, ctx) {
  let unsubLocale = null;
  let unsubRoute = null;

  async function renderProfile() {
    const stats = await getStats();
    const locale = getLocale();
    const locales = availableLocales();
    const isBeginner = stats.streak === 0 && stats.achievements.every((a) => !a.unlocked);

    reset(container);

    // Header
    const header = h('header', { class: 'app-header' }, t(titleKey));
    container.append(header);

    const main = h('main', { class: 'screen' });

    if (isBeginner) {
      // Friendly empty state for beginners
      main.append(
        h(
          'section',
          { class: 'card' },
          h('h2', { text: t('profileScreen.emptyState.title') }),
          h('p', { text: t('profileScreen.emptyState.description') }),
          h(
            'button',
            {
              type: 'button',
              class: 'field',
              onclick: () => ctx?.navigate?.('learn'),
            },
            t('profileScreen.emptyState.startLearning'),
          ),
        ),
      );
    } else {
      // Streak card
      main.append(
        h(
          'section',
          { class: 'card' },
          h('h2', { text: t('profileScreen.streak.current') }),
          h('div', { class: 'streak-display' },
            h('span', { class: 'streak-value', text: formatStreak(stats.streak) }),
            h('span', { class: 'streak-label', text: t('profileScreen.streak.days', { count: stats.streak }) }),
          ),
          h('p', { class: 'streak-best', text: `${t('profileScreen.streak.best')}: ${formatStreak(stats.bestStreak)}` }),
        ),
      );

      // Points & Level card
      main.append(
        h(
          'section',
          { class: 'card' },
          h('div', { class: 'points-level' },
            h('div',
              h('span', { class: 'label', text: t('profileScreen.points') }),
              h('span', { class: 'value', text: String(stats.points) }),
            ),
            h('div',
              h('span', { class: 'label', text: t('profileScreen.level', { level: stats.level }) }),
            ),
          ),
        ),
      );

      // Achievements
      main.append(renderAchievements(stats.achievements));
    }

    // Language selector
    main.append(renderLanguageSelector(locale, locales));

    container.append(main);
    container.focus({ preventScroll: true });
  }

  function formatStreak(n) {
    return String(n);
  }

  function renderAchievements(achievements) {
    const unlocked = achievements.filter((a) => a.unlocked);
    const locked = achievements.filter((a) => !a.unlocked);

    const section = h('section', { class: 'card' });
    const titleRow = h('div', { class: 'achievements-header' },
      h('h2', { text: t('profileScreen.achievements.title') }),
    );
    section.append(titleRow);

    if (unlocked.length > 0) {
      const unlockedSection = h('div', { class: 'achievements-group' },
        h('h3', { class: 'group-title', text: t('profileScreen.achievements.unlocked') }),
        h('div', { class: 'achievements-grid' }, ...unlocked.map(renderAchievementCard)),
      );
      section.append(unlockedSection);
    }

    if (locked.length > 0) {
      const lockedSection = h('div', { class: 'achievements-group' },
        h('h3', { class: 'group-title', text: t('profileScreen.achievements.locked') }),
        h('div', { class: 'achievements-grid' }, ...locked.map(renderAchievementCard)),
      );
      section.append(lockedSection);
    }

    if (unlocked.length === 0 && locked.length === 0) {
      section.append(h('p', { class: 'empty', text: t('profileScreen.achievements.empty') }));
    }

    return section;
  }

  function renderAchievementCard(ach) {
    const name = t(ach.nameKey);
    const desc = t(ach.descKey);
    const unlocked = ach.unlocked;
    const unlockedAt = ach.unlockedAt ? formatDate(ach.unlockedAt) : null;

    return h(
      'div',
      { class: `achievement-card ${unlocked ? 'unlocked' : 'locked'}` },
      h('div', { class: 'achievement-icon' }, unlocked ? '✓' : '🔒'),
      h('div', { class: 'achievement-info' },
        h('span', { class: 'achievement-name', text: name }),
        h('span', { class: 'achievement-desc', text: desc }),
        unlockedAt && h('span', { class: 'achievement-unlocked', text: t('profileScreen.achievements.unlockAt', { date: unlockedAt }) }),
      ),
    );
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function renderLanguageSelector(currentLocale, locales) {
    const section = h('section', { class: 'card' });
    section.append(h('h2', { text: t('profileScreen.language.label') }));
    section.append(h('p', { class: 'language-current', text: t('profileScreen.language.current', { name: localeLabel(currentLocale) }) }));

    const select = h('select', { class: 'field', value: currentLocale, onchange: (e) => { setLocale(e.target.value); storage.set('settings', 'locale', e.target.value); } },
      ...locales.map((code) => h('option', { value: code, selected: code === currentLocale }, localeLabel(code))),
    );
    section.append(select);

    return section;
  }

  // Subscribe to locale changes to re-render
  unsubLocale = subscribe(() => renderProfile());

  // Also re-render on route change (in case of navigation back)
  if (ctx?.route) {
    unsubRoute = () => window.addEventListener('hashchange', renderProfile);
    window.addEventListener('hashchange', renderProfile);
  }

  // Initial render
  renderProfile();

  // Cleanup function
  return () => {
    if (unsubLocale) unsubLocale();
    if (unsubRoute) window.removeEventListener('hashchange', renderProfile);
  };
}