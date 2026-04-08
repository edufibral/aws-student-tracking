const apiInput = document.querySelector('#apiBaseUrl');
const saveConfigBtn = document.querySelector('#saveConfigBtn');
const output = document.querySelector('#output');

const forms = {
  studentForm: '/students',
  programForm: '/programs',
  courseForm: '/courses',
  gradeForm: '/grades'
};

const readRoutes = {
  students: '/students',
  programs: '/programs',
  courses: '/courses',
  grades: '/grades'
};

const savedBaseUrl = localStorage.getItem('student-tracker-api-url') || '';
apiInput.value = savedBaseUrl;

saveConfigBtn.addEventListener('click', () => {
  localStorage.setItem('student-tracker-api-url', apiInput.value.trim());
  render({ message: 'Base URL saved.' });
});

const getBaseUrl = () => {
  const baseUrl = apiInput.value.trim();
  if (!baseUrl) {
    throw new Error('Set API Base URL first.');
  }
  return baseUrl.replace(/\/$/, '');
};

const request = async (path, options = {}) => {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
};

const render = (data) => {
  output.textContent = JSON.stringify(data, null, 2);
};

for (const [formId, path] of Object.entries(forms)) {
  const form = document.querySelector(`#${formId}`);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());

    try {
      const result = await request(path, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      render(result);
      form.reset();
    } catch (error) {
      render({ error: error.message });
    }
  });
}

document.querySelectorAll('[data-read]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      const key = button.dataset.read;
      const result = await request(readRoutes[key]);
      render(result);
    } catch (error) {
      render({ error: error.message });
    }
  });
});
