/*!
 * The "save this game for offline use" list on the home page.
 *
 * Pages and shared assets are cached automatically, but the game bundles are not: Dark Souls 3
 * alone is 11MB, and nobody wants that downloaded because they glanced at the home page. So a
 * game is cached either by opening it, or deliberately from here - which is the one that works
 * when you want everything ready before losing signal.
 */
;(function () {
  'use strict'

  var GAMES = [
    { id: 'DarkSouls', label: 'Dark Souls', size: '3.2 MB' },
    { id: 'DarkSouls2', label: 'Dark Souls 2', size: '0.5 MB' },
    { id: 'DarkSouls3', label: 'Dark Souls 3', size: '11 MB' }
  ]

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }

  function render() {
    var section = el('section', 'sp-offline')
    section.appendChild(el('h2', null, 'Available offline'))
    section.appendChild(
      el('p', null, 'Pages are always kept. Game data is only kept once you open a game, or save it here.')
    )

    GAMES.forEach(function (game) {
      var row = el('div', 'sp-offline__row')
      row.appendChild(el('span', 'sp-offline__name', game.label + ' · ' + game.size))

      var state = el('span', 'sp-offline__state', 'checking…')
      var button = el('button', null, 'Save for offline')
      button.type = 'button'
      button.disabled = true

      button.addEventListener('click', function () {
        button.disabled = true
        state.textContent = 'saving…'
        window.SoulsOffline.warm(game.id, function (progress) {
          state.textContent = 'saving ' + progress.done + '/' + progress.total + '…'
        }).then(
          function () {
            state.textContent = 'saved'
            state.className = 'sp-offline__state sp-offline__state--ready'
            button.textContent = 'Saved'
          },
          function (error) {
            state.textContent = error.message
            button.disabled = false
          }
        )
      })

      row.appendChild(state)
      row.appendChild(button)
      row.setAttribute('data-game', game.id)
      section.appendChild(row)
    })

    document.body.appendChild(section)
    return section
  }

  function refresh(section) {
    if (!window.SoulsOffline) return
    window.SoulsOffline.status().then(function (result) {
      result.games.forEach(function (row) {
        var host = section.querySelector('[data-game="' + row.game + '"]')
        if (!host) return
        var state = host.querySelector('.sp-offline__state')
        var button = host.querySelector('button')
        var ready = row.have === row.total
        state.textContent = ready ? 'saved' : row.have ? row.have + '/' + row.total + ' saved' : 'not saved'
        state.className = 'sp-offline__state' + (ready ? ' sp-offline__state--ready' : '')
        button.textContent = ready ? 'Saved' : 'Save for offline'
        button.disabled = ready
      })
    }, function () {})
  }

  window.addEventListener('load', function () {
    if (!('serviceWorker' in navigator)) return
    var section = render()

    /* On a first visit the worker is installing and controls nothing yet, so there is no one to
       ask until it takes over. */
    if (navigator.serviceWorker.controller) {
      refresh(section)
    } else {
      section.querySelectorAll('.sp-offline__state').forEach(function (state) {
        state.textContent = 'available after a reload'
      })
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        refresh(section)
      })
    }
  })
})()
