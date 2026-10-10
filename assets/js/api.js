(function () {
  const API_ROOT = '/api/v1';
  const TOKEN_KEY = 'speakloop_access_token';
  const USER_KEY = 'speakloop_current_user';

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setSession(result) {
    try {
      sessionStorage.setItem(TOKEN_KEY, result.access_token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(result.user));
      sessionStorage.setItem('speakloop_last_email', result.user.email);
    } catch {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      sessionStorage.removeItem('speakloop_demo_account');
      sessionStorage.removeItem('speakloop_demo_password');
      sessionStorage.removeItem('speakloop_logout_prefill');
    } catch {}
  }

  async function request(path, options) {
    const config = options || {};
    const headers = new Headers(config.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (config.body && !(config.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(API_ROOT + path, { ...config, headers });
    if (response.status === 204) return null;
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const detail = body.detail;
      const message = Array.isArray(detail)
        ? detail.map(function (item) { return item.msg || '请求数据无效'; }).join('；')
        : (detail || '请求失败，请稍后重试。');
      if (response.status === 401 && getToken()) {
        clearSession();
        if (location.pathname.endsWith('/practice.html')) location.replace('index.html#login');
      }
      throw new Error(message);
    }
    return body;
  }

  window.SpeakLoopAPI = Object.freeze({
    request,
    getToken,
    setSession,
    clearSession,
    register: function (body) {
      return request('/auth/register', { method: 'POST', body: JSON.stringify(body) });
    },
    login: function (body) {
      return request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
    },
    me: function () { return request('/auth/me'); },
    logout: function () { return request('/auth/logout', { method: 'POST' }); },
    updateProfile: function (body) {
      return request('/users/me', { method: 'PATCH', body: JSON.stringify(body) });
    },
    updatePreferences: function (body) {
      return request('/users/me/preferences', { method: 'PATCH', body: JSON.stringify(body) });
    },
    changePassword: function (body) {
      return request('/auth/change-password', { method: 'POST', body: JSON.stringify(body) });
    },
    uploadAvatar: function (file) {
      const form = new FormData();
      form.append('file', file);
      return request('/users/me/avatar', { method: 'POST', body: form });
    },
  });
}());
