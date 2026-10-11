document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('login-form');
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (response.ok) {
      const { user } = await response.json();
      window.location.href = user.role === 'lecturer' ? '/main/lecturer.html' : '/';
      return;
    }
  } catch {
    App.showAlert('Không thể kết nối tới máy chủ. Vui lòng thử lại.', 'danger');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    App.setBusy(button, true, 'Đang đăng nhập…');
    try {
      const { user } = await App.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value
        })
      });
      window.location.href = user.role === 'lecturer' ? '/main/lecturer.html' : '/';
    } catch (error) {
      App.showAlert(error.message);
      App.setBusy(button, false);
    }
  });
});
