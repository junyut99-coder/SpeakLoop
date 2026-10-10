(function () {
  const api = window.SpeakLoopAPI;
  const form = document.getElementById('signup-form');
  const password = document.getElementById('password');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const terms = document.getElementById('terms');
  const notice = document.getElementById('notice');
  const submit = form.querySelector('.submit');
  const modeToggle = document.getElementById('mode-toggle');
  let mode = location.hash === '#login' ? 'login' : 'register';

  function showNotice(message, isError) {
    notice.textContent = message;
    notice.classList.add('show');
    notice.classList.toggle('error', Boolean(isError));
  }

  function setMode(nextMode) {
    mode = nextMode;
    const login = mode === 'login';
    document.getElementById('name-field').hidden = login;
    document.getElementById('language-field').hidden = login;
    document.getElementById('terms-row').hidden = login;
    nameInput.required = !login;
    terms.required = !login;
    document.querySelector('h1').textContent = login ? '欢迎回来' : '创建你的账户';
    document.querySelector('.intro').innerHTML = login
      ? '登录后继续你的练习进度。'
      : '给自己一点练习时间，让每一次开口<br class="desktop-break" />都离流利更近一步。';
    document.querySelector('label[for="password"]').textContent = login ? '登录密码' : '设置密码';
    password.autocomplete = login ? 'current-password' : 'new-password';
    submit.innerHTML = (login ? '登录' : '创建账户') + ' <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    modeToggle.innerHTML = login
      ? '还没有账户？<a href="#register">创建账户</a>'
      : '已经有账户？<a href="#login">登录</a>';
    notice.classList.remove('show', 'error');
  }

  modeToggle.addEventListener('click', function (event) {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    setMode(link.hash === '#login' ? 'login' : 'register');
  });

  document.getElementById('toggle-password').addEventListener('click', function (event) {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    event.currentTarget.title = visible ? '隐藏密码' : '显示密码';
  });

  try {
    const lastEmail = sessionStorage.getItem('speakloop_last_email');
    if (lastEmail) emailInput.value = lastEmail;
    const oldDraft = sessionStorage.getItem('speakloop_logout_prefill');
    if (oldDraft) {
      const draft = JSON.parse(oldDraft);
      if (draft.email) emailInput.value = draft.email;
      if (draft.name) nameInput.value = draft.name;
      sessionStorage.removeItem('speakloop_logout_prefill');
    }
  } catch {}

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const login = mode === 'login';
    const languages = [...document.querySelectorAll('input[name="language"]:checked')]
      .map(function (item) { return ({ '英语': 'en', '日语': 'ja', '中文': 'zh' })[item.value]; })
      .filter(Boolean);
    if (!login && languages.length === 0) {
      showNotice('请选择至少一种想练习的语言。', true);
      return;
    }

    submit.disabled = true;
    try {
      const result = login
        ? await api.login({ email: emailInput.value.trim(), password: password.value })
        : await api.register({
            display_name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            password: password.value,
            languages: languages,
          });
      api.setSession(result);
      showNotice(login ? '登录成功，正在返回练习空间…' : '账户已创建，正在进入练习空间…', false);
      window.setTimeout(function () { window.location.href = 'practice.html#practice'; }, 350);
    } catch (error) {
      showNotice(error.message || '连接后端失败，请确认后端服务已启动。', true);
    } finally {
      submit.disabled = false;
    }
  });

  setMode(mode);
  if (mode === 'login') showNotice('请输入注册邮箱和密码继续。', false);
}());
