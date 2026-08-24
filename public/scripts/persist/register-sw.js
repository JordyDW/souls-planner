/*!
 * Registers the service worker that makes this copy of the planner work offline.
 *
 * The pages sit at two different depths (/index.html and /darksouls3/index.html), and a relative
 * register() resolves against the *document*, not this script - so the site root is worked out
 * from this script's own URL instead. That also keeps the worker's scope at the site root, which
 * is what lets it serve every game and calculator.
 */
;(function () {
  'use strict'

  if (!('serviceWorker' in navigator)) return

  /* ?nosw bypasses the cache entirely and tears down any worker already installed. Useful while
     editing the code, since the shell is served cache-first and a changed script otherwise keeps
     loading from cache, and it is the way out if a cache ever ends up in a bad state. */
  if (window.location.search.indexOf('nosw') !== -1) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      for (var i = 0; i < registrations.length; i++) registrations[i].unregister()
    })
    if (window.caches && caches.keys) {
      caches.keys().then(function (names) {
        for (var i = 0; i < names.length; i++) {
          if (names[i].indexOf('souls-planner-') === 0) caches['delete'](names[i])
        }
      })
    }
    return
  }

  var self = document.currentScript
  if (!self) {
    var scripts = document.getElementsByTagName('script')
    self = scripts[scripts.length - 1]
  }

  var root = self.src.replace(/public\/scripts\/persist\/register-sw\.js.*$/, '')
  if (root === self.src) return

  /* Talking to the worker: one MessageChannel per request, resolved when it reports done. */
  function ask(message, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!navigator.serviceWorker.controller) {
        reject(new Error('offline support is not active on this page yet'))
        return
      }
      var channel = new MessageChannel()
      channel.port1.onmessage = function (event) {
        var data = event.data || {}
        if (data.type === 'progress') {
          if (onProgress) onProgress(data)
          return
        }
        if (data.type === 'error') reject(new Error(data.message))
        else resolve(data)
      }
      navigator.serviceWorker.controller.postMessage(message, [channel.port2])
    })
  }

  window.SoulsOffline = {
    /* Pull a whole game into the cache up front, so it is there on a train with no signal. */
    warm: function (game, onProgress) {
      return ask({ type: 'sp-warm', game: game }, onProgress)
    },
    status: function () {
      return ask({ type: 'sp-offline-status' })
    }
  }

  /* A game page whose bundle never arrived renders as an empty shell - dropdowns with nothing in
     them and no numbers. Better to say why than to leave it looking broken. */
  function warnIfBundleMissing() {
    if (!document.querySelector('.planner, .calculator')) return
    if (window.DarkSouls || window.DarkSouls2 || window.DarkSouls3) return

    /* Deliberately not branching on navigator.onLine: it only reports whether the machine has a
       network at all, not whether this site is reachable, so it happily says "online" while every
       request fails. One message that covers both, and the two things worth doing about it. */
    var banner = document.createElement('div')
    banner.className = 'sp-offline-banner'
    banner.appendChild(
      document.createTextNode("This page's game data could not be loaded, and it is not saved for offline use. ")
    )

    var retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = 'Retry'
    retry.addEventListener('click', function () {
      window.location.reload()
    })
    banner.appendChild(retry)

    banner.appendChild(document.createTextNode(' or '))

    var home = document.createElement('a')
    home.href = root + 'index.html'
    home.textContent = 'save this game for offline use'
    banner.appendChild(home)
    banner.appendChild(document.createTextNode('.'))

    document.body.insertBefore(banner, document.body.firstChild)
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(root + 'sw.js', { scope: root }).then(
      function (registration) {
        /* A worker waiting from a previous visit is handed over now, at load, rather than left
           waiting for every tab to close - which was the bug: "reload to update" does not
           activate a waiting worker, so a phone could sit on a months-old build forever. Doing it
           here rather than mid-session means nothing is running that could notice. */
        if (registration.waiting) registration.waiting.postMessage({ type: 'sp-skip-waiting' })

        registration.addEventListener('updatefound', function () {
          var incoming = registration.installing
          if (!incoming) return
          incoming.addEventListener('statechange', function () {
            if (incoming.state !== 'installed') return

            /* No controller means this is the first install, and it is already in charge. */
            if (!navigator.serviceWorker.controller) return

            /* Still not swapping bundles under a planner that is already running: it is told to
               step aside for the next load, and you are told it is there. */
            if (registration.waiting) registration.waiting.postMessage({ type: 'sp-skip-waiting' })
            if (window.SoulsPersist && window.SoulsPersist.toast) {
              window.SoulsPersist.toast('New version ready - reload to use it')
            }
          })
        })
      },
      function (error) {
        if (window.console && console.warn) {
          console.warn('[souls-persist] service worker not registered: ' + error.message)
        }
      }
    )

    warnIfBundleMissing()
  })
})()
