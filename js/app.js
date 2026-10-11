(() => {
  async function api(url, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
      ...options
    });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('API request failed:', {
        endpoint: new URL(url, window.location.origin).pathname,
        status: response.status
      });
      const error = new Error(data.error || `Yêu cầu thất bại (${response.status}).`);
      error.status = response.status;
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        error.retryAfterSeconds = retryAfterSeconds;
      }
      throw error;
    }
    return data;
  }

  function showAlert(message, type = 'danger', host = document.getElementById('alert-area')) {
    if (!host) return;
    host.replaceChildren();
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.setAttribute('role', 'status');
    alert.textContent = message;
    host.append(alert);
  }

  function setBusy(button, busy, busyText = 'Đang xử lý…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  async function currentUser() {
    try {
      const { user } = await api('/api/auth/me');
      return user;
    } catch (error) {
      if (error.status === 401) {
        window.location.href = '/main/login.html';
        return null;
      }
      throw error;
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-logout]');
    if (!button) return;
    setBusy(button, true, 'Đang đăng xuất…');
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = '/main/login.html';
    } catch (error) {
      showAlert(error.message);
      setBusy(button, false);
    }
  });

  window.App = { api, showAlert, setBusy, currentUser };
})();
