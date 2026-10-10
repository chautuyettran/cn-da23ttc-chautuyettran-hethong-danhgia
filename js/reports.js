const reportCharts = [];
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('print-report').addEventListener('click', () => window.print());
  document.getElementById('report-filter').addEventListener('submit', (event) => {
    event.preventDefault();
    loadReports();
  });
  document.getElementById('export-csv').addEventListener('click', exportCsv);
  try {
    const user = await App.currentUser();
    if (!user) return;
    if (!['admin', 'lecturer'].includes(user.role)) {
      window.location.href = '/';
      return;
    }
    if (user.role === 'admin') {
      document.getElementById('lecturer-filter-wrap').classList.remove('d-none');
      const { lecturers } = await App.api('/api/reports/lecturers');
      const select = document.getElementById('lecturer-filter');
      lecturers.forEach((lecturer) => {
        const option = document.createElement('option');
        option.value = lecturer.id;
        option.textContent = `${lecturer.full_name} · ${lecturer.department}`;
        select.append(option);
      });
    }
    const { courses } = await App.api('/api/reports/courses');
    const courseSelect = document.getElementById('course-filter');
    courses.forEach((course) => {
      const option = document.createElement('option');
      option.value = course.id;
      option.textContent = `${course.code} · ${course.title}`;
      courseSelect.append(option);
    });
    await loadReports();
  } catch (error) {
    App.showAlert(error.message);
  }
});

async function loadReports() {
  const button = document.querySelector('#report-filter button[type="submit"]');
  App.setBusy(button, true, 'Đang lọc…');
  const params = new URLSearchParams();
  const values = {
    lecturerId: document.getElementById('lecturer-filter').value,
    courseId: document.getElementById('course-filter').value,
    from: document.getElementById('from-filter').value,
    to: document.getElementById('to-filter').value,
    academicYear: document.getElementById('year-filter').value.trim(),
    semester: document.getElementById('semester-filter').value.trim()
  };
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
  try {
    const { reports, minimumResponses } = await App.api(`/api/reports?${params.toString()}`);
    renderReports(reports, minimumResponses);
  } catch (error) {
    App.showAlert(error.message);
  } finally {
    App.setBusy(button, false);
  }
}

async function exportCsv() {
  const button = document.getElementById('export-csv');
  App.setBusy(button, true, 'Đang tạo CSV…');
  const params = new URLSearchParams();
  const values = {
    lecturerId: document.getElementById('lecturer-filter').value,
    courseId: document.getElementById('course-filter').value,
    from: document.getElementById('from-filter').value,
    to: document.getElementById('to-filter').value,
    academicYear: document.getElementById('year-filter').value.trim(),
    semester: document.getElementById('semester-filter').value.trim()
  };
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
  try {
    const response = await fetch(`/api/reports/export.csv?${params.toString()}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Không thể tải báo cáo (${response.status}).`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'teaching-quality-report.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    App.showAlert(error.message);
  } finally {
    App.setBusy(button, false);
  }
}

function renderReports(reports, minimumResponses) {
  reportCharts.splice(0).forEach((chart) => chart.destroy());
  const list = document.getElementById('report-list');
  const summary = document.getElementById('report-summary');
  list.replaceChildren();
  summary.textContent = `${reports.length} khảo sát · Các kết quả chỉ hiển thị khi có ít nhất ${minimumResponses} phản hồi để bảo vệ quyền riêng tư.`;
  if (!reports.length) {
    const empty = document.createElement('article');
    empty.className = 'panel text-secondary';
    empty.textContent = 'Không có báo cáo phù hợp với bộ lọc.';
    list.append(empty);
    return;
  }
  reports.forEach((report, index) => {
    const panel = document.createElement('article');
    panel.className = 'panel report-card';
    const title = document.createElement('h2');
    title.className = 'h5';
    title.textContent = report.title;
    const details = document.createElement('p');
    details.className = 'text-secondary';
    details.textContent = `${report.courseCode} · ${report.course} · ${report.class} · ${report.lecturer} · ${report.department} · ${report.academicYear} · ${report.semester} · ${formatDate(report.date)}`;
    const count = document.createElement('p');
    count.className = 'small fw-semibold';
    count.textContent = report.suppressed ? 'Số lượng phản hồi chưa đạt ngưỡng hiển thị.' : `${report.responses} phản hồi`;
    panel.append(title, details, count);
    if (report.suppressed) {
      const muted = document.createElement('p');
      muted.className = 'alert alert-secondary mb-0';
      muted.textContent = 'Kết quả được ẩn vì số lượng phản hồi chưa đạt ngưỡng bảo vệ quyền riêng tư.';
      panel.append(muted);
    } else if (report.questions.length) {
      const categories = new Map();
      report.questions.forEach((question) => {
        const current = categories.get(question.category) || { total: 0, count: 0, distribution: [0, 0, 0, 0, 0] };
        current.total += question.average;
        current.count += 1;
        question.distribution.forEach((count, score) => { current.distribution[score] += count; });
        categories.set(question.category, current);
      });
      const categoryEntries = [...categories.entries()];
      const chartWrap = document.createElement('div');
      chartWrap.className = 'chart-container';
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `Điểm trung bình theo tiêu chí: ${report.title}`);
      chartWrap.append(canvas);
      const doughnutWrap = document.createElement('div');
      doughnutWrap.className = 'chart-container mt-4';
      const doughnut = document.createElement('canvas');
      doughnut.setAttribute('aria-label', `Phân bố điểm khảo sát: ${report.title}`);
      doughnutWrap.append(doughnut);
      const radarWrap = document.createElement('div');
      radarWrap.className = 'chart-container mt-4';
      const radar = document.createElement('canvas');
      radar.setAttribute('aria-label', `Hồ sơ điểm theo tiêu chí: ${report.title}`);
      radarWrap.append(radar);
      panel.append(chartWrap, radarWrap, doughnutWrap);
      reportCharts.push(new Chart(canvas, {
        type: 'bar',
        data: {
          labels: categoryEntries.map(([category]) => category),
          datasets: [{ label: 'Điểm trung bình (1–5)', data: categoryEntries.map(([, value]) => value.total / value.count), backgroundColor: '#3c8bc4', borderRadius: 5 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: { x: { min: 0, max: 5, ticks: { stepSize: 1 } } },
          plugins: { tooltip: { callbacks: { afterLabel: (context) => `Phân bố điểm 1–5: ${categoryEntries[context.dataIndex][1].distribution.join(' · ')}` } } }
        }
      }));
      reportCharts.push(new Chart(doughnut, {
        type: 'doughnut',
        data: {
          labels: ['1', '2', '3', '4', '5'],
          datasets: [{
            label: 'Lượt chọn',
            data: [...categories.values()].reduce((totals, category) => totals.map((count, index) => count + category.distribution[index]), [0, 0, 0, 0, 0]),
            backgroundColor: ['#c94b4b', '#e08b55', '#e5c45d', '#6da9a2', '#3c8bc4']
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      }));
      reportCharts.push(new Chart(radar, {
        type: 'radar',
        data: {
          labels: categoryEntries.map(([category]) => category),
          datasets: [{
            label: `Điểm trung bình · ${report.lecturer}`,
            data: categoryEntries.map(([, value]) => value.total / value.count),
            backgroundColor: 'rgb(60 139 196 / 20%)',
            borderColor: '#3c8bc4',
            pointBackgroundColor: '#1769aa'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 5, ticks: { stepSize: 1 } } } }
      }));
    }
    list.append(panel);
  });
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN');
}
