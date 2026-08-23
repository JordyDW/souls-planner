/*!
 * Offline support for the Souls Planner mirror.
 *
 * The point of this repo is a copy of soulsplanner you can use without the network, but the hosted
 * copy still fetched everything on every visit. This worker fixes that with two different
 * strategies, because the assets fall into two very different groups:
 *
 *   - The shell (pages, vendors, fonts, the persistence layer) is a few hundred KB and every visit
 *     needs it, so it is precached on install.
 *   - The game bundles are not: Dark Souls 3 alone is 11MB, Dark Souls 3MB, Dark Souls 2 480KB.
 *     Precaching all of it would mean a 14MB download to read the home page. They are cached the
 *     first time you actually open that game instead, so you never pay for a game you don't play.
 *
 * Bump CACHE_VERSION to force a refresh; activate() then drops every older cache.
 */

var CACHE_VERSION = 'v1'
var SHELL_CACHE = 'souls-planner-shell-' + CACHE_VERSION
var RUNTIME_CACHE = 'souls-planner-runtime-' + CACHE_VERSION

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.ico',

  './darksouls/index.html',
  './darksouls/armor.html',
  './darksouls/itematk.html',
  './darksouls/rangedweaponatk.html',
  './darksouls/spellatk.html',
  './darksouls/weaponatk.html',
  './darksouls/weapondef.html',
  './darksouls/weaponstm.html',

  './darksouls2/index.html',

  './darksouls3/index.html',
  './darksouls3/armor.html',
  './darksouls3/itematk.html',
  './darksouls3/rangedweaponatk.html',
  './darksouls3/spellatk.html',
  './darksouls3/weaponatk.html',
  './darksouls3/weapondef.html',
  './darksouls3/weaponstm.html',

  './public/vendors/vendors.min.css',
  './public/vendors/vendors.min.js',
  './public/vendors/lz-string.min.js',

  './public/fonts/Aclonica.css',
  './public/fonts/Material.css',
  './public/fonts/flUhRq6tzZclQEJ-Vdg-IuiaDsNc.woff2',
  './public/fonts/K2FyfZJVlfNNSEBXGY7UAo8.woff2',

  './public/styles/release/head.min.css',
  './public/styles/release/homePage.min.css',
  './public/scripts/release/head.min.js',
  './public/scripts/release/homePage.min.js',

  './public/scripts/persist/souls-persist.js',
  './public/scripts/persist/register-sw.js',
  './public/scripts/persist/offline-home.js',
  './public/styles/persist/souls-persist.css',

  './public/icons/icon-192.png',
  './public/icons/icon-512.png'
]

/* The heavy per-game bundles, cached on first use rather than up front. */
var LAZY = /\/public\/(scripts|styles)\/release\/DarkSouls[23]?\//

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      /* One bad entry must not fail the whole install, so they are added individually. */
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(url)['catch'](function () {})
        })
      )
    })
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (name === SHELL_CACHE || name === RUNTIME_CACHE) return null
            if (name.indexOf('souls-planner-') !== 0) return null
            return caches['delete'](name)
          })
        )
      })
      .then(function () {
        return self.clients.claim()
      })
  )
})

function cacheFirst(request, cacheName, matchOptions) {
  return caches.match(request, matchOptions).then(function (hit) {
    if (hit) return hit
    return fetch(request).then(function (response) {
      /* Opaque and error responses are not worth keeping. */
      if (!response || response.status !== 200 || response.type !== 'basic') return response
      var copy = response.clone()
      caches.open(cacheName).then(function (cache) {
        cache.put(request, copy)
      })
      return response
    })
  })
}

/* Everything one game needs, for the "save this game for offline use" action. Sizes are why this
   is opt-in rather than automatic: DarkSouls 3.1MB, DarkSouls2 0.5MB, DarkSouls3 10.6MB. */
var GAME_ASSETS = {
  DarkSouls: [
    './public/scripts/release/DarkSouls/armor.min.js',
    './public/scripts/release/DarkSouls/itemATK.min.js',
    './public/scripts/release/DarkSouls/planner.min.js',
    './public/scripts/release/DarkSouls/rangedWeaponATK.min.js',
    './public/scripts/release/DarkSouls/spellATK.min.js',
    './public/scripts/release/DarkSouls/weaponATK.min.js',
    './public/scripts/release/DarkSouls/weaponDEF.min.js',
    './public/scripts/release/DarkSouls/weaponSTM.min.js',
    './public/styles/release/DarkSouls/armor.min.css',
    './public/styles/release/DarkSouls/itemATK.min.css',
    './public/styles/release/DarkSouls/planner.min.css',
    './public/styles/release/DarkSouls/rangedWeaponATK.min.css',
    './public/styles/release/DarkSouls/spellATK.min.css',
    './public/styles/release/DarkSouls/weaponATK.min.css',
    './public/styles/release/DarkSouls/weaponDEF.min.css',
    './public/styles/release/DarkSouls/weaponSTM.min.css'
  ],
  DarkSouls2: [
    './public/scripts/release/DarkSouls2/ds2planner.min.js',
    './public/styles/release/DarkSouls2/planner.min.css'
  ],
  DarkSouls3: [
    './public/scripts/release/DarkSouls3/armor.min.js',
    './public/scripts/release/DarkSouls3/itemATK.min.js',
    './public/scripts/release/DarkSouls3/planner.min.js',
    './public/scripts/release/DarkSouls3/rangedWeaponATK.min.js',
    './public/scripts/release/DarkSouls3/spellATK.min.js',
    './public/scripts/release/DarkSouls3/weaponATK.min.js',
    './public/scripts/release/DarkSouls3/weaponDEF.min.js',
    './public/scripts/release/DarkSouls3/weaponSTM.min.js',
    './public/styles/release/DarkSouls3/armor.min.css',
    './public/styles/release/DarkSouls3/itemATK.min.css',
    './public/styles/release/DarkSouls3/planner.min.css',
    './public/styles/release/DarkSouls3/rangedWeaponATK.min.css',
    './public/styles/release/DarkSouls3/spellATK.min.css',
    './public/styles/release/DarkSouls3/weaponATK.min.css',
    './public/styles/release/DarkSouls3/weaponDEF.min.css',
    './public/styles/release/DarkSouls3/weaponSTM.min.css'
  ]
}

function reply(port, message) {
  if (port) port.postMessage(message)
}

/* Fetches a whole game into the runtime cache, reporting progress so the page can show it. */
function warmGame(game, port) {
  var urls = GAME_ASSETS[game]
  if (!urls) {
    reply(port, { type: 'error', message: 'unknown game: ' + game })
    return Promise.resolve()
  }
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    var done = 0
    /* Sequential on purpose - this is 11MB for Dark Souls 3 and there is no hurry. */
    return urls
      .reduce(function (chain, url) {
        return chain
          .then(function () {
            return cache.match(url).then(function (hit) {
              return hit ? null : cache.add(url)
            })
          })
          .then(function () {
            reply(port, { type: 'progress', done: ++done, total: urls.length })
          })
      }, Promise.resolve())
      .then(function () {
        reply(port, { type: 'done', total: urls.length })
      })
  })
}

function offlineStatus(port) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    var games = Object.keys(GAME_ASSETS)
    return Promise.all(
      games.map(function (game) {
        return Promise.all(
          GAME_ASSETS[game].map(function (url) {
            return cache.match(url)
          })
        ).then(function (hits) {
          var have = 0
          for (var i = 0; i < hits.length; i++) if (hits[i]) have++
          return { game: game, have: have, total: GAME_ASSETS[game].length }
        })
      })
    ).then(function (rows) {
      reply(port, { type: 'status', games: rows })
    })
  })
}

self.addEventListener('message', function (event) {
  var data = event.data || {}
  var port = event.ports && event.ports[0]
  if (data.type === 'sp-warm') event.waitUntil(warmGame(data.game, port))
  else if (data.type === 'sp-offline-status') event.waitUntil(offlineStatus(port))
})

self.addEventListener('fetch', function (event) {
  var request = event.request
  if (request.method !== 'GET') return

  var url
  try {
    url = new URL(request.url)
  } catch (e) {
    return
  }
  if (url.origin !== self.location.origin) return

  /* Compare mode loads this same page with a ?sp-compare=1 query, and a query string is part of
     the cache key by default - so without ignoreSearch those frames would miss the cache and fail
     outright when offline, which is exactly when you would notice. */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(request)['catch'](function () {
          return caches.match('./index.html', { ignoreSearch: true })
        })
      })
    )
    return
  }

  event.respondWith(cacheFirst(request, LAZY.test(url.pathname) ? RUNTIME_CACHE : SHELL_CACHE))
})
