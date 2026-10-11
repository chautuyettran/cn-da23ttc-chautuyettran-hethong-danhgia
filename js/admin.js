const fieldSets = {
  lecturers: [
    { key: 'full_name', label: 'Họ và tên', required: true },
    { key: 'department', label: 'Khoa / bộ môn', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true }
  ],
  courses: [
    { key: 'code', label: 'Mã học phần', required: true },
    { key: 'title', label: 'Tên học phần', required: true },
    { key: 'description', label: 'Mô tả', type: 'textarea' }
  ],
  classes: [
    { key: 'code', label: 'Mã lớp', required: true },
    { key: 'name', label: 'Tên lớp', required: true },
    { key: 'academic_year', label: 'Năm học', required: true },
    { key: 'semester', label: 'Học kỳ' }
  ],
  questions: [
    { key: 'text', label: 'Nội dung câu hỏi', type: 'textarea', required: true },
    { key: 'category', label: 'Nhóm câu hỏi', required: true },
    { key: 'is_active', label: 'Đang sử dụng', type: 'checkbox' }
  ],
  'lecturer-questions': [
    { key: 'text', label: 'Nội dung câu hỏi', type: 'textarea', required: true },
    { key: 'category', label: 'Nhóm câu hỏi', required: true },
    { key: 'description', label: 'Mô tả', type: 'textarea' },
    { key: 'is_required', label: 'Bắt buộc trả lời', type: 'checkbox' },
    { key: 'is_active', label: 'Đang áp dụng', type: 'checkbox' }
  ],
  users: [
    { key: 'full_name', label: 'Họ và tên', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'password', label: 'Mật khẩu (ít nhất 12 ký tự)', type: 'password', required: true, minLength: 12 },
    { key: 'role', label: 'Vai trò', type: 'select', options: [['student', 'Sinh viên'], ['lecturer', 'Giảng viên'], ['admin', 'Quản trị viên']] },
    { key: 'phone_number', label: 'Số điện thoại khôi phục (định dạng +84...)', type: 'tel', maxLength: 16, pattern: '^\\+[1-9][0-9]{7,14}$' },
    { key: 'phone_verified', label: 'Đã xác minh số điện thoại theo quy trình của đơn vị', type: 'checkbox', defaultValue: false, helpText: 'Chỉ đánh dấu sau khi đơn vị đã xác minh số điện thoại với sinh viên qua quy trình được phê duyệt.' }
  ],
  policy: [
    { key: 'scope', label: 'Phạm vi giới hạn', type: 'select', options: [['survey', 'Theo từng khảo sát'], ['assignment_period', 'Theo phân công và học kỳ']] },
    { key: 'max_submissions', label: 'Số lần gửi tối đa', type: 'number', required: true, min: 1, max: 10 },
    { key: 'allow_revisions', label: 'Cho phép chỉnh sửa / gửi lại', type: 'checkbox', defaultValue: false },
    { key: 'min_report_responses', label: 'Ngưỡng phản hồi tối thiểu để hiển thị báo cáo', type: 'number', required: true, min: 1, max: 1000 }
  ]
};
const resourceSelect = document.getElementById('resource-select');
const form = document.getElementById('admin-form');
const heading = document.getElementById('form-title');
let editingId = null;
let formGeneration = 0;
let pendingSelectLoads = 0;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const user = await App.currentUser();
    if (!user) return;
    if (user.role !== 'admin') {
      window.location.href = '/';
      return;
    }
    resourceSelect.addEventListener('change', () => { editingId = null; renderForm(); loadList(); });
    document.getElementById('refresh-admin').addEventListener('click', loadList);
    form.addEventListener('submit', save);
    await loadList();
    renderForm();
  } catch (error) {
    App.showAlert(error.message);
  }
});

function renderForm(values = {}) {
  formGeneration += 1;
  pendingSelectLoads = 0;
  form.replaceChildren();
  const resource = resourceSelect.value;
  heading.textContent = editingId ? 'Cập nhật dữ liệu' : 'Thêm dữ liệu';
  if (fieldSets[resource] && (resource !== 'lecturer-questions' || editingId)) {
    fieldSets[resource].forEach((field) => form.append(makeField(field, values[field.key])));
    if (resource === 'policy' && !Object.keys(values).length) {
      const generation = formGeneration;
      App.api('/api/admin/policy').then(({ policy }) => {
        if (generation !== formGeneration) return;
        fieldSets.policy.forEach((field) => {
          const control = form.elements.namedItem(field.key);
          if (field.type === 'checkbox') control.checked = Boolean(policy[field.key]);
          else control.value = policy[field.key];
        });
      }).catch((error) => {
        if (generation === formGeneration) App.showAlert(error.message);
      });
    }
    if (resource === 'users') {
      addSelectField(
        'lecturer_id', 'Hồ sơ giảng viên (chỉ dành cho vai trò giảng viên)',
        '/api/admin/lecturers',
        (item) => `${item.full_name} · ${item.department}`,
        false,
        values.lecturer_id || '',
        false
      );
    }
  } else if (resource === 'lecturer-questions') {
    const note = document.createElement('p');
    note.className = 'small text-secondary mb-0';
    note.textContent = 'Chọn Sửa ở câu hỏi hiện có để cập nhật. Câu hỏi giảng viên chỉ được tạo từ cổng giảng viên.';
    form.append(note);
  } else if (resource === 'assignments') {
    addSelectField('lecturer_id', 'Giảng viên', '/api/admin/lecturers');
    addSelectField('course_id', 'Học phần', '/api/admin/courses');
    addSelectField('class_id', 'Lớp học', '/api/admin/classes');
    form.append(makeField({ key: 'academic_year', label: 'Năm học', required: true }));
    form.append(makeField({ key: 'semester', label: 'Học kỳ', required: true }));
  } else if (resource === 'surveys') {
    addSelectField('assignment_id', 'Phân công giảng dạy', '/api/admin/assignments/list', (item) => `#${item.id} · ${item.lecturer_name} — ${item.course_title} (${item.class_name})`);
    form.append(makeField({ key: 'title', label: 'Tên khảo sát', required: true }));
    form.append(makeField({ key: 'description', label: 'Mô tả', type: 'textarea' }));
    form.append(makeField({ key: 'starts_at', label: 'Bắt đầu', type: 'datetime-local', required: true }));
    form.append(makeField({ key: 'ends_at', label: 'Kết thúc', type: 'datetime-local', required: true }));
    const status = makeField({ key: 'status', label: 'Trạng thái', type: 'select', options: [['draft', 'Bản nháp'], ['open', 'Đang mở'], ['closed', 'Đã đóng']] });
    form.append(status);
    const note = document.createElement('p');
    note.className = 'small text-secondary mb-0';
    note.textContent = 'Tất cả câu hỏi chung đang hoạt động sẽ tự động hiển thị trong mọi khảo sát.';
    form.append(note);
  } else if (resource === 'enrollments') {
    addSelectField('student_id', 'Sinh viên', '/api/admin/students', (item) => `${item.full_name} · ${item.email}`);
    addSelectField('class_id', 'Lớp học', '/api/admin/classes');
  }
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  submit.textContent = resource === 'lecturer-questions' && !editingId
    ? 'Chọn câu hỏi để sửa'
    : editingId ? 'Lưu thay đổi' : 'Thêm mới';
  submit.disabled = pendingSelectLoads > 0 || (resource === 'lecturer-questions' && !editingId);
  form.append(submit);
  if (editingId) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-outline-secondary';
    cancel.textContent = 'Hủy chỉnh sửa';
    cancel.addEventListener('click', () => { editingId = null; renderForm(); });
    form.append(cancel);
  }
  if (resource === 'users') {
    const role = form.elements.namedItem('role');
    const phoneFields = ['phone_number', 'phone_verified']
      .map((key) => form.elements.namedItem(key)?.closest('.admin-field'))
      .filter(Boolean);
    const updatePhoneVisibility = () => {
      const isStudent = role.value === 'student';
      phoneFields.forEach((field) => field.classList.toggle('d-none', !isStudent));
      if (!isStudent) {
        form.elements.namedItem('phone_number').value = '';
        form.elements.namedItem('phone_verified').checked = false;
      }
    };
    role.addEventListener('change', updatePhoneVisibility);
    updatePhoneVisibility();
  }
}

function makeField(field, value) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-field';
  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = `field-${field.key}`;
  label.textContent = field.label;
  let input;
  if (field.type === 'textarea') input = document.createElement('textarea');
  else if (field.type === 'select') {
    input = document.createElement('select');
    field.options?.forEach(([optionValue, text]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = text;
      input.append(option);
    });
  } else input = document.createElement('input');
  input.id = `field-${field.key}`;
  input.name = field.key;
  input.className = field.type === 'checkbox' ? 'form-check-input ms-1' : 'form-control';
  if (field.type === 'checkbox') {
    input.type = 'checkbox';
    input.checked = value === undefined ? field.defaultValue ?? true : Boolean(value);
  } else if (field.type !== 'textarea' && field.type !== 'select') {
    input.type = field.type || 'text';
    input.required = Boolean(field.required);
    if (field.minLength) input.minLength = field.minLength;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    if (field.key === 'password' && editingId) input.required = false;
    if (field.pattern) input.pattern = field.pattern;
    if (field.maxLength) input.maxLength = field.maxLength;
    input.value = value ?? '';
  } else if (field.type === 'textarea') {
    input.required = Boolean(field.required);
    input.value = value ?? '';
    input.rows = 3;
  } else input.value = value ?? field.options?.[0]?.[0] ?? '';
  if (field.type === 'checkbox') wrap.append(label, input);
  else wrap.append(label, input);
  if (field.helpText) {
    const help = document.createElement('small');
    help.className = 'form-text text-secondary';
    help.textContent = field.helpText;
    wrap.append(help);
  }
  return wrap;
}

async function addSelectField(key, labelText, endpoint, labeler, multiple = false, selected = '', required = true) {
  const generation = formGeneration;
  pendingSelectLoads += 1;
  const wrap = makeField({ key, label: labelText, type: 'select' });
  const select = wrap.querySelector('select');
  select.replaceChildren();
  select.multiple = multiple;
  select.required = required;
  select.disabled = true;
  if (multiple) select.size = 5;
  try {
    const { items } = await App.api(endpoint);
    if (generation !== formGeneration) return;
    if (!multiple && !required) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'Không liên kết';
      select.append(empty);
    }
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = labeler ? labeler(item) : `${item.code || ''} ${item.title || item.name || item.full_name || ''}`.trim();
      if (String(item.id) === String(selected)) option.selected = true;
      select.append(option);
    });
    if (!items.length && required) {
      const option = document.createElement('option');
      option.textContent = 'Chưa có dữ liệu — hãy tạo danh mục trước';
      option.disabled = true;
      select.append(option);
    }
    select.disabled = !items.length && required;
  } catch (error) {
    if (generation === formGeneration) App.showAlert(error.message);
  } finally {
    if (generation === formGeneration) {
      pendingSelectLoads -= 1;
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = pendingSelectLoads > 0;
    }
  }
  if (generation === formGeneration) form.append(wrap);
}

async function save(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if ([...form.querySelectorAll('select')].some((select) => select.disabled || (select.required && !select.value))) {
    App.showAlert('Hãy tạo các danh mục liên quan trước khi tiếp tục.');
    return;
  }
  const resource = resourceSelect.value;
  const button = form.querySelector('button[type="submit"]');
  const body = {};
  new FormData(form).forEach((value, key) => { body[key] = value; });
  form.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => { body[checkbox.name] = checkbox.checked; });
  form.querySelectorAll('select[multiple]').forEach((select) => {
    body[select.name] = [...select.selectedOptions].map((option) => option.value);
  });
  let endpoint = `/api/admin/${resource}`;
  let method = editingId ? 'PUT' : 'POST';
  if (resource === 'assignments') endpoint = '/api/admin/assignments';
  if (resource === 'surveys') {
    body.starts_at = new Date(body.starts_at).toISOString();
    body.ends_at = new Date(body.ends_at).toISOString();
  }
  if (resource === 'enrollments') endpoint = '/api/admin/enrollments';
  if (resource === 'policy') {
    endpoint = '/api/admin/policy';
    method = 'PUT';
  }
  if (resource === 'users' && !body.lecturer_id) body.lecturer_id = null;
  if (resource === 'users' && !body.password) delete body.password;
  if (editingId) endpoint += `/${editingId}`;
  App.setBusy(button, true);
  try {
    const result = await App.api(endpoint, { method, body: JSON.stringify(body) });
    App.showAlert(result.message, 'success');
    editingId = null;
    renderForm();
    await loadList();
  } catch (error) {
    App.showAlert(error.message);
    App.setBusy(button, false);
  }
}

async function loadList() {
  const resource = resourceSelect.value;
  const head = document.getElementById('admin-head');
  const body = document.getElementById('admin-body');
  const status = document.getElementById('list-status');
  head.replaceChildren();
  body.replaceChildren();
  status.textContent = 'Đang tải…';
  try {
    let endpoint = `/api/admin/${resource}`;
    if (resource === 'assignments' || resource === 'surveys') endpoint += '/list';
    if (resource === 'enrollments') endpoint = '/api/admin/enrollments/list';
    const response = await App.api(endpoint);
    const items = resource === 'policy' ? [response.policy] : response.items;
    const columns = resource === 'policy' ? ['scope', 'max_submissions', 'allow_revisions', 'min_report_responses'] :
      resource === 'users' ? ['id', 'full_name', 'email', 'role', 'phone_number', 'phone_verified', 'is_active'] :
      resource === 'assignments' ? ['id', 'lecturer_name', 'course_title', 'class_name', 'academic_year', 'semester'] :
      resource === 'surveys' ? ['id', 'title', 'course_title', 'class_name', 'status', 'ends_at'] :
      resource === 'enrollments' ? ['full_name', 'email', 'class_name'] :
      resource === 'lecturer-questions' ? ['id', 'lecturer_name', 'course_title', 'class_name', 'text', 'category', 'is_required', 'is_active'] :
      ['id', ...(fieldSets[resource] || []).map((field) => field.key)];
    const labels = { id: 'ID', full_name: 'Họ và tên', department: 'Khoa / bộ môn', email: 'Email', code: 'Mã', title: 'Tên', description: 'Mô tả', name: 'Tên lớp', academic_year: 'Năm học', semester: 'Học kỳ', text: 'Nội dung câu hỏi', category: 'Nhóm', is_active: 'Hoạt động', is_required: 'Bắt buộc', role: 'Vai trò', lecturer_id: 'ID giảng viên', lecturer_name: 'Giảng viên', course_title: 'Học phần', class_name: 'Lớp', status: 'Trạng thái', ends_at: 'Hạn kết thúc', class_id: 'ID lớp', scope: 'Phạm vi', max_submissions: 'Số lần gửi tối đa', allow_revisions: 'Cho phép chỉnh sửa', min_report_responses: 'Ngưỡng báo cáo', phone_number: 'Điện thoại khôi phục', phone_verified: 'Đã xác minh điện thoại' };
    const header = document.createElement('tr');
    [...columns.map((key) => labels[key] || key), 'Thao tác'].forEach((text) => {
      const th = document.createElement('th');
      th.textContent = text;
      header.append(th);
    });
    head.append(header);
    items.forEach((item) => {
      const row = document.createElement('tr');
      columns.forEach((key) => {
        const cell = document.createElement('td');
        let value = item[key];
        if (key === 'is_active') value = item.is_active ? 'Đang hoạt động' : 'Đã khóa';
        if (key === 'phone_verified') value = item.phone_verified ? 'Đã xác minh' : 'Chưa xác minh';
        if (key === 'allow_revisions') value = item.allow_revisions ? 'Có' : 'Không';
        if (key === 'is_required') value = item.is_required ? 'Có' : 'Không';
        if (key === 'scope') value = item.scope === 'survey' ? 'Theo từng khảo sát' : 'Theo phân công và học kỳ';
        if (key === 'role') value = ({ admin: 'Quản trị viên', lecturer: 'Giảng viên', student: 'Sinh viên' })[value] || value;
        cell.textContent = value ?? '—';
        row.append(cell);
      });
      const actions = document.createElement('td');
      if (resource === 'users') {
        const edit = makeActionButton('Sửa', 'btn-outline-primary', () => {
          editingId = item.id;
          renderForm(item);
          heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const toggle = makeActionButton(item.is_active ? 'Khóa' : 'Mở', item.is_active ? 'btn-outline-danger' : 'btn-outline-success', async () => {
          const result = await App.api(`/api/admin/users/${item.id}/status`, { method: 'PUT', body: JSON.stringify({ is_active: !item.is_active }) });
          await loadList();
          return result;
        });
        actions.append(edit, document.createTextNode(' '), toggle);
      } else if (fieldSets[resource]) {
        const edit = makeActionButton('Sửa', 'btn-outline-primary', () => {
          editingId = item.id;
          renderForm(item);
          heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const remove = makeActionButton('Xóa', 'btn-outline-danger', async () => {
          if (!window.confirm('Bạn có chắc muốn xóa dữ liệu này?')) return;
          const result = await App.api(`/api/admin/${resource}/${item.id}`, { method: 'DELETE' });
          await loadList();
          return result;
        });
        actions.append(edit, document.createTextNode(' '), remove);
      } else if (resource === 'assignments') {
        actions.append(makeActionButton('Xóa', 'btn-outline-danger', async () => {
          if (!window.confirm('Xóa phân công giảng dạy này?')) return;
          const result = await App.api(`/api/admin/assignments/${item.id}`, { method: 'DELETE' });
          await loadList();
          return result;
        }));
      } else if (resource === 'surveys') {
        actions.append(makeActionButton(item.status === 'open' ? 'Đóng' : 'Mở', item.status === 'open' ? 'btn-outline-danger' : 'btn-outline-success', async () => {
          const status = item.status === 'open' ? 'closed' : 'open';
          const result = await App.api(`/api/admin/surveys/${item.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
          await loadList();
          return result;
        }));
      } else if (resource === 'enrollments') {
        actions.append(makeActionButton('Gỡ khỏi lớp', 'btn-outline-danger', async () => {
          if (!window.confirm('Gỡ sinh viên này khỏi lớp?')) return;
          const result = await App.api(`/api/admin/enrollments/${item.class_id}/${item.student_id}`, { method: 'DELETE' });
          await loadList();
          return result;
        }));
      }
      row.append(actions);
      body.append(row);
    });
    status.textContent = `${items.length} mục`;
    if (!items.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = columns.length + 1;
      cell.className = 'text-secondary py-4';
      cell.textContent = 'Chưa có dữ liệu.';
      row.append(cell);
      body.append(row);
    }
  } catch (error) {
    status.textContent = '';
    App.showAlert(error.message);
  }
}

function makeActionButton(text, style, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-sm ${style}`;
  button.textContent = text;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await action();
      if (result?.message) App.showAlert(result.message, 'success');
    } catch (error) {
      App.showAlert(error.message);
      button.disabled = false;
    }
  });
  return button;
}
