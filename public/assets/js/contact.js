import { api } from './api.js';
import { $, toast } from './ui.js';

const form = $('#contactForm');
if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#contactError');
    const button = $('#contactSubmit');
    const payload = {
      name: $('#contactName').value.trim(),
      email: $('#contactEmail').value.trim(),
      phone: $('#contactPhone').value.trim(),
      body: $('#contactBody').value.trim(),
    };

    const fail = (message) => {
      error.textContent = message;
      error.classList.add('show');
    };
    error.classList.remove('show');

    if (payload.name.length < 2) return fail('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) return fail('Please enter a valid email address.');
    if (payload.body.length < 10) return fail('Tell us a little more so we can help.');

    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await api('/api/contact', { method: 'POST', body: payload });
      form.hidden = true;
      $('#contactSuccess').hidden = false;
      toast('Message sent. We will reply by email.');
    } catch (err) {
      fail(err.message || 'Could not send your message. Please try again.');
      button.disabled = false;
      button.textContent = 'Send message';
    }
  });
}
