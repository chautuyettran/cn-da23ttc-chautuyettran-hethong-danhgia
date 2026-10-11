document.addEventListener('DOMContentLoaded', async () => {
  try {
    const user = await App.currentUser();
    if (!user) return;
    if (user.role !== 'student') {
      window.location.href = '/';
      return;
    }
    const surveyId = new URLSearchParams(window.location.search).get('id');
    if (!surveyId || !/^[a-f\d]{24}$/i.test(surveyId)) throw new Error('Liên kết khảo sát không hợp lệ.');
    const { survey, questions } = await App.api(`/api/surveys/${encodeURIComponent(surveyId)}`);
    document.getElementById('survey-title').textContent = survey.title;
    document.getElementById('survey-description').textContent = `${survey.course_title} · ${survey.lecturer_name}. ${survey.description || ''}`;
    const questionList = document.getElementById('question-list');
    questions.forEach((question, index) => {
      const article = document.createElement('fieldset');
      article.className = 'question-card';
      const legend = document.createElement('legend');
      legend.className = 'fs-6 fw-semibold mb-1';
      legend.textContent = `${index + 1}. ${question.text}`;
      const category = document.createElement('p');
      category.className = 'text-secondary small mb-3';
      category.textContent = question.category;
      const options = document.createElement('div');
      options.className = 'likert-options';
      for (let score = 1; score <= 5; score += 1) {
        const wrapper = document.createElement('div');
        wrapper.className = 'likert-choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `question-${question.id}`;
        input.id = `question-${question.id}-${score}`;
        input.value = String(score);
        input.required = true;
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = String(score);
        label.setAttribute('aria-label', `Điểm ${score}`);
        wrapper.append(input, label);
        options.append(wrapper);
      }
      article.append(legend, category, options);
      questionList.append(article);
    });

    const form = document.getElementById('evaluation-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = document.getElementById('submit-evaluation');
      App.setBusy(button, true, 'Đang gửi…');
      const answers = questions.map((question) => ({
        questionId: question.id,
        score: Number(form.elements[`question-${question.id}`].value)
      }));
      try {
        const result = await App.api(`/api/surveys/${encodeURIComponent(surveyId)}/submit`, {
          method: 'POST',
          body: JSON.stringify({ answers, feedback: form.elements.feedback.value.trim() })
        });
        App.showAlert(
          `${result.message} Lượt đã gửi: ${result.attemptsUsed}/${result.maxSubmissions}; còn ${result.attemptsRemaining}.`,
          'success'
        );
        if (result.attemptsRemaining > 0) {
          App.setBusy(button, false);
          button.textContent = 'Gửi lại đánh giá';
        } else {
          form.replaceChildren();
          const back = document.createElement('a');
          back.className = 'btn btn-outline-primary';
          back.href = '/';
          back.textContent = 'Quay lại danh sách khảo sát';
          form.append(back);
        }
      } catch (error) {
        App.showAlert(error.message);
        App.setBusy(button, false);
      }
    });
  } catch (error) {
    App.showAlert(error.message);
    document.getElementById('submit-evaluation').disabled = true;
  }
});
