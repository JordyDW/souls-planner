/*!
 * Per-game navigation.
 *
 * The mirror only put the list of a game's tools on its planner page, at the bottom of a very long
 * page. The calculators got nothing at all, so moving between two of them meant going out to the
 * home page and back.
 *
 * That was first fixed with a second bar under the main menu, which meant two bars of chrome: three
 * abbreviated game names on top, the tools underneath. Now it is one bar - the game is a named
 * dropdown and the tools sit beside it. A dropdown for three items is usually worse than three
 * tabs, but here it buys back a whole bar and turns "which game am I in" from a faint underline
 * into a label that says "Dark Souls 3". The click it costs is on the thing you do rarely.
 *
 * Built here rather than in markup so it stays in one place instead of being copy-pasted into
 * nineteen pages that would then drift.
 */
;(function () {
  'use strict'

  var TOOLS = [
    { file: 'index.html', label: 'Planner' },
    { file: 'weaponatk.html', label: 'Weapon ATK' },
    { file: 'weapondef.html', label: 'Weapon DEF' },
    { file: 'rangedweaponatk.html', label: 'Ranged' },
    { file: 'weaponstm.html', label: 'Stamina' },
    { file: 'armor.html', label: 'Armor' },
    { file: 'spellatk.html', label: 'Spells' },
    { file: 'itematk.html', label: 'Items' }
  ]

  /* Dark Souls 2 was only ever mirrored as a planner - it has no calculators. */
  var GAMES = {
    darksouls: { name: 'Dark Souls', tools: allTools() },
    darksouls2: { name: 'Dark Souls 2', tools: ['index.html'] },
    darksouls3: { name: 'Dark Souls 3', tools: allTools() }
  }

  function allTools() {
    var files = []
    for (var i = 0; i < TOOLS.length; i++) files.push(TOOLS[i].file)
    return files
  }

  function here() {
    var match = window.location.pathname.match(/(darksouls[23]?)\/([^/]*)$/)
    if (!match || !GAMES[match[1]]) return null
    return { game: match[1], file: match[2] || 'index.html' }
  }

  function element(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }

  function icon(name) {
    return element('i', 'material-icons', name)
  }

  /* The hrefs already in the page are the ones that are correct from wherever this page sits - the
     home page reaches a game as ./darksouls/, a game page as ../darksouls/. Reading them back is
     more reliable than working out a relative path from scratch. */
  function harvestGameLinks(list) {
    var found = []
    var anchors = list.querySelectorAll('a')

    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href') || ''
      var match = href.match(/(darksouls[23]?)\/index\.html$/)
      if (!match || !GAMES[match[1]]) continue
      found.push({ game: match[1], href: href, item: anchors[i].parentNode })
    }
    return found
  }

  /* Keep the tool when switching game, so DS3's weapon calculator goes to DS's rather than dumping
     you back on a planner. Falls back to the planner where that game has no such tool. */
  function targetFor(game, href, current) {
    if (!current || GAMES[game].tools.indexOf(current.file) === -1) return href
    return href.replace(/index\.html$/, current.file)
  }

  function buildGameMenu(links, current) {
    var holder = element('li', 'sp-gamemenu')

    var button = element('button', 'sp-gamemenu__button')
    button.type = 'button'
    button.setAttribute('aria-haspopup', 'true')
    button.setAttribute('aria-expanded', 'false')
    button.appendChild(element('span', null, current ? GAMES[current.game].name : 'Games'))
    button.appendChild(icon('expand_more'))

    var menu = element('ul', 'sp-gamemenu__list')

    for (var i = 0; i < links.length; i++) {
      var game = links[i].game
      var item = element('li')
      var link = element('a', null, GAMES[game].name)
      link.href = targetFor(game, links[i].href, current)

      if (current && game === current.game) {
        link.className = 'sp-gamemenu__current'
        link.setAttribute('aria-current', 'true')
        link.appendChild(icon('check'))
      }
      item.appendChild(link)
      menu.appendChild(item)
    }

    holder.appendChild(button)
    holder.appendChild(menu)

    /* Fixed rather than absolute, and placed on open: the bar scrolls sideways on a narrow window,
       and an absolutely positioned menu inside a scrolling box gets clipped by it. */
    function place() {
      var rect = button.getBoundingClientRect()
      menu.style.left = Math.round(rect.left) + 'px'
      menu.style.top = Math.round(rect.bottom + 6) + 'px'
    }

    function close() {
      holder.classList.remove('sp-gamemenu--open')
      button.setAttribute('aria-expanded', 'false')
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation()
      var open = holder.classList.toggle('sp-gamemenu--open')
      button.setAttribute('aria-expanded', open ? 'true' : 'false')
      if (open) place()
    })

    document.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close()
    })
    menu.addEventListener('click', function (event) {
      event.stopPropagation()
    })

    return holder
  }

  function buildToolItems(current) {
    var tools = GAMES[current.game].tools
    var items = []
    if (tools.length < 2) return items

    items.push(element('li', 'sp-navrule'))

    for (var i = 0; i < TOOLS.length; i++) {
      var tool = TOOLS[i]
      if (tools.indexOf(tool.file) === -1) continue

      var item = element('li', 'sp-toolnav')
      var link = element('a', null, tool.label)
      link.href = './' + tool.file
      if (tool.file === current.file) {
        link.className = 'sp-toolnav__current'
        link.setAttribute('aria-current', 'page')
      }
      item.appendChild(link)
      items.push(item)
    }
    return items
  }

  function init() {
    var menu = document.getElementById('main-menu')
    if (!menu) return
    var list = menu.querySelector('.mm__horizontal')
    if (!list) return

    var links = harvestGameLinks(list)
    if (!links.length) return

    var current = here()
    var holder = buildGameMenu(links, current)

    /* The dropdown takes the place of the first game link, so it lands right of the home icon. */
    list.insertBefore(holder, links[0].item)
    for (var i = 0; i < links.length; i++) list.removeChild(links[i].item)

    if (!current) return
    var items = buildToolItems(current)
    for (var t = 0; t < items.length; t++) list.appendChild(items[t])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
