type Message = { role: 'user' | 'assistant'; content: string };
type Lesson = { phrase: string; languageCode: string; explanation: string };

export function createTutor() {
  const panel = document.createElement('section');
  panel.className = 'workspace tutor';
  panel.setAttribute('aria-label', 'Language tutor');
  panel.innerHTML = `<div class="toolbar"><label for="language">Practice language</label><select id="language"><option>Spanish</option><option>French</option><option>German</option><option>Italian</option><option>Portuguese</option><option>Japanese</option><option>English</option></select></div><p class="tutor-hint">Pause after speaking to get a translation. Stop the microphone to hear it aloud.</p><div id="lessons" aria-live="polite"></div><form id="ask-form"><label for="question">Or type a phrase or follow-up</label><div class="ask-row"><input id="question" maxlength="4000" placeholder="How do I say good morning?" required/><button>Ask tutor</button></div></form>`;
  document.querySelector('.privacy')!.before(panel);
  const language = panel.querySelector<HTMLSelectElement>('#language')!;
  const lessons = panel.querySelector<HTMLDivElement>('#lessons')!;
  const form = panel.querySelector<HTMLFormElement>('#ask-form')!;
  const question = panel.querySelector<HTMLInputElement>('#question')!;
  let history: Message[] = [];
  let queue = Promise.resolve();
  let generation = 0;
  let controller: AbortController | undefined;
  let recording = false;
  const playButtons = new Set<HTMLButtonElement>();

  function setRecording(value: boolean) {
    recording = value;
    language.disabled = value;
    playButtons.forEach(button => { button.disabled = value; });
    if (value) window.speechSynthesis?.cancel();
  }

  function clearLessons() {
    generation++;
    controller?.abort();
    queue = Promise.resolve();
    history = [];
    lessons.replaceChildren();
    playButtons.clear();
    window.speechSynthesis?.cancel();
  }
  language.onchange = clearLessons;

  function renderLesson(card: HTMLElement, lesson: Lesson) {
    card.replaceChildren();
    if (lesson.phrase) {
      const phrase = document.createElement('p');
      phrase.className = 'translation';
      phrase.lang = lesson.languageCode;
      phrase.textContent = lesson.phrase;
      card.append(phrase);
    }
    const explanation = document.createElement('p');
    explanation.textContent = lesson.explanation;
    card.append(explanation);
    if (lesson.phrase && 'speechSynthesis' in window) {
      for (const [label, rate] of [['Hear translation', 1], ['Hear slowly', 0.65]] as const) {
        const button = document.createElement('button');
        button.textContent = label;
        button.disabled = recording;
        button.onclick = () => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(lesson.phrase);
          utterance.lang = lesson.languageCode;
          utterance.rate = rate;
          const voice = window.speechSynthesis.getVoices().find(item => item.lang.split('-')[0] === lesson.languageCode.split('-')[0]);
          if (voice) utterance.voice = voice;
          utterance.onerror = () => { explanation.textContent = `${lesson.explanation} Audio playback unavailable. Check your browser’s speech voices.`; };
          window.speechSynthesis.speak(utterance);
        };
        playButtons.add(button);
        card.append(button);
      }
    }
  }

  function requestLesson(text: string) {
    if (!text.trim()) return;
    const expectedGeneration = generation;
    const targetLanguage = language.value;
    const article = document.createElement('article');
    const request = document.createElement('p');
    request.className = 'learner-request';
    request.textContent = text;
    const answer = document.createElement('div');
    answer.textContent = 'Waiting to translate…';
    article.append(request, answer);
    lessons.append(article);
    queue = queue.then(async () => {
      if (expectedGeneration !== generation) return;
      const activeController = new AbortController();
      controller = activeController;
      answer.textContent = 'Translating…';
      try {
        const response = await fetch('/api/tutor', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          signal: activeController.signal,
          body: JSON.stringify({ text, language: targetLanguage, history: history.slice(-12) })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Translation failed.');
        if (expectedGeneration !== generation) return;
        history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(data) });
        history = history.slice(-12);
        renderLesson(answer, data);
      } catch (error) {
        if (expectedGeneration !== generation) return;
        answer.textContent = error instanceof Error ? error.message : 'Translation failed.';
        const retry = document.createElement('button');
        retry.textContent = 'Try again';
        retry.onclick = () => { retry.disabled = true; requestLesson(text); };
        answer.append(retry);
      }
    });
  }
  form.onsubmit = event => {
    event.preventDefault();
    requestLesson(question.value);
    question.value = '';
  };
  return { requestLesson, clearLessons, setRecording };
}
