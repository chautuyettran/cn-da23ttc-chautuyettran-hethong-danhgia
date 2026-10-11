document.addEventListener('DOMContentLoaded', async () => {
  const profileContent = document.getElementById('profile-content');
  const loading = document.getElementById('profile-loading');
  const details = document.getElementById('profile-details');
  const form = document.getElementById('profile-form');
  const passwordForm = document.getElementById('password-form');
  const fileInput = document.getElementById('avatar-file');
  const avatar = document.getElementById('profile-avatar');
  const placeholder = document.getElementById('avatar-placeholder');
  const previewPanel = document.getElementById('avatar-preview-panel');
  let profile;
  let previewUrl = '';
  let role = '';

  try {
    const user = await App.currentUser();
    if (!user) return;
    if (user.role !== 'student') {
      if (user.role !== 'lecturer') {
        window.location.replace('/');
        return;
      }
    }
    role = user.role;
    document.getElementById('profile-eyebrow').textContent =
      role === 'lecturer' ? 'TÀI KHOẢN GIẢNG VIÊN' : 'TÀI KHOẢN SINH VIÊN';
    if (role === 'lecturer') {
      document.getElementById('profile-section-heading').textContent = 'Thông tin giảng viên';
      document.getElementById('profile-section-description').textContent =
        'Email và khoa được quản lý theo hồ sơ của nhà trường.';
      document.getElementById('profile-avatar').alt = 'Ảnh đại diện giảng viên';
    }
    await loadProfile();
  } catch (error) {
    App.showAlert(error.message);
    loading.textContent = 'Không thể tải thông tin tài khoản. Vui lòng thử lại.';
  }

  document.getElementById('edit-profile').addEventListener('click', beginEdit);
  document.getElementById('cancel-profile').addEventListener('click', cancelEdit);
  form.addEventListener('submit', saveProfile);
  passwordForm.addEventListener('submit', changePassword);
  fileInput.addEventListener('change', selectAvatar);
  document.getElementById('save-avatar').addEventListener('click', saveAvatar);
  document.getElementById('cancel-avatar').addEventListener('click', cancelAvatar);

  async function loadProfile() {
    loading.classList.remove('d-none');
    profileContent.classList.add('d-none');
    profileContent.setAttribute('aria-busy', 'true');
    try {
      const result = await App.api(`/api/${role}/profile`);
      profile = result.profile;
      renderProfile();
      loading.classList.add('d-none');
      profileContent.classList.remove('d-none');
      profileContent.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (error.status !== 401) {
        loading.textContent = 'Không thể tải thông tin tài khoản. Vui lòng tải lại trang.';
      }
      showRequestError(error);
      throw error;
    }
  }

  function renderProfile() {
    document.getElementById('detail-name').textContent = profile.fullName || 'Chưa cập nhật';
    document.getElementById('detail-class').textContent = profile.classNames.length
      ? profile.classNames.join(', ')
      : 'Chưa cập nhật';
    document.getElementById('detail-student-id').textContent = profile.studentId || 'Chưa cập nhật';
    document.getElementById('detail-department').textContent = profile.department || 'Chưa cập nhật';
    document.getElementById('class-label').classList.toggle('d-none', role !== 'student');
    document.getElementById('detail-class').classList.toggle('d-none', role !== 'student');
    document.getElementById('student-id-label').classList.toggle('d-none', role !== 'student');
    document.getElementById('detail-student-id').classList.toggle('d-none', role !== 'student');
    document.getElementById('department-label').classList.toggle('d-none', role !== 'lecturer');
    document.getElementById('detail-department').classList.toggle('d-none', role !== 'lecturer');
    document.getElementById('detail-email').textContent = profile.email || 'Chưa cập nhật';
    document.getElementById('detail-phone').textContent = profile.phoneNumber || 'Chưa cập nhật';

    const githubDetail = document.getElementById('detail-github');
    githubDetail.replaceChildren();
    if (profile.githubUrl) {
      const link = document.createElement('a');
      link.href = profile.githubUrl;
      link.textContent = profile.githubUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      githubDetail.append(link);
    } else {
      githubDetail.textContent = 'Chưa cập nhật';
    }

    document.getElementById('avatar-initials').textContent = initials(profile.fullName);
    if (profile.avatarUrl) {
      avatar.onload = () => {
        avatar.classList.remove('d-none');
        placeholder.classList.add('d-none');
      };
      avatar.onerror = () => showPlaceholder();
      avatar.src = `${profile.avatarUrl}?v=${Date.now()}`;
    } else {
      showPlaceholder();
    }
    renderAvatarActions();
    resetForm();
  }

  function renderAvatarActions() {
    const actions = document.getElementById('avatar-actions');
    actions.replaceChildren();
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-outline-primary btn-sm';
    editButton.textContent = profile.avatarUrl ? 'Sửa ảnh' : 'Thêm ảnh';
    editButton.addEventListener('click', () => fileInput.click());
    actions.append(editButton);
    if (profile.avatarUrl) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-outline-danger btn-sm';
      deleteButton.textContent = 'Xóa ảnh';
      deleteButton.addEventListener('click', deleteAvatar);
      actions.append(deleteButton);
    }
  }

  function beginEdit() {
    App.showAlert('');
    resetForm();
    details.classList.add('d-none');
    form.classList.remove('d-none');
    document.getElementById('edit-profile').classList.add('d-none');
    document.getElementById('edit-name').focus();
  }

  function cancelEdit() {
    resetForm();
    form.classList.add('d-none');
    details.classList.remove('d-none');
    document.getElementById('edit-profile').classList.remove('d-none');
    App.showAlert('');
  }

  function resetForm() {
    document.getElementById('edit-name').value = profile.fullName || '';
    document.getElementById('edit-class').value = profile.classNames.join(', ') || 'Chưa cập nhật';
    document.getElementById('edit-student-id').value = profile.studentId || 'Chưa cập nhật';
    document.getElementById('edit-department').value = profile.department || 'Chưa cập nhật';
    document.getElementById('edit-class-row').classList.toggle('d-none', role !== 'student');
    document.getElementById('edit-student-id-row').classList.toggle('d-none', role !== 'student');
    document.getElementById('edit-department-row').classList.toggle('d-none', role !== 'lecturer');
    document.getElementById('edit-email').value = profile.email || '';
    document.getElementById('edit-phone').value = profile.phoneNumber || '';
    document.getElementById('edit-github').value = profile.githubUrl || '';
  }

  async function saveProfile(event) {
    event.preventDefault();
    const nameInput = document.getElementById('edit-name');
    const phoneInput = document.getElementById('edit-phone');
    const githubInput = document.getElementById('edit-github');
    const github = githubInput.value.trim();
    githubInput.setCustomValidity(github && !isGitHubProfileUrl(github)
      ? 'Nhập liên kết hồ sơ HTTPS hợp lệ, ví dụ https://github.com/ten-cua-ban.'
      : '');
    if (!form.reportValidity()) return;
    const button = document.getElementById('save-profile');
    App.setBusy(button, true, 'Đang lưu…');
    try {
      const result = await App.api(`/api/${role}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: nameInput.value.trim(),
          phone_number: phoneInput.value.trim(),
          github_url: github
        })
      });
      profile = result.profile;
      renderProfile();
      form.classList.add('d-none');
      details.classList.remove('d-none');
      document.getElementById('edit-profile').classList.remove('d-none');
      App.showAlert(result.message, 'success');
    } catch (error) {
      showRequestError(error);
    } finally {
      App.setBusy(button, false);
    }
  }

  function selectAvatar() {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      App.showAlert('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
      fileInput.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      App.showAlert('Ảnh không được vượt quá 2 MB.');
      fileInput.value = '';
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    document.getElementById('avatar-preview').src = previewUrl;
    previewPanel.classList.remove('d-none');
    App.showAlert('');
  }

  async function saveAvatar() {
    const file = fileInput.files?.[0];
    if (!file) return;
    const button = document.getElementById('save-avatar');
    App.setBusy(button, true, 'Đang tải ảnh…');
    try {
      const body = new FormData();
      body.append('avatar', file);
      const result = await App.api(`/api/${role}/profile/avatar`, { method: 'POST', body });
      cancelAvatar();
      await loadProfile();
      App.showAlert(result.message, result.cleanupPending ? 'warning' : 'success');
    } catch (error) {
      showRequestError(error);
    } finally {
      App.setBusy(button, false);
    }
  }

  async function deleteAvatar() {
    if (!window.confirm('Bạn có chắc muốn xóa ảnh đại diện?')) return;
    const button = [...document.querySelectorAll('#avatar-actions button')].find((item) => item.textContent === 'Xóa ảnh');
    App.setBusy(button, true, 'Đang xóa…');
    try {
      const result = await App.api(`/api/${role}/profile/avatar`, { method: 'DELETE' });
      await loadProfile();
      App.showAlert(result.message, 'success');
    } catch (error) {
      showRequestError(error);
      App.setBusy(button, false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (!passwordForm.reportValidity()) return;
    const newPassword = document.getElementById('new-password');
    const confirmation = document.getElementById('confirm-password');
    if (newPassword.value !== confirmation.value) {
      confirmation.setCustomValidity('Mật khẩu xác nhận không khớp.');
      passwordForm.reportValidity();
      confirmation.setCustomValidity('');
      return;
    }
    const button = document.getElementById('change-password');
    App.setBusy(button, true, 'Đang đổi mật khẩu…');
    try {
      const result = await App.api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('current-password').value,
          newPassword: newPassword.value,
          confirmPassword: confirmation.value
        })
      });
      passwordForm.reset();
      App.showAlert(result.message, 'success');
      window.setTimeout(() => { window.location.href = '/main/login.html'; }, 1500);
    } catch (error) {
      showRequestError(error);
      App.setBusy(button, false);
    }
  }

  function cancelAvatar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    fileInput.value = '';
    document.getElementById('avatar-preview').removeAttribute('src');
    previewPanel.classList.add('d-none');
  }

  function showPlaceholder() {
    avatar.classList.add('d-none');
    placeholder.classList.remove('d-none');
  }

  function showRequestError(error) {
    if (error.status === 401) {
      window.location.replace('/main/login.html');
      return;
    }
    App.showAlert(error.message);
  }

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.length ? words.slice(-2).map((word) => word[0]).join('').toUpperCase() : 'SV';
  }

  function isGitHubProfileUrl(value) {
    try {
      const url = new URL(value);
      const username = url.pathname.replace(/^\/|\/$/g, '');
      return url.protocol === 'https:' &&
        url.hostname.toLowerCase() === 'github.com' &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username) &&
        !username.includes('--') &&
        !url.search &&
        !url.hash;
    } catch {
      return false;
    }
  }
});
