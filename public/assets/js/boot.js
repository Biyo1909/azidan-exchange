/* Runs before first paint: decides whether this load should show the brand intro. */
(function () {
  try {
    var navAt = Number(sessionStorage.getItem('az:nav') || 0);
    var seen = sessionStorage.getItem('az:seen') === '1';
    var navigating = navAt > 0 && Date.now() - navAt < 20000;
    if (navigating || !seen) {
      document.documentElement.classList.add('az-booting');
      document.documentElement.dataset.azIntro = '1';
    }
    sessionStorage.setItem('az:nav', '0');
    sessionStorage.setItem('az:seen', '1');
  } catch (error) { /* storage unavailable — skip the intro */ }
}());
