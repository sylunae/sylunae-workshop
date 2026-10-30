// Blocking head script: restore only the small visual cache before the first paint.
// The persisted application settings remain the source of truth.
;(function () {
  var root = document.documentElement
  var cached
  try { cached = JSON.parse(localStorage.getItem('sylunae:startup-theme') || 'null') } catch (_) {}
  var mode = cached && cached.mode
  var effective = mode === 'dark' || mode === 'light' ? mode
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  root.dataset.theme = effective
  root.classList.toggle('dark', effective === 'dark')
  root.style.colorScheme = effective
  var palette = cached && cached.palettes && cached.palettes[effective]
  if (palette) Object.keys(palette).forEach(function (key) {
    if (/^--[a-z-]+$/.test(key) && /^#[0-9a-f]{6}$/i.test(palette[key])) root.style.setProperty(key, palette[key])
  })
  // Cover the interval before the application stylesheet has loaded as well.
  root.style.backgroundColor = root.style.getPropertyValue('--bg') || (effective === 'dark' ? '#171717' : '#ffffff')
  document.querySelector('meta[name="theme-color"]').setAttribute('content', root.style.backgroundColor)
  root.style.backgroundColor = 'var(--bg, ' + root.style.backgroundColor + ')'
})()
