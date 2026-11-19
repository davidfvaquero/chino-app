/**
 * Account screen — #/extras/account
 *
 * Optional cross-device sync (src/sync/*). Sync is OFF by default: with an
 * empty src/sync/config.js the screen shows only "Sync is not configured" and
 * never makes a network request. With a configured Supabase project it offers
 * email-code sign-in, "Sync now", the last sync time, deleting the server copy
 * and a clear privacy notice.
 *
 * Contract: `titleKey` + `render(container, ctx)` (same shape as every screen).
 * All UI text via t() from src/locales/en.d/account.json.
 *
 * Test hooks: `container.dataset.state` = 'not-configured' | 'signed-out' |
 * 'code-sent' | 'signed-in'.
 */
import { t, subscribe } from '../i18n.js';
import { h, reset } from '../dom.js';
import { createSync } from '../sync/client.js';
import { isConfigured, SYNC_CONFIG } from '../sync/config.js';

export const titleKey = 'account.title';

const STYLE_ID = 'account-style';
const CSS = `
.account { display: flex; flex-direction: column; gap: 0.75rem; }
.account-status { margin: 0; color: var(--fg-soft); }
.account-hint { margin: 0; color: var(--fg-soft); font-size: 0.9rem; }
.account-field { display: flex; flex-direction: column; gap: 0.35rem; margin: 0 0 0.5rem; }
.account-field span { font-size: 0.9rem; color: var(--fg-soft); }
.account-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.account-actions button, .account-send, .account-verify {
  min-height: 2.4rem; padding: 0 0.8rem; border: 1px solid var(--line);
  border-radius: var(--radius); background: var(--bg); color: inherit; font: inherit;
}
.account-actions button[data-danger="true"] { color: #c0392b; border-color: #c0392b; }
.account-message { margin: 0; color: var(--fg-soft); font-size: 0.9rem; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Formats a sync timestamp, or "never" when there is none. */
function formatWhen(ts) {
  return ts ? new Date(ts).toLocaleString() : t('account.never');
}

export function render(container, ctx = {}) {
  ensureStyles(document);
  const sync = createSync();
  let unsubscribe = null;
  let message = '';
  let awaitingCode = false;
  let confirmingDelete = false;
  let email = '';

  const card = (key, ...children) =>
    h('section', { class: 'card' }, h('h2', { text: t(key) }), ...children);
  const hint = (key, params) => h('p', { class: 'account-hint', text: t(key, params) });

  async function paint() {
    reset(container);
    const section = h('section', { class: 'account' });

    if (!isConfigured(SYNC_CONFIG)) {
      container.dataset.state = 'not-configured';
      section.append(
        card(titleKey, h('p', { class: 'account-status', text: t('account.notConfigured') }), hint('account.notConfiguredHint')),
      );
      container.append(section);
      container.focus?.({ preventScroll: true });
      return;
    }

    const session = await sync.getSession();
    if (session?.access_token) {
      container.dataset.state = 'signed-in';
      section.append(
        card(
          titleKey,
          h('p', { class: 'account-status', text: t('account.signedInAs', { email: session.email ?? '' }) }),
          h('p', { class: 'account-hint', text: `${t('account.lastSync')}: ${formatWhen(await sync.lastSync())}` }),
          h('p', { class: 'account-hint', text: t('account.pending', { count: await sync.pending() }) }),
        ),
      );
      section.append(
        h(
          'div',
          { class: 'account-actions' },
          h('button', { type: 'button', class: 'account-sync', text: t('account.syncNow'), onclick: () => run(sync.syncNow(), 'account.syncDone') }),
          h('button', { type: 'button', class: 'account-signout', text: t('account.signOut'), onclick: () => run(sync.signOut()) }),
          h('button', {
            type: 'button',
            class: 'account-delete',
            'data-danger': 'true',
            text: t(confirmingDelete ? 'account.deleteYes' : 'account.deleteData'),
            onclick: async () => {
              if (!confirmingDelete) {
                confirmingDelete = true;
                message = t('account.deleteConfirm');
                await paint();
                return;
              }
              confirmingDelete = false;
              const result = await sync.deleteRemoteData();
              message = result.ok ? t('account.deleted') : t('account.deleteFailed');
              await paint();
            },
          }),
        ),
      );
    } else {
      container.dataset.state = awaitingCode ? 'code-sent' : 'signed-out';
      section.append(signInCards());
    }

    if (message) section.append(h('p', { class: 'account-message', role: 'status', text: message }));
    section.append(card('account.privacyTitle', hint('account.privacy')));
    container.append(section);
    container.focus?.({ preventScroll: true });
  }

  /** Email + "Send code", then the code + "Sign in" once a code was sent. */
  function signInCards() {
    const emailInput = h('input', {
      type: 'email',
      class: 'field account-email',
      name: 'email',
      autocomplete: 'email',
      value: email,
      placeholder: t('account.emailPlaceholder'),
      oninput: (event) => {
        email = event.target.value.trim();
      },
    });
    const emailCard = h(
      'section',
      { class: 'card' },
      h('h2', { text: t('account.emailLabel') }),
      h('label', { class: 'account-field' }, h('span', { text: t('account.emailLabel') }), emailInput),
      h('button', {
        type: 'button',
        class: 'account-send',
        text: t('account.sendCode'),
        onclick: async () => {
          const result = await sync.signInWithOtp(email);
          if (result.ok) {
            awaitingCode = true;
            message = t('account.codeSent');
            await paint();
          }
        },
      }),
    );
    if (!awaitingCode) return emailCard;

    const codeInput = h('input', {
      type: 'text',
      inputmode: 'numeric',
      class: 'field account-code',
      name: 'code',
      autocomplete: 'one-time-code',
      placeholder: t('account.codePlaceholder'),
    });
    const codeCard = h(
      'section',
      { class: 'card' },
      h('h2', { text: t('account.codeLabel') }),
      h('label', { class: 'account-field' }, h('span', { text: t('account.codeLabel') }), codeInput),
      h('button', {
        type: 'button',
        class: 'account-verify',
        text: t('account.verify'),
        onclick: async () => {
          const result = await sync.verifyOtp(email, codeInput.value.trim());
          if (result.ok) {
            awaitingCode = false;
            message = '';
            await paint();
          }
        },
      }),
    );
    return h('div', {}, emailCard, codeCard);
  }

  /** Runs an action, turns its outcome into a message, repaints. */
  async function run(action, successKey) {
    message = '';
    const result = await action;
    if (result.ok) message = successKey ? t(successKey) : '';
    else if (result.reason === 'offline') message = t('account.offline');
    else if (result.reason === 'not-signed-in') message = t('account.signedOut');
    else if (result.reason !== 'not-configured') message = t('account.syncFailed');
    await paint();
  }

  unsubscribe = subscribe(() => paint());
  paint();

  return () => {
    if (unsubscribe) unsubscribe();
  };
}
