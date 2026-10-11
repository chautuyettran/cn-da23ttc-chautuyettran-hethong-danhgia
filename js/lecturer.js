(() => {
  const lecturerStats = document.getElementById('lecturer-stats');
  if (!lecturerStats) return;

  const state = { assignments: [], surveys: [], questions: [], charts: {} };
  const palette = ['#174a7e', '#2b8a70', '#e6a23c', '#a14f76', '#6574cd', '#4d9fbd'];

  async function init() {
    try {
      const { user } = await App.api('/api/auth/me');
      if (user.role !== 'lecturer') {
        window.location.replace('/');
        return;
      }
      document.getElementById('lecturer-name').textContent = user.name || user.email;
      await Promise.all([loadAssignments(), loadSurveys()]);
      populateFilters();
      bindEvents();
      await Promise.all([loadAnalytics(), loadQuestions()]);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.replace('/main/login.html');
      } else {
        showError(error);
      }
    }
  }

  function showError(error) {
    App.showAlert(error.message || 'Không thể tải dữ liệu. Vui lòng thử lại.', 'danger');
  }

  async function loadAssignments() {
    const result = await App.api('/api/lecturer/assignments');
    state.assignments = result.assignments;
  }

  async function loadSurveys() {
    const result = await App.api('/api/lecturer/surveys');
    state.surveys = result.surveys;
  }

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function populateFilters() {
    const courses = [...new Map(state.assignments.map((item) => [item.courseId, item])).values()];
    const courseFilter = document.getElementById('filter-course');
    const assignmentFilter = document.getElementById('question-filter-assignment');
    const assignmentInput = document.getElementById('question-assignment');
    for (const assignment of courses) {
      const label = `${assignment.courseCode} - ${assignment.courseName}`;
      addOption(courseFilter, assignment.courseId, label);
      addOption(assignmentFilter, assignment.courseId, label);
    }
    for (const assignment of state.assignments) {
      addOption(assignmentInput, assignment.assignmentId, `${assignment.courseCode} - ${assignment.courseName} (${assignment.className})`);
    }
    for (const survey of state.surveys) {
      const label = `${survey.title}${survey.status === 'draft' ? ' (bản nháp)' : ''}`;
      addOption(document.getElementById('filter-survey'), survey.id, label);
      if (survey.status === 'draft') addOption(document.getElementById('question-survey'), survey.id, label);
    }
    const years = [...new Set(state.assignments.map((item) => item.academicYear).filter(Boolean))];
    const semesters = [...new Set(state.assignments.map((item) => item.semester).filter(Boolean))];
    years.sort((a, b) => b.localeCompare(a)).forEach((value) => addOption(document.getElementById('filter-year'), value, value));
    semesters.sort().forEach((value) => addOption(document.getElementById('filter-semester'), value, value));
  }

  function bindEvents() {
    ['filter-course', 'filter-year', 'filter-semester', 'filter-survey'].forEach((id) => {
      document.getElementById(id).addEventListener('change', loadAnalytics);
    });
    document.getElementById('question-filter-assignment').addEventListener('change', loadQuestions);
    document.getElementById('question-form').addEventListener('submit', createQuestion);
    document.getElementById('lecturer-question-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-question-toggle]');
      if (button) {
        setQuestionActive(button.dataset.questionToggle, button.dataset.active === 'true');
        return;
      }
      const editButton = event.target.closest('[data-question-edit]');
      if (editButton) {
        const editForm = document.getElementById(`edit-question-${editButton.dataset.questionEdit}`);
        editForm.hidden = !editForm.hidden;
        return;
      }
      const deleteButton = event.target.closest('[data-question-delete]');
      if (deleteButton) deleteQuestion(deleteButton.dataset.questionDelete);
      const cancelButton = event.target.closest('[data-question-cancel]');
      if (cancelButton) {
        document.getElementById(`edit-question-${cancelButton.dataset.questionCancel}`).hidden = true;
      }
    });
    document.getElementById('lecturer-question-list').addEventListener('submit', (event) => {
      const editForm = event.target.closest('[data-question-edit-form]');
      if (editForm) updateQuestion(event, editForm);
    });
  }

  function selectedFilters() {
    const params = new URLSearchParams();
    const filters = {
      courseId: 'filter-course',
      academicYear: 'filter-year',
      semester: 'filter-semester',
      surveyId: 'filter-survey'
    };
    for (const [key, id] of Object.entries(filters)) {
      const value = document.getElementById(id).value;
      if (value) params.set(key, value);
    }
    return params.toString();
  }

  async function loadAnalytics() {
    const query = selectedFilters();
    try {
      const result = await App.api(`/api/lecturer/analytics${query ? `?${query}` : ''}`);
      renderAnalytics(result);
    } catch (error) {
      showError(error);
    }
  }

  function statCard(label, value, note) {
    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-xl-3';
    const card = document.createElement('article');
    card.className = 'panel h-100';
    const title = document.createElement('p');
    title.className = 'small text-secondary mb-1';
    title.textContent = label;
    const amount = document.createElement('p');
    amount.className = 'display-6 fw-semibold mb-1';
    amount.textContent = value;
    const detail = document.createElement('p');
    detail.className = 'small text-secondary mb-0';
    detail.textContent = note;
    card.append(title, amount, detail);
    col.append(card);
    return col;
  }

  function renderAnalytics(result) {
    lecturerStats.replaceChildren(
      statCard('Môn học được phân công', String(result.summary.courseCount), 'Trong bộ lọc hiện tại'),
      statCard('Lớp học phần', String(result.summary.assignmentCount), 'Trong bộ lọc hiện tại'),
      statCard('Lượt đánh giá hợp lệ', String(result.summary.responseCount), 'Đã áp dụng ngưỡng riêng tư'),
      statCard('Tỷ lệ phản hồi', result.summary.responseRate == null ? '—' : `${result.summary.responseRate.toFixed(2)}%`, `${result.summary.eligibleStudents} lượt sinh viên đủ điều kiện`),
      statCard('Điểm trung bình chung', result.summary.averageScore == null ? '—' : result.summary.averageScore.toFixed(2), 'Thang điểm 1–5')
    );

    const criteria = result.criteria || [];
    const ratingDistribution = result.ratingDistribution || [0, 0, 0, 0, 0];
    const hasRatings = ratingDistribution.some((count) => count > 0);
    showChartOrEmpty('criteria', criteria.length > 0);
    showChartOrEmpty('rating', hasRatings);
    if (criteria.length) {
      drawChart('criteria', 'bar', criteria.map((item) => item.label), [{
        label: 'Điểm trung bình',
        data: criteria.map((item) => item.averageScore),
        backgroundColor: palette[0],
        borderRadius: 5
      }], { indexAxis: 'y', scales: { x: { min: 0, max: 5, ticks: { stepSize: 1 } } } });
    } else destroyChart('criteria');
    if (hasRatings) {
      drawChart('rating', 'doughnut', ['1', '2', '3', '4', '5'], [{
        data: ratingDistribution,
        backgroundColor: palette.slice(0, 5),
        borderWidth: 0
      }], { plugins: { legend: { position: 'bottom' } } });
    } else destroyChart('rating');
    const summary = document.getElementById('course-summary');
    summary.replaceChildren();
    if (result.groups.length) {
      result.groups.slice(0, 3).forEach((group) => {
        summary.append(statCard(`${group.courseCode} · ${group.className}`, group.averageScore == null ? '—' : group.averageScore.toFixed(2), `${group.responseCount} lượt đánh giá`));
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'col-12 text-secondary';
      empty.textContent = 'Chưa có đợt đánh giá đạt ngưỡng để hiển thị.';
      summary.append(empty);
    }
    renderComparison(result.comparison || []);
    document.getElementById('feedback-note').textContent = result.feedbackCount
      ? `${result.feedbackCount} nhận xét đã được ghi nhận. Nội dung phản hồi cá nhân không được hiển thị trong cổng giảng viên.`
      : 'Chưa có nhận xét đạt ngưỡng để hiển thị.';
  }

  function showChartOrEmpty(name, hasData) {
    document.getElementById(`${name}-empty`).classList.toggle('d-none', hasData);
    document.getElementById(`${name}-chart-wrap`).classList.toggle('d-none', !hasData);
  }

  function destroyChart(name) {
    state.charts[name]?.destroy();
    delete state.charts[name];
  }

  function drawChart(name, type, labels, datasets, options = {}) {
    destroyChart(name);
    const canvas = document.getElementById(`${name}-chart`);
    state.charts[name] = new Chart(canvas, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: type !== 'bar', position: 'bottom' } },
        ...options
      }
    });
  }

  function renderComparison(comparison) {
    const table = document.getElementById('comparison-table');
    const hasData = comparison.length > 0;
    document.getElementById('comparison-empty').classList.toggle('d-none', hasData);
    document.getElementById('comparison-chart-wrap').classList.toggle('d-none', !hasData);
    table.replaceChildren();
    if (!hasData) {
      destroyChart('comparison');
      return;
    }
    for (const course of comparison) {
      const row = document.createElement('tr');
      [
        course.courseCode,
        course.courseName,
        `${course.academicYear} / ${course.semester}`,
        String(course.responseCount),
        course.averageScore == null ? '—' : course.averageScore.toFixed(2),
        course.criteria.map((criterion) => `${criterion.label}: ${criterion.averageScore.toFixed(2)}`).join(' · ')
      ].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      table.append(row);
    }
    drawChart('comparison', 'bar', comparison.map((course) => course.courseCode), [{
      label: 'Điểm trung bình',
      data: comparison.map((course) => course.averageScore),
      backgroundColor: comparison.map((_, index) => palette[index % palette.length]),
      borderRadius: 5
    }], { scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } } });
  }

  async function loadQuestions() {
    const courseId = document.getElementById('question-filter-assignment').value;
    const query = courseId ? `?courseId=${encodeURIComponent(courseId)}` : '';
    try {
      const result = await App.api(`/api/lecturer/questions${query}`);
      state.questions = result.questions;
      renderQuestions();
    } catch (error) {
      showError(error);
    }
  }

  function renderQuestions() {
    const list = document.getElementById('lecturer-question-list');
    list.replaceChildren();
    if (!state.questions.length) {
      const empty = document.createElement('p');
      empty.className = 'text-secondary mb-0';
      empty.textContent = 'Chưa có câu hỏi bổ sung.';
      list.append(empty);
      return;
    }
    for (const question of state.questions) {
      const item = document.createElement('div');
      item.className = 'border rounded-3 p-3 d-flex flex-wrap justify-content-between gap-3';
      const content = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'fw-medium mb-1';
      title.textContent = question.text;
      const info = document.createElement('p');
      info.className = 'small text-secondary mb-0';
      info.textContent = `${question.courseCode} · ${question.assignmentClass} · ${question.category}${question.required ? ' · Bắt buộc' : ' · Không bắt buộc'}${question.surveyTitle ? ` · ${question.surveyTitle}` : ''}`;
      const button = document.createElement('button');
      button.className = `btn btn-sm ${question.active ? 'btn-outline-danger' : 'btn-outline-success'}`;
      button.type = 'button';
      button.dataset.questionToggle = question.id;
      button.dataset.active = String(question.active);
      button.textContent = question.active ? 'Ngừng áp dụng' : 'Kích hoạt';
      const editButton = document.createElement('button');
      editButton.className = 'btn btn-sm btn-outline-primary';
      editButton.type = 'button';
      editButton.dataset.questionEdit = question.id;
      editButton.textContent = 'Sửa';
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-sm btn-outline-danger';
      deleteButton.type = 'button';
      deleteButton.dataset.questionDelete = question.id;
      deleteButton.textContent = 'Xóa';
      const actions = document.createElement('div');
      actions.className = 'd-flex flex-wrap gap-2';
      actions.append(button, editButton, deleteButton);
      const editForm = createQuestionEditForm(question);
      content.append(title, info);
      item.append(content, actions, editForm);
      list.append(item);
    }
  }

  async function createQuestion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = document.getElementById('create-question');
    App.setBusy(button, true, 'Đang lưu…');
    try {
      await App.api('/api/lecturer/questions', {
        method: 'POST',
        body: JSON.stringify({
          assignmentId: document.getElementById('question-assignment').value,
          surveyId: document.getElementById('question-survey').value || null,
          text: document.getElementById('question-text').value.trim(),
          category: document.getElementById('question-category').value.trim(),
          description: document.getElementById('question-description').value.trim(),
          required: document.getElementById('question-required').checked
        })
      });
      form.reset();
      App.showAlert('Đã thêm câu hỏi bổ sung.', 'success');
      await Promise.all([loadQuestions(), loadAnalytics()]);
    } catch (error) {
      showError(error);
    } finally {
      App.setBusy(button, false);
    }
  }

  async function setQuestionActive(questionId, currentlyActive) {
    try {
      await App.api(`/api/lecturer/questions/${encodeURIComponent(questionId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !currentlyActive })
      });
      App.showAlert(currentlyActive ? 'Đã ngừng áp dụng câu hỏi.' : 'Đã kích hoạt câu hỏi.', 'success');
      await Promise.all([loadQuestions(), loadAnalytics()]);
    } catch (error) {
      showError(error);
    }
  }

  function createQuestionEditForm(question) {
    const form = document.createElement('form');
    form.id = `edit-question-${question.id}`;
    form.dataset.questionEditForm = question.id;
    form.className = 'w-100 d-grid gap-2';
    form.hidden = true;
    const text = document.createElement('input');
    text.className = 'form-control';
    text.name = 'text';
    text.required = true;
    text.minLength = 5;
    text.maxLength = 1000;
    text.value = question.text;
    text.setAttribute('aria-label', 'Nội dung câu hỏi');
    const category = document.createElement('input');
    category.className = 'form-control';
    category.name = 'category';
    category.required = true;
    category.maxLength = 100;
    category.value = question.category;
    category.setAttribute('aria-label', 'Nhóm câu hỏi');
    const description = document.createElement('textarea');
    description.className = 'form-control';
    description.name = 'description';
    description.maxLength = 500;
    description.value = question.description || '';
    description.setAttribute('aria-label', 'Mô tả');
    const requiredLabel = document.createElement('label');
    requiredLabel.className = 'form-check-label';
    const required = document.createElement('input');
    required.className = 'form-check-input me-2';
    required.type = 'checkbox';
    required.name = 'required';
    required.checked = question.required;
    requiredLabel.append(required, document.createTextNode('Bắt buộc trả lời'));
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-sm btn-primary';
    save.textContent = 'Lưu câu hỏi';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-sm btn-outline-secondary';
    cancel.dataset.questionCancel = question.id;
    cancel.textContent = 'Hủy';
    const actions = document.createElement('div');
    actions.className = 'd-flex gap-2';
    actions.append(save, cancel);
    form.append(text, category, description, requiredLabel, actions);
    return form;
  }

  async function updateQuestion(event, form) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const questionId = form.dataset.questionEditForm;
    const data = new FormData(form);
    try {
      await App.api(`/api/lecturer/questions/${encodeURIComponent(questionId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          text: data.get('text'),
          category: data.get('category'),
          description: data.get('description'),
          required: data.get('required') === 'on'
        })
      });
      App.showAlert('Đã cập nhật câu hỏi.', 'success');
      await Promise.all([loadQuestions(), loadAnalytics()]);
    } catch (error) {
      showError(error);
    }
  }

  async function deleteQuestion(questionId) {
    if (!window.confirm('Xóa câu hỏi bổ sung này?')) return;
    try {
      await App.api(`/api/lecturer/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE' });
      App.showAlert('Đã xóa câu hỏi.', 'success');
      await Promise.all([loadQuestions(), loadAnalytics()]);
    } catch (error) {
      showError(error);
    }
  }

  init();
})();
