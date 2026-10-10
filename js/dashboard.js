document.addEventListener('DOMContentLoaded', async () => {
  try {
    const user = await App.currentUser();
    if (!user) return;
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-greeting').textContent = `${user.name} · ${roleName(user.role)}`;
    document.getElementById('reports-link').classList.remove('d-none');
    if (user.role === 'admin') {
      document.getElementById('admin-link').classList.remove('d-none');
      document.getElementById('manage-button').classList.remove('d-none');
    }
    if (user.role === 'student') {
      document.getElementById('overview-section').classList.add('d-none');
      document.getElementById('charts-section').classList.add('d-none');
      document.getElementById('student-section').classList.remove('d-none');
      document.getElementById('dashboard-description').textContent = 'Chia sẻ phản hồi để góp phần nâng cao chất lượng giảng dạy.';
      await loadSurveys();
      return;
    }
    await loadOverview();
    await loadCharts(user.role);
  } catch (error) {
    App.showAlert(error.message);
  }
});

function roleName(role) {
  return ({ admin: 'Quản trị viên', lecturer: 'Giảng viên', student: 'Sinh viên' })[role] || role;
}

async function loadOverview() {
  const data = await App.api('/api/overview');
  const values = {
    'stat-courses': data.courses,
    'stat-classes': data.classes,
    'stat-lecturers': data.lecturers,
    'stat-surveys': data.activeSurveys,
    'stat-responses': data.responses
  };
  Object.entries(values).forEach(([id, value]) => {
    document.getElementById(id).textContent = value ?? '—';
  });
  document.getElementById('stat-average').textContent = data.averageScore === null ? '—' : Number(data.averageScore).toFixed(2);
}

async function loadSurveys() {
  const { surveys } = await App.api('/api/surveys/available');
  const list = document.getElementById('survey-list');
  if (!surveys.length) {
    const empty = document.createElement('div');
    empty.className = 'col-12';
    empty.innerHTML = '<div class="panel text-secondary">Hiện chưa có khảo sát nào dành cho lớp của bạn.</div>';
    list.append(empty);
    return;
  }
  for (const survey of surveys) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-xl-4';
    const card = document.createElement('article');
    card.className = 'panel survey-card';
    const title = document.createElement('h3');
    title.className = 'h5';
    title.textContent = survey.title;
    const detail = document.createElement('p');
    detail.className = 'text-secondary';
    detail.textContent = `${survey.course_title} · ${survey.lecturer_name} · ${survey.class_name}`;
    const status = document.createElement('p');
    status.className = survey.submitted ? 'text-success small' : 'text-secondary small';
    status.textContent = survey.submitted ? 'Bạn đã gửi phản hồi ẩn danh.' : `Hạn gửi: ${formatDate(survey.ends_at)}`;
    card.append(title, detail, status);
    if (!survey.submitted) {
      const link = document.createElement('a');
      link.className = 'btn btn-primary btn-sm';
      link.href = `/main/evaluate.html?id=${encodeURIComponent(survey.id)}`;
      link.textContent = 'Đánh giá ngay';
      card.append(link);
    }
    col.append(card);
    list.append(col);
  }
}

async function loadCharts(role) {
  if (!window.Chart) return;
  const { reports } = await App.api('/api/reports');
  const scores = new Map();
  const lecturers = new Map();
  const distribution = [0, 0, 0, 0, 0];
  for (const report of reports) {
    for (const question of report.questions) {
      const current = scores.get(question.category) || { total: 0, count: 0 };
      current.total += question.average * report.responses;
      current.count += report.responses;
      scores.set(question.category, current);
      question.distribution.forEach((count, index) => { distribution[index] += count; });
    }
    if (!lecturers.has(report.lecturer)) lecturers.set(report.lecturer, { total: 0, count: 0 });
    const lecturer = lecturers.get(report.lecturer);
    for (const question of report.questions) {
      lecturer.total += question.average * report.responses;
      lecturer.count += report.responses;
    }
  }
  const entries = [...scores.entries()].slice(0, 12);
  if (!entries.length) {
    document.getElementById('overview-chart').replaceWith(emptyChartMessage('Chưa có khảo sát đủ phản hồi để hiển thị.'));
    document.getElementById('rating-chart').replaceWith(emptyChartMessage('Chưa có dữ liệu.'));
    document.getElementById('lecturer-chart').replaceWith(emptyChartMessage('Chưa có dữ liệu.'));
    return;
  }
  new Chart(document.getElementById('overview-chart'), {
    type: 'bar',
    data: {
      labels: entries.map(([label]) => label),
      datasets: [{ label: 'Điểm trung bình (1–5)', data: entries.map(([, value]) => value.total / value.count), backgroundColor: '#3c8bc4', borderRadius: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
  });
  new Chart(document.getElementById('rating-chart'), {
    type: 'doughnut',
    data: { labels: ['1', '2', '3', '4', '5'], datasets: [{ data: distribution, backgroundColor: ['#c94b4b', '#e08b55', '#e5c45d', '#6da9a2', '#3c8bc4'] }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
  const lecturerEntries = [...lecturers.entries()].filter(([, value]) => value.count);
  new Chart(document.getElementById('lecturer-chart'), {
    type: 'bar',
    data: { labels: lecturerEntries.map(([name]) => name), datasets: [{ label: 'Điểm trung bình (1–5)', data: lecturerEntries.map(([, value]) => value.total / value.count), backgroundColor: '#3c8bc4', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
  });
  if (role === 'lecturer' && lecturerEntries.length === 1) {
    document.querySelector('#lecturer-chart').setAttribute('aria-label', `Điểm trung bình của ${lecturerEntries[0][0]}`);
  }
}

function emptyChartMessage(text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'text-secondary text-center py-5';
  paragraph.textContent = text;
  return paragraph;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('vi-VN');
}
