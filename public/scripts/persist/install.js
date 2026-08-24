/*!
 * "Install as an app" button.
 *
 * The manifest and service worker make the site installable, but that only earns a half-hidden
 * item in Chrome's menu that most people never find. This surfaces it: a button that appears
 * exactly when the browser says installation is possible, and disappears once it is installed.
 *
 * It goes in the game tool bar where there is one, and on the home page next to the offline list,
 * so it is reachable whichever page you happen to be on.
 */
;(function () {
  'use strict'

  var deferred = null

  function installed() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true
    /* iOS Safari reports it here instead. */
    return window.navigator.standalone === true
  }

  function button() {
    var node = document.createElement('button')
    node.type = 'button'
    node.className = 'sp-install'
    node.textContent = 'Install app'
    node.title = 'Install this planner as an app, in its own window and available offline'
    node.addEventListener('click', function () {
      if (!deferred) return
      deferred.prompt()
      deferred.userChoice.then(function () {
        /* Chrome only lets a captured prompt be used once, either way. */
        deferred = null
        remove()
      })
    })
    return node
  }

  function remove() {
    var nodes = document.querySelectorAll('.sp-install')
    for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i])
  }

  function show() {
    if (installed() || !deferred || document.querySelector('.sp-install')) return

    /* Its own right-floated list in the nav bar, using the menu's existing mm__right convention,
       so it sits opposite the game and its tools rather than at the end of them. */
    var menu = document.getElementById('main-menu')
    if (menu && menu.querySelector('.mm__horizontal')) {
      var list = document.createElement('ul')
      list.className = 'mm__horizontal mm__right sp-nav__install'
      var item = document.createElement('li')
      item.appendChild(button())
      list.appendChild(item)
      menu.appendChild(list)
    }

    var offline = document.querySelector('.sp-offline h2')
    if (offline && offline.parentNode) offline.parentNode.insertBefore(button(), offline.nextSibling)
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    /* Holding onto the event is what lets us choose where the button lives. */
    event.preventDefault()
    deferred = event
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', show)
    } else {
      show()
    }
  })

  window.addEventListener('appinstalled', function () {
    deferred = null
    remove()
  })

  window.SoulsInstall = {
    available: function () {
      return !!deferred
    },
    installed: installed,
    show: show
  }
})()
