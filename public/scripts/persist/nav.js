/*!
 * Per-game navigation.
 *
 * The mirror only put the list of a game's tools on its planner page, at the bottom of a very long
 * page. The calculators got nothing at all, so moving between two of them meant going out to the
 * home page and back in. This adds a second bar under the main menu listing the current game's
 * tools, marks where you are, and makes the game links keep the tool you are on rather than always
 * dropping you on a planner.
 *
 * Built here rather than in markup so it stays in one place instead of being copy-pasted into
 * eighteen pages that would then drift.
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
    darksouls: { label: 'DS', tools: allTools() },
    darksouls2: { label: 'DS 2', tools: ['index.html'] },
    darksouls3: { label: 'DS 3', tools: allTools() }
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

  function buildSubnav(current) {
    var tools = GAMES[current.game].tools
    if (tools.length < 2) return null

    var nav = element('nav', 'sp-subnav')
    var list = element('ul')

    for (var i = 0; i < TOOLS.length; i++) {
      var tool = TOOLS[i]
      if (tools.indexOf(tool.file) === -1) continue

      var item = element('li')
      var link = element('a', null, tool.label)
      link.href = './' + tool.file
      if (tool.file === current.file) {
        link.className = 'sp-subnav__current'
        link.setAttribute('aria-current', 'page')
      }
      item.appendChild(link)
      list.appendChild(item)
    }

    nav.appendChild(list)
    return nav
  }

  /* Keep the tool when switching game, so DS3's weapon calculator goes to DS1's rather than
     dumping you back on a planner. Falls back to the planner where that game has no such tool. */
  function retargetGameLinks(current) {
    var links = document.querySelectorAll('#main-menu .mm__horizontal a')
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      var match = link.getAttribute('href').match(/(darksouls[23]?)\/index\.html$/)
      if (!match) continue
      var game = match[1]

      if (game === current.game) {
        link.className = 'sp-menu__current'
        link.setAttribute('aria-current', 'true')
        continue
      }
      if (GAMES[game].tools.indexOf(current.file) !== -1) {
        link.href = link.getAttribute('href').replace(/index\.html$/, current.file)
      }
    }
  }

  function init() {
    var current = here()
    if (!current) return

    var menu = document.getElementById('main-menu')
    if (!menu) return

    retargetGameLinks(current)

    var subnav = buildSubnav(current)
    if (subnav && menu.parentNode) menu.parentNode.insertBefore(subnav, menu.nextSibling)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
