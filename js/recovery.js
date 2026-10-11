document.addEventListener('DOMContentLoaded', () => {
  const modes = document.getElementById('mode-selection');
  const panel = document.getElementById('recovery-panel');
  const form = document.getElementById('recovery-form');
  const identityFields = document.getElementById('identity-fields');
  const otpFields = document.getElementById('otp-fields');
  const passwordFields = document.getElementById('password-fields');
  const captchaImage = document.getElementById('captcha-image');
  const captchaInput = document.getElementById('captcha-answer');
  const resendButton = document.getElementById('resend-otp');
  const countdown = document.getElementById('resend-countdown');
  let purpose = '';
  let challengeId = '';
  let resetToken = '';
  let phase = 'identity';
  let resendTimer;
  let countdownRemaining = 0;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
  });
  document.getElementById('back-to-modes').addEventListener('click', () => {
    clearInterval(resendTimer);
    challengeId = '';
    resetToken = '';
    phase = 'identity';
    panel.classList.add('d-none');
    modes.classList.remove('d-none');
    App.showAlert('');
  });
  document.getElementById('refresh-captcha').addEventListener('click', loadCaptcha);
  document.getElementById('resend-otp').addEventListener('click', resendOtp);
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Ẩn' : 'Hiện';
      button.setAttribute('aria-label', `${visible ? 'Ẩn' : 'Hiện'} ${input.id === 'new-password' ? 'mật khẩu mới' : 'mật khẩu xác nhận'}`);
    });
  });
  form.addEventListener('submit', submit);

  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  if (['recover', 'change'].includes(requestedMode)) selectMode(requestedMode);

  async function selectMode(nextPurpose) {
    purpose = nextPurpose;
    phase = 'identity';
    challengeId = '';
    resetToken = '';
    form.reset();
    identityFields.classList.remove('d-none');
    otpFields.classList.add('d-none');
    passwordFields.classList.add('d-none');
    setDisabled(identityFields, false);
    setDisabled(otpFields, true);
    setDisabled(passwordFields, true);
    document.getElementById('request-otp').textContent = 'Gửi mã xác minh';
    document.getElementById('mode-title').textContent = nextPurpose === 'recover' ? 'Lấy lại mật khẩu' : 'Đổi mật khẩu';
    document.getElementById('mode-description').textContent = nextPurpose === 'recover'
      ? 'Xác minh thông tin sinh viên và số điện thoại đã đăng ký để đặt mật khẩu mới.'
      : 'Xác minh số điện thoại đã đăng ký bằng OTP trước khi đổi mật khẩu.';
    modes.classList.add('d-none');
    panel.classList.remove('d-none');
    App.showAlert('');
    await loadCaptcha();
  }

  async function loadCaptcha() {
    const button = document.getElementById('refresh-captcha');
    App.setBusy(button, true, 'Đang tạo…');
    try {
      const captcha = await App.api('/api/auth/recovery/captcha', {
        method: 'POST',
        body: JSON.stringify({ purpose })
      });
      challengeId = captcha.challengeId;
      captchaImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.image)}`;
      captchaInput.value = '';
    } catch (error) {
      App.showAlert(error.message);
    } finally {
      App.setBusy(button, false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (phase === 'identity') return requestOtp();
    if (phase === 'otp') return verifyOtp();
    if (phase === 'password') return changePassword();
  }

  async function requestOtp() {
    if (document.getElementById('student-email').validity.typeMismatch ||
        !document.getElementById('student-email').value.toLowerCase().endsWith('@st.tvu.edu.vn')) {
      App.showAlert('Email phải sử dụng miền @st.tvu.edu.vn.');
      return;
    }
    const button = document.getElementById('request-otp');
    App.setBusy(button, true, 'Đang xác minh…');
    try {
      const result = await App.api('/api/auth/recovery/request-otp', {
        method: 'POST',
        body: JSON.stringify({
          challengeId,
          purpose,
          captcha: captchaInput.value.trim(),
          email: document.getElementById('student-email').value.trim(),
          studentId: document.getElementById('student-id').value.trim(),
          classCode: document.getElementById('student-class').value.trim(),
          phoneNumber: document.getElementById('registered-phone').value.trim()
        })
      });
      challengeId = result.challengeId;
      phase = 'otp';
      setDisabled(identityFields, true);
      setDisabled(otpFields, false);
      identityFields.classList.add('d-none');
      otpFields.classList.remove('d-none');
      App.showAlert(result.message, 'success');
      startCountdown(result.resendAfterSeconds);
    } catch (error) {
      App.showAlert(error.message);
      await loadCaptcha();
    } finally {
      App.setBusy(button, false);
    }
  }

  async function resendOtp() {
    App.setBusy(resendButton, true, 'Đang gửi…');
    try {
      const result = await App.api('/api/auth/recovery/resend-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeId })
      });
      App.showAlert(result.message, 'success');
      startCountdown(result.resendAfterSeconds);
    } catch (error) {
      App.showAlert(error.message);
      if (error.status === 429) startCountdown(error.retryAfterSeconds || 60);
      resendButton.disabled = false;
    } finally {
      if (resendButton.getAttribute('aria-busy')) {
        App.setBusy(resendButton, false);
        resendButton.disabled = countdownRemaining > 0;
      }
    }
  }

  async function verifyOtp() {
    const button = document.getElementById('verify-otp');
    App.setBusy(button, true, 'Đang xác minh…');
    try {
      const result = await App.api('/api/auth/recovery/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeId, otp: document.getElementById('otp-code').value.trim() })
      });
      resetToken = result.resetToken;
      phase = 'password';
      setDisabled(otpFields, true);
      setDisabled(passwordFields, false);
      otpFields.classList.add('d-none');
      passwordFields.classList.remove('d-none');
      App.showAlert(result.message, 'success');
    } catch (error) {
      App.showAlert(error.message);
    } finally {
      App.setBusy(button, false);
    }
  }

  async function changePassword() {
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-password');
    if (password !== confirmation.value) {
      confirmation.setCustomValidity('Mật khẩu xác nhận không khớp.');
      form.reportValidity();
      confirmation.setCustomValidity('');
      return;
    }
    const button = document.getElementById('save-password');
    App.setBusy(button, true, 'Đang cập nhật…');
    try {
      const result = await App.api('/api/auth/recovery/reset-password', {
        method: 'POST',
        body: JSON.stringify({ resetToken, password, confirmPassword: confirmation.value })
      });
      resetToken = '';
      challengeId = '';
      phase = 'complete';
      setDisabled(passwordFields, true);
      form.replaceChildren();
      App.showAlert(result.message, 'success');
    } catch (error) {
      App.showAlert(error.message);
      App.setBusy(button, false);
    }
  }

  function startCountdown(seconds) {
    clearInterval(resendTimer);
    let remaining = Math.max(0, Number(seconds) || 0);
    countdownRemaining = remaining;
    resendButton.disabled = remaining > 0;
    const update = () => {
      countdownRemaining = remaining;
      countdown.textContent = remaining ? `Có thể gửi lại sau ${remaining} giây.` : '';
      resendButton.disabled = remaining > 0;
      if (!remaining) clearInterval(resendTimer);
      remaining -= 1;
    };
    update();
    resendTimer = setInterval(update, 1000);
  }

  function setDisabled(section, disabled) {
    section.querySelectorAll('input, button').forEach((control) => { control.disabled = disabled; });
  }
});
