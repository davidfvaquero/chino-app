/**
 * Pronunciation practice — HSK1 fixed list.
 * Uses src/speech.js (listen, compare) and src/audio.js (speak).
 * No UI strings in code: all via t('pronounce.<key>') from src/locales/en.d/pronounce.json.
 * Fires 'chino:speak_done' on a successful match.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { listen, compare, isRecognitionAvailable } from '../speech.js';
import { speak, isTtsAvailable } from '../audio.js';

export const titleKey = 'hubs.extras.pronounce';

/** Short fixed HSK1 list (hanzi only, no punctuation). */
const HSK1_TARGETS = [
  '你好',
  '谢谢',
  '对不起',
  '没关系',
  '再见',
  '我',
  '你',
  '他',
  '她',
  '我们',
  '是',
  '不是',
  '有',
  '没有',
  '好',
  '不好',
  '大',
  '小',
  '多',
  '少',
  '来',
  '去',
  '吃',
  '喝',
  '睡觉',
  '起床',
  '学习',
  '工作',
  '看',
  '听',
  '说',
  '读',
  '写',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function render(container, ctx) {
  reset(container);

  let currentTarget = pickRandom(HSK1_TARGETS);
  let isRecording = false;
  let recognitionSupported = true;
  let permissionDenied = false;

  const card = h('section', { class: 'card' });

  // Header
  card.append(
    h('h2', { text: t(titleKey) }),
  );

  // Target display
  const targetEl = h('div', { class: 'pronounce-target' },
    h('span', { class: 'label', text: t('pronounce.targetLabel') }),
    h('span', { class: 'target-text', text: currentTarget }),
  );
  card.append(targetEl);

  // Feedback area
  const feedbackEl = h('div', { class: 'pronounce-feedback', hidden: true });
  card.append(feedbackEl);

  // Buttons row
  const btnRow = h('div', { class: 'btn-row' });

  const recordBtn = h('button', {
    class: 'btn primary',
    type: 'button',
    text: t('pronounce.recordBtn'),
    onclick: onRecord,
  });
  btnRow.append(recordBtn);

  const playBtn = h('button', {
    class: 'btn secondary',
    type: 'button',
    text: t('pronounce.playModelBtn'),
    onclick: onPlayModel,
    disabled: !isTtsAvailable(),
  });
  btnRow.append(playBtn);

  card.append(btnRow);

  // Degraded mode notice (shown when no support or permission denied)
  const degradedNotice = h('div', {
    class: 'pronounce-degraded',
    hidden: true,
    text: '',
  });
  card.append(degradedNotice);

  container.append(card);
  container.focus({ preventScroll: true });

  async function onRecord() {
    if (isRecording) return;
    isRecording = true;
    recordBtn.disabled = true;
    recordBtn.textContent = t('pronounce.recording');
    feedbackEl.hidden = true;

    try {
      const result = await listen({ lang: 'zh-CN', timeoutMs: 10000 });

      if (!result.ok) {
        handleRecognitionFailure(result.reason);
        return;
      }

      const transcript = result.transcript;
      const { match, score } = compare(currentTarget, transcript);

      if (match) {
        showFeedback('correct', t('pronounce.feedbackCorrect'));
        // Fire event for gamification/stats
        window.dispatchEvent(new CustomEvent('chino:speak_done', {
          detail: { target: currentTarget, transcript, score },
        }));
        // Pick next target after a short delay
        setTimeout(() => {
          currentTarget = pickRandom(HSK1_TARGETS);
          targetEl.querySelector('.target-text').textContent = currentTarget;
        }, 1200);
      } else {
        const heardText = transcript || '—';
        showFeedback('try-again', t('pronounce.feedbackTryAgain'), {
          text: heardText,
        });
      }
    } finally {
      isRecording = false;
      recordBtn.disabled = false;
      recordBtn.textContent = t('pronounce.recordBtn');
    }
  }

  function handleRecognitionFailure(reason) {
    let msgKey = 'pronounce.error';
    if (reason === 'unsupported') {
      recognitionSupported = false;
      msgKey = 'pronounce.noSupport';
    } else if (reason === 'denied') {
      permissionDenied = true;
      msgKey = 'pronounce.permissionDenied';
    } else if (reason === 'no-speech') {
      msgKey = 'pronounce.noSpeech';
    }
    showFeedback('error', t(msgKey));
    updateDegradedNotice();
  }

  async function onPlayModel() {
    await speak(currentTarget, { lang: 'zh-CN', rate: 0.8 });
  }

  function showFeedback(type, mainText, interpolate = {}) {
    feedbackEl.hidden = false;
    feedbackEl.className = `pronounce-feedback ${type}`;
    const detailText = interpolate.text
      ? t('pronounce.feedbackHeard', { text: interpolate.text })
      : '';
    feedbackEl.innerHTML = '';
    feedbackEl.append(
      h('span', { class: 'main', text: mainText }),
      detailText ? h('span', { class: 'detail', text: detailText }) : null,
    );
  }

  function updateDegradedNotice() {
    if (!recognitionSupported || permissionDenied) {
      const key = !recognitionSupported ? 'pronounce.noSupport' : 'pronounce.permissionDenied';
      degradedNotice.hidden = false;
      degradedNotice.textContent = t(key);
      recordBtn.disabled = true;
      recordBtn.hidden = true;
    } else {
      degradedNotice.hidden = true;
      recordBtn.disabled = false;
      recordBtn.hidden = false;
    }
  }

  // Initial degraded state check
  if (!isRecognitionAvailable()) {
    recognitionSupported = false;
    updateDegradedNotice();
  }
}