// Runs before the page renders so a saved dark theme does not flash light first.
try {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#08131d');
  }
} catch (e) { /* storage unavailable: stay light */ }
