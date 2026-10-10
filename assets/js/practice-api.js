(function () {
  const api = window.SpeakLoopAPI;
  const languages = { en: '英语', ja: '日语', zh: '普通话' };
  const levels = { beginner: '初级', intermediate: '中级', advanced: '高级' };
  const scenarioKeys = {
    '在咖啡店点单': 'cafe-order', '第一次自我介绍': 'self-introduction', '问路去地铁站': 'ask-directions',
    '面试中的项目介绍': 'project-interview', '酒店预订出了问题': 'hotel-booking', '主持团队周会': 'team-meeting',
    '向客户介绍产品': 'product-presentation', '协调跨部门分歧': 'cross-team-alignment', '谈判项目交付期限': 'delivery-negotiation',
    '第一次和同学打招呼': 'self-introduction', '普通话清晰表达': 'cafe-order',
  };
  let currentUser = null;
  let currentSession = null;
  let sessionStartedAt = Date.now();
  let saveTimer = null;
  let pendingSessionSave = Promise.resolve();
  let passwordBusy = false;

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function text(id) {
    return document.getElementById(id)?.textContent?.trim() || '';
  }

  function scenarioCategory() {
    return document.querySelector('.scenario-top span:last-child')?.textContent?.trim().slice(0, 80) || '情景练习';
  }

  function escapeHTML(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function currentSelection() {
    const selection = window.SpeakLoopPractice?.getSelection();
    if (selection) return selection;
    const languageOption = document.querySelector('.language-option.active');
    const label = text('language-label');
    const language = languageOption?.dataset.language || 'en';
    const level = Object.keys(levels).find(function (key) { return label.includes(levels[key]); }) || 'beginner';
    return { title: text('scenario-title') || '在咖啡店点单', language: language, level: level };
  }

  function scenarioKey(selection) {
    return selection.language + ':' + (scenarioKeys[selection.title] || encodeURIComponent(selection.title).slice(0, 80));
  }

  function snapshotMessages() {
    if (window.SpeakLoopPractice?.getMessages) return window.SpeakLoopPractice.getMessages();
    return [...document.querySelectorAll('#turns .turn')].map(function (turn) {
      return {
        role: turn.querySelector('.turn-name')?.textContent.includes('你的回答') ? 'user' : 'assistant',
        text: turn.querySelector('.bubble')?.textContent?.trim() || '',
        translation: turn.querySelector('.translation')?.textContent?.trim() || null,
      };
    }).filter(function (message) { return message.text; });
  }

  function currentRound() {
    const numbers = text('turn-count').match(/\d+/g) || [];
    return { current_round: Number(numbers[0] || 1), total_rounds: Number(numbers[1] || 4) };
  }

  function sessionPayload(selection) {
    const round = currentRound();
    return {
      scenario_key: scenarioKey(selection),
      scenario_title: selection.title,
      language: selection.language,
      level: selection.level,
      category: scenarioCategory(),
      current_round: round.current_round,
      total_rounds: round.total_rounds,
      duration_seconds: Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000)),
      messages: snapshotMessages(),
    };
  }

  function maskPhone(phone) {
    if (!phone) return '未绑定';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return phone;
    const localStart = phone.startsWith('+86') ? 2 : 0;
    const country = phone.startsWith('+86') ? '+86 ' : '';
    return country + digits.slice(localStart, localStart + 3) + '****' + digits.slice(-2);
  }

  function languageSummary(user) {
    const names = (user.languages || []).map(function (language) { return languages[language] || language; });
    return (names.join('、') || '英语') + ' · 初级';
  }

  function displayUser(user) {
    currentUser = user;
    document.getElementById('account-email').textContent = user.email;
    document.getElementById('current-name').textContent = user.display_name;
    document.getElementById('profile-name').value = user.display_name;
    document.getElementById('profile-language').textContent = languageSummary(user);
    document.getElementById('account-phone').textContent = maskPhone(user.phone);
    const genderMap = { female: '女', male: '男', other: '其他' };
    document.getElementById('profile-gender').value = genderMap[user.gender] || '';
    const regionSelect = document.getElementById('profile-region');
    if (![...regionSelect.options].some(function (option) { return option.value === user.region; })) {
      const option = new Option(user.region, user.region);
      regionSelect.add(option);
    }
    regionSelect.value = user.region || '中国大陆';
    const initial = user.display_name.slice(0, 1);
    const setAvatar = function (element, avatarURL) {
      element.textContent = '';
      if (avatarURL) {
        const image = document.createElement('img');
        image.src = avatarURL;
        image.alt = '';
        element.appendChild(image);
      } else {
        element.textContent = initial;
      }
    };
    setAvatar(document.getElementById('current-avatar'), user.avatar_url);
    setAvatar(document.getElementById('avatar-preview'), user.avatar_url);
    const font = document.getElementById('font-range');
    font.value = String(user.font_size || 14);
    font.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function cardDate(value) {
    const date = new Date(value.endsWith('Z') ? value : value + 'Z');
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function addFavoriteCard(item) {
    const grid = document.getElementById('favorites-grid');
    const languageName = item.language === 'zh' ? '中文' : languages[item.language];
    const roundText = item.status === 'completed' ? '已完成' : '收藏时进行到第 ' + item.current_round + ' 轮';
    const card = document.createElement('article');
    card.className = 'favorite-card';
    card.dataset.language = item.language;
    card.dataset.currentSnapshot = 'true';
    card.dataset.scene = item.scenario_title;
    card.dataset.favoriteId = item.id;
    const snapshotLines = (item.messages || []).map(function (message) {
      const userMessage = message.role === 'user';
      const speaker = userMessage ? '你' : (item.language === 'ja' ? '相' : item.language === 'zh' ? '练' : '店');
      return '<div class="snapshot-line ' + (userMessage ? 'user' : '') + '"><i>' + speaker + '</i><span>' + escapeHTML(message.text) + '</span></div>' +
        (message.translation ? '<small class="snapshot-translation">' + escapeHTML(message.translation) + '</small>' : '');
    }).join('');
    card.innerHTML = '<div class="favorite-card-head"><div class="favorite-meta"><b>' + escapeHTML(languageName) + '</b><span>·</span><span>' + escapeHTML(cardDate(item.saved_at)) + ' 收藏</span></div><button class="favorite-star" aria-label="取消收藏">★</button></div>' +
      '<h3>' + escapeHTML(item.scenario_title) + '</h3><p class="favorite-sub">' + escapeHTML(item.category) + ' · ' + escapeHTML(levels[item.level] || '初级') + ' · ' + escapeHTML(roundText) + '</p>' +
      '<div class="snapshot">' + snapshotLines + '</div><div class="snapshot-foot"><span>◷ 收藏快照 · ' + (item.messages || []).length + ' 句对话</span><span>▤ 保留收藏时内容</span></div>' +
      '<div class="favorite-actions"><button class="snapshot-review">展开完整快照</button><button class="primary resume-favorite">用这个场景再练</button></div>';
    grid.appendChild(card);
  }

  async function loadFavorites() {
    const grid = document.getElementById('favorites-grid');
    const items = await api.request('/favorites');
    grid.innerHTML = '';
    items.forEach(addFavoriteCard);
    if (typeof window.updateFavoriteCount === 'function') window.updateFavoriteCount();
    if (typeof window.syncSaveButton === 'function') window.syncSaveButton();
    const activeTab = document.querySelector('.favorite-language-tab.active')?.dataset.favoriteLanguage || 'en';
    if (typeof window.filterFavorites === 'function') window.filterFavorites(activeTab);
  }

  function renderHistoryRow(item) {
    const row = document.createElement('article');
    row.className = 'history-row';
    row.dataset.sessionId = item.id;
    const date = new Date(item.last_activity_at.endsWith('Z') ? item.last_activity_at : item.last_activity_at + 'Z');
    const now = new Date();
    const dayText = date.toDateString() === now.toDateString() ? '今天' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
    const minutes = Math.max(1, Math.ceil(item.duration_seconds / 60));
    const complete = item.status === 'completed';
    const statusText = complete ? '已完成' : item.status === 'abandoned' ? '已暂停' : '未完成';
    const actionText = item.status === 'in_progress' ? '继续练习' : '查看反馈';
    row.innerHTML = '<div class="history-date"><strong>' + escapeHTML(dayText) + '</strong>' +
      new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date) + '</div>' +
      '<div class="history-scene"><strong>' + escapeHTML(item.scenario_title) + '</strong><span>' + escapeHTML(languages[item.language] || item.language) + ' · ' + escapeHTML(item.category) + ' · ' + (complete ? '已完成 ' : '进行到第 ') + item.current_round + ' / ' + item.total_rounds + ' 轮</span></div>' +
      '<span class="history-status ' + (complete ? '' : 'pending') + '">' + statusText + '</span><span class="history-duration">' + minutes + ' 分钟</span>' +
      '<button class="history-open" ' + (item.status === 'in_progress' ? 'data-resume="true"' : '') + '>' + actionText + '</button>';
    return row;
  }

  async function loadHistory() {
    const items = await api.request('/practice-sessions?limit=30');
    const list = document.querySelector('.history-list');
    list.innerHTML = '';
    items.forEach(function (item) { list.appendChild(renderHistoryRow(item)); });
    const done = items.filter(function (item) { return item.status === 'completed'; }).length;
    const minutes = items.reduce(function (sum, item) { return sum + item.duration_seconds; }, 0) / 60;
    const usedLanguages = new Set(items.map(function (item) { return item.language; }));
    document.getElementById('history-total').textContent = items.length + ' 次练习';
    document.getElementById('history-completed').textContent = '其中 ' + done + ' 次已完成';
    document.getElementById('history-minutes').textContent = Math.round(minutes) + ' 分钟';
    document.getElementById('history-languages').textContent = usedLanguages.size + ' 种语言';
    const today = new Date();
    const todaySeconds = items.reduce(function (sum, item) {
      const date = new Date(item.last_activity_at.endsWith('Z') ? item.last_activity_at : item.last_activity_at + 'Z');
      return date.toDateString() === today.toDateString() ? sum + item.duration_seconds : sum;
    }, 0);
    document.getElementById('today-practice-minutes').textContent = Math.floor(todaySeconds / 60) + ' 分钟';
    const weekStart = new Date(today);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const practiceDays = new Set(items.map(function (item) {
      return new Date(item.last_activity_at.endsWith('Z') ? item.last_activity_at : item.last_activity_at + 'Z');
    }).filter(function (date) { return date >= weekStart && date <= today; }).map(function (date) { return date.toDateString(); }));
    const daysDone = Math.min(5, practiceDays.size);
    const daysRemaining = Math.max(0, 5 - daysDone);
    document.getElementById('week-practice-days').textContent = '✦ ' + daysDone + ' 天';
    document.getElementById('week-practice-goal').textContent = daysRemaining ? '再练 ' + daysRemaining + ' 天，完成本周目标' : '本周目标已完成，继续保持';
    document.getElementById('week-goal-dots').setAttribute('aria-label', '本周目标 5 天，已完成 ' + daysDone + ' 天');
    [...document.querySelectorAll('#week-goal-dots i')].forEach(function (dot, index) { dot.classList.toggle('on', index < daysDone); });
    const incomplete = items.find(function (item) { return item.status === 'in_progress'; });
    document.querySelector('.history-summary').classList.toggle('hidden', !incomplete);
    if (incomplete) {
      document.querySelector('.continue-card h2').textContent = '继续：' + incomplete.scenario_title;
      document.querySelector('.continue-card p').textContent = (languages[incomplete.language] || incomplete.language) + ' · ' + (levels[incomplete.level] || '初级') + ' · 还剩 ' + Math.max(0, incomplete.total_rounds - incomplete.current_round) + ' 轮';
      document.querySelector('.continue-progress > span:first-child').textContent = '进度 ' + incomplete.current_round + ' / ' + incomplete.total_rounds + ' 轮';
      const lastActivity = new Date(incomplete.last_activity_at.endsWith('Z') ? incomplete.last_activity_at : incomplete.last_activity_at + 'Z');
      document.querySelector('.continue-progress > span:last-child').textContent = '上次练习 ' + new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(lastActivity);
      document.getElementById('continue-practice').dataset.sessionId = incomplete.id;
    } else {
      document.getElementById('continue-practice').dataset.sessionId = '';
    }
    document.getElementById('history-empty').style.display = items.length ? 'none' : 'block';
  }

  async function saveProfile() {
    const genderText = document.getElementById('profile-gender').value;
    const gender = ({ '女': 'female', '男': 'male', '其他': 'other' })[genderText] || null;
    const user = await api.updateProfile({
      display_name: document.getElementById('profile-name').value.trim(),
      gender: gender,
      region: document.getElementById('profile-region').value,
    });
    displayUser(user);
    toast('个人资料已保存。');
  }

  async function savePassword() {
    if (passwordBusy) return;
    const current = document.getElementById('old-password').value;
    const next = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    if (!current || next.length < 8 || next !== confirm) {
      toast(next !== confirm ? '两次输入的新密码不一致。' : '请填写当前密码和至少 8 位的新密码。');
      return;
    }
    passwordBusy = true;
    try {
      const result = await api.changePassword({ current_password: current, new_password: next });
      api.setSession(result);
      displayUser(result.user);
      document.getElementById('password-form').classList.remove('open');
      toast('密码已更新，其他登录状态已失效。');
    } catch (error) {
      toast(error.message);
    } finally {
      passwordBusy = false;
      document.getElementById('old-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-password').value = '';
    }
  }

  async function savePhone() {
    const phone = document.getElementById('new-phone').value.trim();
    const code = document.getElementById('phone-code').value.trim();
    if (!phone || !code) { toast('请输入新手机号和验证码。'); return; }
    try {
      const user = await api.request('/auth/phone/confirm', { method: 'POST', body: JSON.stringify({ phone: phone, code: code }) });
      displayUser(user);
      document.getElementById('phone-form').classList.remove('open');
      toast('手机号已验证并更新。');
    } catch (error) { toast(error.message); }
  }

  async function requestPhoneCode() {
    const phone = document.getElementById('new-phone').value.trim();
    if (!phone) { toast('请先输入新手机号。'); return; }
    try {
      const result = await api.request('/auth/phone/request-code', { method: 'POST', body: JSON.stringify({ phone: phone }) });
      if (result.debug_code) document.getElementById('phone-code').value = result.debug_code;
      toast(result.debug_code ? '本地调试验证码：' + result.debug_code + '（正式环境需接短信服务）' : result.message);
    } catch (error) { toast(error.message); }
  }

  async function uploadAvatar(file) {
    try {
      const user = await api.uploadAvatar(file);
      displayUser(user);
      toast('头像已保存。');
    } catch (error) { toast(error.message); }
  }

  function favoritePayload(selection) {
    const round = currentRound();
    return {
      scenario_key: scenarioKey(selection), scenario_title: selection.title,
      language: selection.language, level: selection.level,
      category: scenarioCategory(),
      current_round: round.current_round, total_rounds: round.total_rounds,
      messages: snapshotMessages(),
    };
  }

  async function startSession(selection) {
    if (!selection?.title) return;
    const state = currentRound();
    const payload = {
      scenario_key: scenarioKey(selection), scenario_title: selection.title,
      language: selection.language, level: selection.level,
      category: scenarioCategory(),
      current_round: state.current_round, total_rounds: state.total_rounds,
      messages: snapshotMessages(),
    };
    try {
      currentSession = await api.request('/practice-sessions', { method: 'POST', body: JSON.stringify(payload) });
      sessionStartedAt = Date.now();
      await loadHistory();
    } catch (error) { toast(error.message); }
  }

  async function updateSession(extra) {
    if (!currentSession) return;
    const selection = currentSelection();
    const payload = Object.assign(sessionPayload(selection), extra || {});
    try {
      currentSession = await api.request('/practice-sessions/' + currentSession.id, { method: 'PATCH', body: JSON.stringify(payload) });
    } catch (error) {
      if (error.message.includes('登录')) api.clearSession();
    }
  }

  async function resumeSession(id) {
    try {
      const item = id ? await api.request('/practice-sessions/' + id) : await api.request('/practice-sessions/current');
      if (!item) { toast('没有可继续的未完成练习。'); return; }
      currentSession = item;
      sessionStartedAt = Date.now() - (item.duration_seconds || 0) * 1000;
      window.SpeakLoopPractice?.restore(item);
      if (typeof window.showView === 'function') window.showView('practice');
      toast('已恢复 ' + item.scenario_title + '。');
    } catch (error) { toast(error.message); }
  }

  function saveFavoriteForCurrentState() {
    window.setTimeout(async function () {
      const selection = currentSelection();
      const key = scenarioKey(selection);
      const cards = [...document.querySelectorAll('#favorites-grid .favorite-card')];
      const card = cards.find(function (item) { return item.dataset.language === selection.language && item.dataset.scene === selection.title; });
      try {
        if (card) {
          const saved = await api.request('/favorites', { method: 'POST', body: JSON.stringify(favoritePayload(selection)) });
          card.dataset.favoriteId = saved.id;
        } else {
          const previous = cards.find(function (item) { return item.dataset.favoriteId && item.dataset.scene === selection.title && item.dataset.language === selection.language; });
          if (previous) await api.request('/favorites/' + previous.dataset.favoriteId, { method: 'DELETE' });
          else {
            const items = await api.request('/favorites?language=' + encodeURIComponent(selection.language));
            const match = items.find(function (item) { return item.scenario_key === key; });
            if (match) await api.request('/favorites/' + match.id, { method: 'DELETE' });
          }
        }
      } catch (error) { toast(error.message); }
    }, 0);
  }

  async function initialize() {
    if (!api.getToken()) {
      window.location.replace('index.html#login');
      return;
    }
    try {
      const user = await api.me();
      displayUser(user);
      const favoritesGrid = document.getElementById('favorites-grid');
      favoritesGrid.innerHTML = '';
      await loadFavorites();
      await loadHistory();
      const selection = currentSelection();
      const existing = await api.request('/practice-sessions/current');
      if (existing) {
        currentSession = existing;
        sessionStartedAt = Date.now() - existing.duration_seconds * 1000;
        window.SpeakLoopPractice?.restore(existing);
      } else if (location.hash === '#practice' || !location.hash) {
        await startSession(selection, false);
      }
      saveTimer = window.setInterval(function () { updateSession(); }, 15000);
    } catch (error) {
      api.clearSession();
      window.location.replace('index.html#login');
    }
  }

  document.getElementById('save-profile').addEventListener('click', function () {
    saveProfile().catch(function (error) { toast(error.message); });
  });
  document.getElementById('save-password').addEventListener('click', savePassword);
  document.getElementById('save-phone').addEventListener('click', savePhone);
  document.getElementById('request-phone-code').addEventListener('click', requestPhoneCode);
  document.getElementById('avatar-file').addEventListener('change', function (event) {
    const file = event.target.files?.[0];
    if (file) uploadAvatar(file);
  });
  document.getElementById('font-range').addEventListener('change', async function (event) {
    try {
      const user = await api.updatePreferences({ font_size: Number(event.target.value) });
      currentUser = user;
      toast('字体大小已保存到账号。');
    } catch (error) { toast(error.message); }
  });
  document.getElementById('confirm-logout').addEventListener('click', async function () {
    const email = text('account-email');
    await updateSession();
    try { await api.logout(); } catch {}
    try { sessionStorage.setItem('speakloop_last_email', email); } catch {}
    api.clearSession();
    window.location.href = 'index.html#login';
  });
  document.getElementById('save-session').addEventListener('click', saveFavoriteForCurrentState);
  document.getElementById('favorites-grid').addEventListener('click', function (event) {
    const button = event.target.closest('.favorite-star');
    if (!button) return;
    const card = button.closest('.favorite-card');
    const id = card?.dataset.favoriteId;
    if (id) api.request('/favorites/' + id, { method: 'DELETE' }).catch(function (error) { toast(error.message); });
  });
  document.getElementById('home-cards').addEventListener('click', function (event) {
    const button = event.target.closest('[data-home-scene]');
    if (!button) return;
    window.setTimeout(async function () {
      await pendingSessionSave;
      startSession(currentSelection());
    }, 0);
  });
  document.addEventListener('speakloop:save-session-before-switch', function () {
    if (currentSession?.status === 'in_progress') pendingSessionSave = updateSession();
  });
  document.querySelectorAll('.language-option').forEach(function (option) {
    option.addEventListener('click', function () {
      window.setTimeout(function () { updateSession(); }, 0);
    });
  });
  document.querySelectorAll('[data-view="practice"]').forEach(function (item) {
    item.addEventListener('click', function () {
      window.setTimeout(function () {
        if (!currentSession || currentSession.status !== 'in_progress') startSession(currentSelection(), false);
      }, 0);
    });
  });
  document.getElementById('send-answer').addEventListener('click', function () {
    window.setTimeout(function () { updateSession(); }, 0);
  });
  document.getElementById('done-button').addEventListener('click', function () {
    updateSession({ status: 'completed' }).then(loadHistory);
  });
  document.getElementById('continue-practice').addEventListener('click', function (event) {
    resumeSession(event.currentTarget.dataset.sessionId || null);
  });
  document.querySelector('.history-list').addEventListener('click', function (event) {
    const button = event.target.closest('.history-open[data-resume="true"]');
    if (button) resumeSession(button.closest('.history-row')?.dataset.sessionId);
  });
  document.getElementById('favorites-grid').addEventListener('click', function (event) {
    const button = event.target.closest('.resume-favorite');
    if (!button) return;
    const card = button.closest('.favorite-card');
    const language = card?.dataset.language || 'en';
    const title = card?.dataset.scene || '在咖啡店点单';
    const level = Object.keys(levels).find(function (key) { return (card?.querySelector('.favorite-sub')?.textContent || '').includes(levels[key]); }) || 'beginner';
    window.SpeakLoopPractice?.select(title, language, level);
    window.setTimeout(async function () {
      await pendingSessionSave;
      startSession({ title: title, language: language, level: level });
    }, 0);
  });

  window.SpeakLoopPracticeAPI = Object.freeze({
    getCurrentSessionId: function () { return currentSession?.id || null; },
  });

  initialize();
}());
