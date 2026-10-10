(function () {
  const recordButton = document.getElementById('record-button');
  const responseBox = document.getElementById('response-box');
  const targetNode = document.getElementById('guided-target');
  const progressNode = document.getElementById('guide-progress');
  const progressFill = document.getElementById('guide-progress-fill');
  const progressLabel = document.getElementById('guide-progress-label');
  const liveTranscriptNode = document.getElementById('live-transcript');
  const guideLanguageNode = document.getElementById('guide-language');
  const disclaimer = document.querySelector('.voice-demo-disclaimer');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const localeByLanguage = { en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };
  const nameByLanguage = { en: '英语', ja: '日语', zh: '普通话' };

  if (!recordButton || !responseBox || !targetNode) return;

  let recording = false;
  let finishing = false;
  let cancelled = false;
  let finalTranscript = '';
  let sessionFinalTranscript = '';
  let interimTranscript = '';
  let recognition = null;
  let recognitionFatal = false;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let lastAudioBlob = null;
  let audioBlobReady = Promise.resolve(null);
  let resolveAudioBlob = null;
  let lastAudioUrl = '';
  let assessmentRequestId = 0;
  let finalizing = false;
  let maxDurationTimer = 0;
  let finishFallbackTimer = 0;
  let lastReference = '';
  let lastLanguage = '';

  function currentLanguage() {
    return document.querySelector('.language-option.active')?.dataset.language || 'en';
  }

  function referenceSentence() {
    return document.querySelector('#turns .turn.user .bubble')?.textContent?.trim() || targetNode.textContent.trim();
  }

  function speechUnits(value, language) {
    const normalized = String(value || '').normalize('NFKC').toLocaleLowerCase();
    if (language === 'en') return normalized.match(/[a-z0-9]+(?:['’][a-z0-9]+)*/g) || [];
    const compact = normalized.replace(/[\s\p{P}\p{S}]/gu, '');
    if (window.Intl && Intl.Segmenter) {
      return [...new Intl.Segmenter(language === 'ja' ? 'ja' : 'zh', { granularity: 'grapheme' }).segment(compact)].map(item => item.segment);
    }
    return Array.from(compact);
  }

  function alignedTargetIndices(targetUnits, heardUnits) {
    const rows = targetUnits.length + 1;
    const cols = heardUnits.length + 1;
    const table = Array.from({ length: rows }, () => new Uint16Array(cols));
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        table[i][j] = targetUnits[i - 1] === heardUnits[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
    const matched = new Set();
    let i = targetUnits.length;
    let j = heardUnits.length;
    while (i > 0 && j > 0) {
      if (targetUnits[i - 1] === heardUnits[j - 1]) {
        matched.add(i - 1);
        i -= 1;
        j -= 1;
      } else if (table[i - 1][j] >= table[i][j - 1]) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
    return matched;
  }

  function refreshGuide(spokenText) {
    const language = currentLanguage();
    const target = referenceSentence();
    const targetUnits = speechUnits(target, language);
    const heardUnits = speechUnits(spokenText, language);
    const matched = alignedTargetIndices(targetUnits, heardUnits);
    targetNode.lang = localeByLanguage[language];
    targetNode.replaceChildren();
    let unitIndex = 0;
    const parts = language === 'en' ? target.match(/[a-z0-9]+(?:['’][a-z0-9]+)*|[^a-z0-9]+/gi) || [] : Array.from(target);
    parts.forEach(part => {
      const token = language === 'en'
        ? (part.match(/^[a-z0-9]/i) ? part.toLocaleLowerCase() : '')
        : (/\p{L}|\p{N}/u.test(part) ? part : '');
      if (!token) {
        targetNode.appendChild(document.createTextNode(part));
        return;
      }
      const span = document.createElement('span');
      span.textContent = part;
      span.className = matched.has(unitIndex) ? 'guide-token matched' : 'guide-token';
      targetNode.appendChild(span);
      unitIndex += 1;
    });
    const ratio = targetUnits.length ? Math.round((matched.size / targetUnits.length) * 100) : 0;
    progressFill.style.width = ratio + '%';
    progressNode.setAttribute('aria-valuenow', String(ratio));
    const unitLabel = language === 'en' ? '词' : '字';
    progressLabel.textContent = spokenText
      ? `已匹配 ${matched.size}/${targetUnits.length} ${unitLabel} · ${ratio}%`
      : (recording ? '正在等待语音…' : '按住录音开始跟读');
    liveTranscriptNode.textContent = spokenText ? `实时识别：${spokenText}` : '识别文字会在这里实时显示。';
  }

  function setRecordingUi(isRecording) {
    responseBox.classList.toggle('recording', isRecording);
    recordButton.setAttribute('aria-label', isRecording ? '松开结束录音' : '按住开始录音');
    recordButton.setAttribute('aria-pressed', String(isRecording));
    recordButton.innerHTML = isRecording
      ? '<span aria-hidden="true">■</span>'
      : '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }

  function languageName() {
    return nameByLanguage[currentLanguage()] || '英语';
  }

  function syncReference() {
    const language = currentLanguage();
    const target = referenceSentence();
    if ((recording || finishing) && ((lastReference && target !== lastReference) || (lastLanguage && language !== lastLanguage))) {
      recording = false;
      finishing = false;
      stopCapture(true);
      responseBox.dataset.state = 'ready';
      responseBox.classList.remove('recording');
      document.getElementById('processing-state').classList.add('hidden');
      document.getElementById('record-status').textContent = '练习内容已切换';
      document.getElementById('record-sub').textContent = '按住麦克风，照着新的练习句开始。';
      setRecordingUi(false);
    }
    lastReference = target;
    lastLanguage = language;
    targetNode.textContent = target;
    targetNode.lang = localeByLanguage[language];
    guideLanguageNode.textContent = `${languageName()} · 跟读目标`;
    refreshGuide('');
  }

  function liveText() {
    return [finalTranscript, sessionFinalTranscript, interimTranscript].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function showNotice(message) {
    const status = document.getElementById('record-status');
    const sub = document.getElementById('record-sub');
    if (status) status.textContent = message;
    if (sub) sub.textContent = '也可以选择下方的文字回答。';
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function stopTracks() {
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  function clearAudio(discardUrl) {
    audioChunks = [];
    lastAudioBlob = null;
    if (discardUrl && lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);
    if (discardUrl) lastAudioUrl = '';
  }

  function stopCapture(discard) {
    clearTimeout(maxDurationTimer);
    clearTimeout(finishFallbackTimer);
    cancelled = Boolean(discard);
    if (recognition) {
      const activeRecognition = recognition;
      recognition = null;
      try { activeRecognition.abort(); } catch {}
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      const activeRecorder = mediaRecorder;
      mediaRecorder = null;
      if (discard) activeRecorder.onstop = null;
      try { activeRecorder.stop(); } catch {}
    } else {
      mediaRecorder = null;
    }
    if (discard && resolveAudioBlob) {
      resolveAudioBlob(null);
      resolveAudioBlob = null;
    }
    stopTracks();
    if (discard) clearAudio(true);
  }

  function resetUi() {
    recording = false;
    finishing = false;
    finalizing = false;
    assessmentRequestId += 1;
    finalTranscript = '';
    sessionFinalTranscript = '';
    interimTranscript = '';
    recognitionFatal = false;
    stopCapture(true);
    responseBox.dataset.state = 'ready';
    responseBox.classList.remove('recording');
    document.getElementById('processing-state').classList.add('hidden');
    document.getElementById('transcript-panel').classList.add('hidden');
    document.getElementById('voice-feedback').classList.add('hidden');
    document.getElementById('response-actions').classList.remove('hidden');
    document.getElementById('response-prompt-label').textContent = '轮到你回答了';
    document.getElementById('record-status').textContent = '按住麦克风，照着上方句子练习';
    document.getElementById('record-sub').textContent = '慢慢说，松开按钮后会显示识别结果。';
    document.getElementById('record-clock').textContent = '00:00';
    document.getElementById('record-clock').classList.add('hidden');
    document.getElementById('demo-note').textContent = '实时字幕由浏览器语音服务处理；录音结束后会经后端发送 Azure 评分。服务器仅保存文字和分数，不保存音频。';
    document.getElementById('transcript-text').value = '';
    document.getElementById('replay-answer').classList.remove('hidden');
    setRecordingUi(false);
    const scoreReview = document.getElementById('pronunciation-score');
    const scoreFeedback = document.getElementById('pronunciation-feedback');
    if (scoreReview) scoreReview.classList.add('hidden');
    if (scoreFeedback) scoreFeedback.classList.add('hidden');
    syncReference();
  }

  function makeScoreCard(id) {
    let card = document.getElementById(id);
    if (card) return card;
    card = document.createElement('section');
    card.id = id;
    card.className = 'pronunciation-score hidden';
    const header = document.createElement('div');
    header.className = 'pronunciation-score-head';
    const title = document.createElement('strong');
    title.textContent = '真实发音评分';
    const score = document.createElement('span');
    score.className = 'pronunciation-score-value';
    score.dataset.score = 'value';
    header.append(title, score);
    const detail = document.createElement('p');
    detail.className = 'pronunciation-score-detail';
    detail.dataset.score = 'detail';
    const note = document.createElement('small');
    note.textContent = '评分由 Azure Speech 根据录音生成；录音不保存在 SpeakLoop。';
    const words = document.createElement('div');
    words.className = 'pronunciation-score-words';
    words.dataset.score = 'words';
    card.append(header, detail, words, note);
    const parent = id === 'pronunciation-score' ? document.getElementById('transcript-panel') : document.getElementById('voice-feedback');
    const anchor = id === 'pronunciation-score' ? document.querySelector('.transcript-actions') : document.querySelector('.voice-feedback-actions');
    if (parent) parent.insertBefore(card, anchor || null);
    return card;
  }

  function renderScoreLoading() {
    const review = makeScoreCard('pronunciation-score');
    review.querySelector('[data-score="value"]').textContent = '…';
    review.querySelector('[data-score="detail"]').textContent = '正在请求真实发音评分…';
    review.querySelector('[data-score="words"]').replaceChildren();
    review.classList.remove('hidden');
  }

  function renderScoreError(message) {
    const card = makeScoreCard('pronunciation-score');
    card.querySelector('[data-score="value"]').textContent = '—';
    card.querySelector('[data-score="detail"]').textContent = message;
    card.querySelector('[data-score="words"]').replaceChildren();
    card.classList.remove('hidden');
    document.getElementById('demo-note').textContent = '本次未取得真实评分；录音不保存在 SpeakLoop。';
  }

  function scorePercent(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
  }

  function renderScore(scoreData) {
    const review = makeScoreCard('pronunciation-score');
    const feedback = makeScoreCard('pronunciation-feedback');
    [review, feedback].forEach(card => {
      card.querySelector('[data-score="value"]').textContent = `${Number(scoreData.pronunciation_score).toFixed(1)} / 5`;
      const prosody = Number.isFinite(scoreData.prosody_score)
        ? scorePercent(scoreData.prosody_score)
        : (scoreData.language === 'en' ? '—' : '仅英语提供');
      card.querySelector('[data-score="detail"]').textContent = [
        `准确度 ${scorePercent(scoreData.accuracy_score)}`,
        `流利度 ${scorePercent(scoreData.fluency_score)}`,
        `完整度 ${scorePercent(scoreData.completeness_score)}`,
        `韵律 ${prosody}`
      ].join(' · ');
      const words = card.querySelector('[data-score="words"]');
      words.replaceChildren();
      (scoreData.words || []).forEach(item => {
        const line = document.createElement('p');
        const errorNames = {
          None: '', Mispronunciation: '发音需调整', Omission: '漏读', Insertion: '多读',
          UnexpectedBreak: '停顿过长', MissingBreak: '停顿不足', Monotone: '语调较平'
        };
        const suffix = errorNames[item.error_type] || '';
        const phonemes = (item.phonemes || []).map(part => `${part.phoneme} ${scorePercent(part.score)}`).join(' · ');
        line.textContent = `${item.word || ''}  ${scorePercent(item.score)}${suffix ? ` · ${suffix}` : ''}${phonemes ? `　音素：${phonemes}` : ''}`;
        words.append(line);
      });
      card.classList.remove('hidden');
    });
    document.getElementById('demo-note').textContent = '真实评分完成；账号保存转写和评分明细，不保存录音。';
  }

  async function makePcm16Wav(blob) {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) throw new Error('当前浏览器无法转换语音格式，请使用最新版 Chrome 或 Edge。');
    const context = new AudioContextType();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const sourceRate = decoded.sampleRate;
      const outputLength = Math.ceil(decoded.length * 16000 / sourceRate);
      const pcm = new Int16Array(outputLength);
      const ratio = sourceRate / 16000;
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
      for (let index = 0; index < outputLength; index += 1) {
        const position = index * ratio;
        const left = Math.min(Math.floor(position), decoded.length - 1);
        const right = Math.min(left + 1, decoded.length - 1);
        const blend = position - left;
        let sample = 0;
        channels.forEach(channel => { sample += channel[left] * (1 - blend) + channel[right] * blend; });
        sample /= channels.length;
        const clipped = Math.max(-1, Math.min(1, sample));
        pcm[index] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      }
      const wav = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(wav);
      const writeString = (offset, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
      writeString(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); writeString(8, 'WAVE');
      writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeString(36, 'data');
      view.setUint32(40, pcm.length * 2, true);
      new Int16Array(wav, 44).set(pcm);
      return new Blob([wav], { type: 'audio/wav' });
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function assessRecording(blob, target, language) {
    const requestId = ++assessmentRequestId;
    const sessionId = window.SpeakLoopPracticeAPI?.getCurrentSessionId?.();
    renderScoreLoading();
    try {
      if (!window.SpeakLoopAPI?.request) throw new Error('SpeakLoop 后端尚未连接，请从 FastAPI 服务打开练习页面。');
      const wav = await makePcm16Wav(blob);
      const form = new FormData();
      form.append('audio', wav, 'pronunciation.wav');
      form.append('reference_text', target);
      form.append('language', language);
      if (sessionId) form.append('session_id', sessionId);
      const result = await window.SpeakLoopAPI.request('/speech/assessments', { method: 'POST', body: form });
      if (requestId !== assessmentRequestId) return;
      if (result.recognized_text && !document.getElementById('transcript-text').value.trim()) {
        document.getElementById('transcript-text').value = result.recognized_text;
      }
      renderScore(result);
    } catch (error) {
      if (requestId === assessmentRequestId) renderScoreError(error?.message || '发音评分失败，请重试。');
    }
  }

  function renderReview() {
    if (cancelled) return;
    const transcript = liveText();
    const target = referenceSentence();
    document.getElementById('processing-state').classList.add('hidden');
    document.getElementById('transcript-panel').classList.remove('hidden');
    document.getElementById('voice-feedback').classList.add('hidden');
    document.getElementById('response-actions').classList.add('hidden');
    document.getElementById('response-prompt-label').textContent = '识别完成 · 检查后发送';
    document.getElementById('record-status').textContent = transcript ? '识别完成 · 请检查文字' : '没有识别到清晰语音';
    document.getElementById('record-sub').textContent = transcript ? '可以修改识别文字，再加入对话。' : '请检查麦克风和网络，或改用文字回答。';
    document.getElementById('transcript-text').value = transcript;
    document.getElementById('demo-note').textContent = '正在请求真实评分；录音只用于本次评分，不写入服务器存储。';
    document.getElementById('replay-answer').classList.toggle('hidden', !lastAudioUrl);
    makeScoreCard('pronunciation-score').classList.add('hidden');
    setRecordingUi(false);
    responseBox.dataset.state = 'review';
    document.getElementById('record-clock').classList.add('hidden');
    if (transcript) document.getElementById('transcript-text').focus();
  }

  function finishRecording() {
    if (!recording || finishing) return;
    recording = false;
    finishing = true;
    clearTimeout(maxDurationTimer);
    setRecordingUi(false);
    responseBox.dataset.state = 'processing';
    responseBox.classList.remove('recording');
    document.getElementById('record-status').textContent = '正在整理识别结果…';
    document.getElementById('record-sub').textContent = '马上就好';
    document.getElementById('processing-state').classList.remove('hidden');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
    }
    if (recognition) {
      try { recognition.stop(); } catch { finalizeRecording(); }
      finishFallbackTimer = setTimeout(finalizeRecording, 1800);
    } else {
      finalizeRecording();
    }
  }

  async function finalizeRecording() {
    if (cancelled || !finishing || finalizing) return;
    finalizing = true;
    clearTimeout(finishFallbackTimer);
    if (sessionFinalTranscript) {
      finalTranscript = [finalTranscript, sessionFinalTranscript].filter(Boolean).join(' ');
      sessionFinalTranscript = '';
    }
    interimTranscript = '';
    const target = referenceSentence();
    const language = currentLanguage();
    const audioPromise = audioBlobReady;
    if (mediaStream) stopTracks();
    const blob = await audioPromise;
    if (cancelled) return;
    finishing = false;
    finalizing = false;
    refreshGuide(liveText());
    renderReview();
    if (blob) assessRecording(blob, target, language);
    else renderScoreError('没有拿到录音数据，请检查麦克风权限后重新录制。');
  }

  async function startRecording() {
    if (recording || finishing) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotice('当前页面无法访问麦克风，请通过 http://localhost 或 https 打开。');
      return;
    }

    resetUi();
    recording = true;
    cancelled = false;
    finalTranscript = '';
    sessionFinalTranscript = '';
    interimTranscript = '';
    recognitionFatal = false;
    responseBox.dataset.state = 'recording';
    document.getElementById('response-actions').classList.add('hidden');
    document.getElementById('record-clock').classList.remove('hidden');
    document.getElementById('record-status').textContent = '正在连接麦克风…';
    document.getElementById('record-sub').textContent = '按住按钮，照着上方句子读；松开即可结束。';
    setRecordingUi(true);
    refreshGuide('');

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recording) {
        stopTracks();
        return;
      }
      if (window.MediaRecorder) {
        audioChunks = [];
        lastAudioBlob = null;
        audioBlobReady = new Promise(resolve => { resolveAudioBlob = resolve; });
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        const activeRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
        mediaRecorder = activeRecorder;
        activeRecorder.ondataavailable = event => { if (event.data && event.data.size) audioChunks.push(event.data); };
        activeRecorder.onstop = () => {
          if (cancelled || !audioChunks.length) {
            if (resolveAudioBlob) { resolveAudioBlob(null); resolveAudioBlob = null; }
            return;
          }
          const chunks = audioChunks.slice();
          const type = activeRecorder.mimeType || chunks[0]?.type || 'audio/webm';
          audioChunks = [];
          lastAudioBlob = new Blob(chunks, { type });
          if (lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);
          lastAudioUrl = URL.createObjectURL(lastAudioBlob);
          if (resolveAudioBlob) { resolveAudioBlob(lastAudioBlob); resolveAudioBlob = null; }
          if (!document.getElementById('transcript-panel').classList.contains('hidden')) document.getElementById('replay-answer').classList.remove('hidden');
        };
        activeRecorder.start(250);
      } else {
        audioBlobReady = Promise.resolve(null);
      }

      const language = currentLanguage();
      if (!SpeechRecognition) {
        document.getElementById('record-status').textContent = '正在录制…松开按钮结束';
        document.getElementById('record-sub').textContent = '当前浏览器没有实时字幕；结束后仍会尝试真实发音评分。';
      }
      const currentRecognition = SpeechRecognition ? new SpeechRecognition() : null;
      recognition = currentRecognition;
      if (currentRecognition) {
        currentRecognition.lang = localeByLanguage[language] || 'en-US';
        currentRecognition.continuous = true;
        currentRecognition.interimResults = true;
        currentRecognition.maxAlternatives = 1;
        currentRecognition.onstart = () => {
          if (recording) document.getElementById('record-status').textContent = '正在听你读…松开按钮结束';
        };
        currentRecognition.onresult = event => {
        const currentFinalParts = [];
        const interimParts = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternative = result[0];
          if (!alternative) continue;
          if (result.isFinal) {
            currentFinalParts.push(alternative.transcript.trim());
          } else {
            interimParts.push(alternative.transcript.trim());
          }
        }
        sessionFinalTranscript = currentFinalParts.filter(Boolean).join(' ');
        interimTranscript = interimParts.filter(Boolean).join(' ');
        refreshGuide(liveText());
        };
        currentRecognition.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          recognitionFatal = true;
          document.getElementById('record-status').textContent = '浏览器实时字幕不可用';
          document.getElementById('record-sub').textContent = '录音评分仍可继续；如需实时字幕，请允许浏览器语音识别。';
        } else if (event.error === 'network') {
          recognitionFatal = true;
          document.getElementById('record-status').textContent = '语音识别服务暂不可用';
          document.getElementById('record-sub').textContent = '请检查网络，或改用文字回答。';
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          document.getElementById('record-status').textContent = '语音识别暂时中断';
        }
        };
        currentRecognition.onend = () => {
        if (recognition !== currentRecognition) return;
        if (recording && !finishing && !recognitionFatal) {
          finalTranscript = [finalTranscript, sessionFinalTranscript].filter(Boolean).join(' ');
          sessionFinalTranscript = '';
          interimTranscript = '';
          setTimeout(() => {
            if (recording && recognition === currentRecognition) {
              try { currentRecognition.start(); } catch {}
            }
          }, 180);
          return;
        }
        if (finishing) finalizeRecording();
        };
        currentRecognition.start();
      }
      const clock = document.getElementById('record-clock');
      let seconds = 0;
      clock.textContent = '00:00';
      const clockTimer = setInterval(() => {
        if (!recording) { clearInterval(clockTimer); return; }
        seconds += 1;
        clock.textContent = `00:${String(seconds).padStart(2, '0')}`;
      }, 1000);
      maxDurationTimer = setTimeout(finishRecording, 29000);
      if (disclaimer) disclaimer.textContent = '实时字幕由浏览器语音服务处理；松开后录音会经后端发送 Azure 评分，服务器只保存评分结果和转写。';
    } catch (error) {
      recording = false;
      stopCapture(true);
      setRecordingUi(false);
      responseBox.dataset.state = 'ready';
      responseBox.classList.remove('recording');
      showNotice(error?.name === 'NotAllowedError' ? '请允许浏览器使用麦克风，然后再试一次。' : '无法启动录音，请检查麦克风设置。');
    }
  }

  recordButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  recordButton.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    startRecording();
  });
  document.addEventListener('pointerup', () => { if (recording) finishRecording(); });
  document.addEventListener('pointercancel', () => { if (recording) finishRecording(); });
  recordButton.addEventListener('keydown', event => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      startRecording();
    }
  });
  document.addEventListener('keyup', event => {
    if ((event.key === ' ' || event.key === 'Enter') && recording) finishRecording();
  });

  document.getElementById('retry-record')?.addEventListener('click', resetUi, true);
  document.getElementById('retry-answer')?.addEventListener('click', resetUi, true);
  document.getElementById('next-turn')?.addEventListener('click', resetUi, true);
  document.getElementById('replay-answer')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!lastAudioUrl) {
      if (typeof window.showToast === 'function') window.showToast('这次没有可回听的录音。');
      return;
    }
    const audio = new Audio(lastAudioUrl);
    audio.play().catch(() => { if (typeof window.showToast === 'function') window.showToast('无法播放这段录音。'); });
  }, true);

  const turns = document.getElementById('turns');
  if (turns && window.MutationObserver) new MutationObserver(syncReference).observe(turns, { childList: true, subtree: true, characterData: true });
  document.querySelectorAll('.language-option').forEach(option => option.addEventListener('click', () => setTimeout(syncReference, 0)));
  document.getElementById('send-answer')?.addEventListener('click', () => {
    const feedback = document.getElementById('voice-feedback');
    const scoreCard = document.getElementById('pronunciation-feedback');
    if (feedback && scoreCard) feedback.insertBefore(scoreCard, feedback.querySelector('.voice-feedback-actions'));
  }, true);

  if (disclaimer) disclaimer.textContent = '真实发音评分需要配置 Azure Speech。实时字幕由浏览器语音服务处理；松开后录音经后端发往 Azure，服务器只保存评分结果和转写。';
  document.getElementById('record-status').textContent = '按住麦克风，照着上方句子练习';
  syncReference();
  window.SpeakLoopVoice = Object.freeze({ reset: resetUi });
}());
