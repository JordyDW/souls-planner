/*!
 * souls-persist - build persistence and shareable links for the offline SoulsPlanner.
 *
 * WHY THIS IS SO SMALL
 *
 * soulsplanner.com was server-rendered: PHP injected a `var savedBuild = {...}` global into the
 * page and the bundled planner applied it on DOM ready. Mirroring the site removed the account
 * system that produced that global, but the code that *consumes* it survived untouched in all
 * three planner bundles, guarded by `"undefined" != typeof savedBuild`. So loading a build needs
 * no DOM poking here: define that global and the planner restores equipment, infusions, buff
 * checkboxes and per-weapon panel visibility, then recalculates, exactly as it always did.
 *
 * Saving is the mirror image. Each bundle still carries the serializer that used to feed the
 * removed "save build" request, so the adapters below are transcriptions of it - which means the
 * format we store is the planner's own format and round-trips for free.
 *
 * Two transformations the deleted PHP layer used to perform, now done in the adapters:
 *   - the bundled serializer emits `class`, the applier reads `class_`
 *   - the bundled serializer emits booleans, the applier tests `1 === value`
 *
 * ORDERING - the one thing that must not change: restore() runs at top-level script execution,
 * NOT inside $(document).ready. jQuery runs ready callbacks in registration order and
 * planner.min.js registers its applier first, so a ready callback here would always be too late.
 * The UI setup further down is in a ready callback on purpose - by then the planner has populated
 * every select and applied the restored build.
 */
;(function () {
  'use strict'

  var FORMAT = 1
  var HASH_PREFIX = '#b='
  var DEBOUNCE_MS = 250

  /* ------------------------------------------------------------------ helpers */

  function values(selector) {
    var out = []
    $(selector).each(function () {
      out.push($(this).val())
    })
    return out.join(';')
  }

  /* Slot id plus one value per suffix, flattened - e.g. rh1;rh1-reinforce;rh1-infusion. */
  function slotValues(selector, suffixes) {
    var out = []
    $(selector).each(function () {
      var id = $(this).attr('id')
      out.push($(this).val())
      for (var i = 0; i < suffixes.length; i++) {
        out.push($('#' + id + suffixes[i]).val())
      }
    })
    return out.join(';')
  }

  /* Spells and items pair a select with a "buff" checkbox two levels up. */
  function valuesWithBuffs(selector) {
    var picked = []
    var buffs = []
    $(selector).each(function () {
      picked.push($(this).val())
      buffs.push($(this).parent().parent().children('.buff').is(':checked') ? 1 : 0)
    })
    return { values: picked.join(';'), buffs: buffs.join(';') }
  }

  /* Which stat panel (attack / requirements / ...) is showing for each weapon slot. */
  function paramVisible(selector) {
    var out = []
    $(selector).each(function () {
      var shown = $(this).parent().parent().children('.equipment-params[data-visible=true]').attr('class')
      out.push(shown ? shown.split(' ').pop() : '')
    })
    return out.join(';')
  }

  function flag(selector) {
    return $(selector).is(':checked') ? 1 : 0
  }

  /* ----------------------------------------------------------------- adapters */

  var ADAPTERS = {
    darksouls: {
      required: [
        'class_', 'level', 'gender', 'covenant', 'covenantLevel', 'armor', 'weapons',
        'weaponsParamVisible', 'grip', 'isLowHP', 'isDragonHead', 'isDragonTorso', 'rings',
        'spells', 'spellBuffs', 'arrows', 'bolts', 'items', 'itemBuffs', 'vitality',
        'attunement', 'endurance', 'strength', 'dexterity', 'resistance', 'intelligence',
        'faith', 'humanity'
      ],
      slots: [
        { selector: '.planner .armor .wrapper-protector select', suffixes: ['-reinforce'] },
        { selector: '.planner .weapons .wrapper-weapon select', suffixes: ['-reinforce', '-upgrade'] },
        { selector: '.planner .rings select', suffixes: [] }
      ],
      serialize: function () {
        var spells = valuesWithBuffs('.planner .spells select')
        var items = valuesWithBuffs('.planner .items select')
        var covenantLevel = parseInt($('#covenant-level').val(), 10)
        return {
          class_: $('#class').val(),
          level: $('#level').val(),
          gender: $('#gender').val(),
          covenant: $('#covenant').val(),
          covenantLevel: isNaN(covenantLevel) ? -1 : covenantLevel,
          armor: slotValues('.planner .armor .wrapper-protector select', ['-reinforce']),
          weapons: slotValues('.planner .weapons .wrapper-weapon select', ['-reinforce', '-upgrade']),
          weaponsParamVisible: paramVisible('.planner .weapons .wrapper-weapon select'),
          grip: $('#grip').is(':checked') ? DarkSouls.grip.TWO_HANDED : DarkSouls.grip.ONE_HANDED,
          isLowHP: flag('#low-hp'),
          isDragonHead: flag('#dragon-head'),
          isDragonTorso: flag('#dragon-torso'),
          rings: values('.planner .rings select'),
          spells: spells.values,
          spellBuffs: spells.buffs,
          arrows: values('.planner .arrows select'),
          bolts: values('.planner .bolts select'),
          items: items.values,
          itemBuffs: items.buffs,
          vitality: $('#vitality').val(),
          attunement: $('#attunement').val(),
          endurance: $('#endurance').val(),
          strength: $('#strength').val(),
          dexterity: $('#dexterity').val(),
          resistance: $('#resistance').val(),
          intelligence: $('#intelligence').val(),
          faith: $('#faith').val(),
          humanity: $('#humanity').val()
        }
      }
    },

    darksouls2: {
      required: [
        'class_', 'gender', 'level', 'covenant', 'armor', 'weapons', 'grip', 'rings', 'spells',
        'items', 'vigor', 'endurance', 'vitality', 'attunement', 'strength', 'dexterity',
        'adaptability', 'intelligence', 'faith'
      ],
      slots: [
        { selector: '.armor select', suffixes: [] },
        { selector: '.weapons .wrapper-weapon select', suffixes: ['-infusion'] },
        { selector: '.rings select', suffixes: [] }
      ],
      serialize: function () {
        return {
          class_: $('#class').val(),
          gender: $('#gender').val(),
          level: $('#level').val(),
          covenant: $('#covenant').val(),
          armor: values('.armor select'),
          weapons: slotValues('.weapons .wrapper-weapon select', ['-infusion']),
          grip: $('#grip').is(':checked') ? DarkSouls2.GRIP_TWO_HANDED : DarkSouls2.GRIP_ONE_HANDED,
          rings: values('.rings select'),
          spells: values('.spells select'),
          items: values('.items select'),
          vigor: $('#vigor').val(),
          endurance: $('#endurance').val(),
          vitality: $('#vitality').val(),
          attunement: $('#attunement').val(),
          strength: $('#strength').val(),
          dexterity: $('#dexterity').val(),
          adaptability: $('#adaptability').val(),
          intelligence: $('#intelligence').val(),
          faith: $('#faith').val()
        }
      }
    },

    darksouls3: {
      required: [
        'class_', 'level', 'gender', 'covenant', 'armor', 'weapons', 'weaponsParamVisible',
        'grip', 'isPVP', 'isLowHP', 'isFullHP', 'useSkillLH1', 'useSkillRH1', 'rings', 'spells',
        'spellBuffs', 'arrows', 'bolts', 'items', 'itemBuffs', 'vigor', 'attunement',
        'endurance', 'vitality', 'strength', 'dexterity', 'intelligence', 'faith', 'luck',
        'hollowing'
      ],
      slots: [
        { selector: '.planner .armor select', suffixes: [] },
        { selector: '.planner .weapons .wrapper-weapon select', suffixes: ['-reinforce', '-infusion'] },
        { selector: '.planner .rings select', suffixes: [] }
      ],
      serialize: function () {
        var spells = valuesWithBuffs('.planner .spells select')
        var items = valuesWithBuffs('.planner .items select')
        return {
          class_: $('#class').val(),
          level: $('#level').val(),
          gender: $('#gender').val(),
          covenant: $('#covenant').val(),
          armor: values('.planner .armor select'),
          weapons: slotValues('.planner .weapons .wrapper-weapon select', ['-reinforce', '-infusion']),
          weaponsParamVisible: paramVisible('.planner .weapons .wrapper-weapon select'),
          grip: $('#grip').is(':checked') ? DarkSouls3.grip.TWO_HANDED : DarkSouls3.grip.ONE_HANDED,
          isPVP: flag('#mode-pvp'),
          isLowHP: flag('#low-hp'),
          isFullHP: flag('#full-hp'),
          useSkillLH1: flag('#lh1-use-skill'),
          useSkillRH1: flag('#rh1-use-skill'),
          rings: values('.planner .rings select'),
          spells: spells.values,
          spellBuffs: spells.buffs,
          arrows: values('.planner .arrows select'),
          bolts: values('.planner .bolts select'),
          items: items.values,
          itemBuffs: items.buffs,
          vigor: $('#vigor').val(),
          attunement: $('#attunement').val(),
          endurance: $('#endurance').val(),
          vitality: $('#vitality').val(),
          strength: $('#strength').val(),
          dexterity: $('#dexterity').val(),
          intelligence: $('#intelligence').val(),
          faith: $('#faith').val(),
          luck: $('#luck').val(),
          hollowing: $('#hollowing').val()
        }
      }
    }
  }

  /* ------------------------------------------------------------- which game? */

  function detectGame() {
    if (typeof plannerId !== 'undefined' && ADAPTERS[plannerId]) return plannerId
    var match = window.location.pathname.match(/(darksouls[23]?)\/[^/]*$/)
    return match && ADAPTERS[match[1]] ? match[1] : null
  }

  var game = detectGame()
  var adapter = game && ADAPTERS[game]
  if (!adapter) return

  var KEY = {
    autosave: 'soulsPlanner.autosave.' + game,
    builds: 'soulsPlanner.builds.' + game,
    currentId: 'soulsPlanner.currentId.' + game
  }

  /* --------------------------------------------------------- parked slots */

  /* A slot can be "parked": emptied so it stops counting towards weight and stats, while this
     module holds on to what was in it so the checkbox puts it straight back. Handy for "what do
     I weigh without leg armour" without having to hunt the piece down again.

     The planner has no concept of this, so parked values ride alongside the build rather than
     inside it - `b` stays byte-for-byte the format the planner's own applier expects. */

  var TOGGLE_TITLE = 'Uncheck to take this slot out of the calculation without losing it'
  var parked = {}
  var applying = false

  /* What this select looks like with nothing equipped. The planner already tells us: it gives
     select2 a placeholder whose id is exactly that value - "-1" for armour and rings, the Bare
     Fists id for weapons. Reading the options is the fallback for the mobile-native-select path,
     where select2 is never initialised. */
  function emptyValue($select) {
    var data = $select.data('select2')
    var placeholder = data && data.options && data.options.options.placeholder
    if (placeholder && placeholder.id !== undefined) return String(placeholder.id)
    if ($select.find('option[value="-1"]').length) return '-1'
    var first = $select.find('option').first()
    return first.length ? first.val() : '-1'
  }

  function optionText($select, value) {
    return $select.find('option').filter(function () { return this.value === value }).text()
  }

  function eachSlot(fn) {
    for (var g = 0; g < adapter.slots.length; g++) {
      var group = adapter.slots[g]
      /* jshint loopfunc:true */
      $(group.selector).each(
        (function (suffixes) {
          return function () { fn($(this), $(this).attr('id'), suffixes) }
        })(group.suffixes)
      )
    }
  }

  function currentParked() {
    var out = {}
    for (var id in parked) {
      if (parked.hasOwnProperty(id)) out[id] = parked[id]
    }
    return out
  }

  /* The checkbox and the label that draws it - see buildToggles. */
  function toggleUi(id) {
    return $('#sp-slot-' + id).add('label[for="sp-slot-' + id + '"]')
  }

  function markParked(id) {
    var $select = $('#' + id)
    var values = parked[id]
    $select.closest('.sp-slot').toggleClass('sp-slot--parked', !!values)
    if (values) {
      toggleUi(id).attr('title', 'Parked: ' + (optionText($select, values[0]) || 'this slot') + ' - re-check to put it back')
    } else {
      toggleUi(id).attr('title', TOGGLE_TITLE)
    }
  }

  function parkSlot(id, suffixes) {
    var $select = $('#' + id)
    var values = [$select.val()]
    for (var i = 0; i < suffixes.length; i++) values.push($('#' + id + suffixes[i]).val())
    parked[id] = values

    applying = true
    $select.val(emptyValue($select)).trigger('change.select2').trigger('change')
    applying = false
    markParked(id)
  }

  function unparkSlot(id, suffixes) {
    var values = parked[id]
    delete parked[id]
    if (!values) return markParked(id)

    applying = true
    var $select = $('#' + id)
    $select.val(values[0]).trigger('change.select2').trigger('change')

    /* Putting the weapon back rebuilds its reinforce and infusion lists from scratch, so those
       are restored afterwards - and in reverse order, which is the order the planner's own
       applier uses (infusion, or DS1's upgrade, before reinforce). */
    for (var i = suffixes.length - 1; i >= 0; i--) {
      var $extra = $('#' + id + suffixes[i])
      var wanted = values[i + 1]
      if (wanted === undefined || !$extra.length) continue
      if (!$extra.find('option').filter(function () { return this.value === wanted }).length) continue
      $extra.val(wanted).trigger('change.select2').trigger('change')
    }
    applying = false
    markParked(id)
  }

  function buildToggles() {
    eachSlot(function ($select, id, suffixes) {
      var cell = $select.closest('.wrapper-protector, .wrapper-weapon')
      var container = cell.length ? cell : $select.parent()
      var toggleId = 'sp-slot-' + id
      container.addClass('sp-slot')

      $('<input type="checkbox" class="sp-slot-toggle" checked tabindex="-1" />')
        .attr('id', toggleId)
        .prependTo(container)
        .on('change', function () {
          if ($(this).is(':checked')) unparkSlot(id, suffixes)
          else parkSlot(id, suffixes)
        })

      /* The planner parks real checkboxes off-screen and draws them with a label::before glyph,
         so the box you actually see and click is this label, not the input. */
      $('<label class="sp-slot-label"></label>')
        .attr('for', toggleId)
        .attr('title', TOGGLE_TITLE)
        .insertAfter('#' + toggleId)
    })
  }

  /* The restored build already has these slots empty, so this only has to remember what was in
     them and untick the boxes. */
  function applyParked(map) {
    for (var id in map) {
      if (!map.hasOwnProperty(id) || !$('#sp-slot-' + id).length) continue
      parked[id] = map[id]
      $('#sp-slot-' + id).prop('checked', false)
      markParked(id)
    }
  }

  /* -------------------------------------------------------------- storage */

  /* Every access is guarded: Chrome throws on localStorage over file://, and the planner has to
     keep working there - only persistence degrades, sharing still does. Same defensive shape as
     the Settings object in public/scripts/release/head.min.js. */
  var store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key)
        return raw === null ? fallback : JSON.parse(raw)
      } catch (e) {
        return fallback
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (e) {
        return false
      }
    },
    remove: function (key) {
      try {
        window.localStorage.removeItem(key)
      } catch (e) {}
    }
  }

  /* ---------------------------------------------------------------- codec */

  function wrap(build, parkedMap) {
    var payload = { v: FORMAT, g: game, b: build }
    var d = parkedMap || {}
    for (var id in d) {
      if (d.hasOwnProperty(id)) { payload.d = d; break }
    }
    return payload
  }

  /* Optional and forgiving: links made before slots could be parked simply have no `d`, and a
     malformed one costs you the parked slots rather than the whole build. */
  function parkedOf(payload) {
    var d = payload && payload.d
    if (!d || typeof d !== 'object') return {}
    var out = {}
    for (var id in d) {
      if (d.hasOwnProperty(id) && Object.prototype.toString.call(d[id]) === '[object Array]') {
        out[id] = d[id]
      }
    }
    return out
  }

  function unwrapState(payload) {
    return { build: unwrap(payload), parked: parkedOf(payload) }
  }

  /* Validate rather than patch. The planner's applier does not null-guard - a missing key means a
     thrown TypeError inside its ready handler and a half-dead page - so anything not provably
     complete and provably for this game is rejected outright and the planner keeps its defaults. */
  function unwrap(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('payload is not an object')
    if (payload.v !== FORMAT) throw new Error('unsupported format version ' + payload.v)
    if (payload.g !== game) throw new Error('build is for ' + payload.g + ', this page is ' + game)
    var build = payload.b
    if (!build || typeof build !== 'object') throw new Error('build is not an object')
    for (var i = 0; i < adapter.required.length; i++) {
      if (!(adapter.required[i] in build)) throw new Error('build is missing "' + adapter.required[i] + '"')
    }
    return build
  }

  function encode(state) {
    return LZString.compressToEncodedURIComponent(JSON.stringify(wrap(state.build, state.parked)))
  }

  function decode(token) {
    var json = null
    try {
      /* lz-string throws rather than returning null on malformed input. */
      json = LZString.decompressFromEncodedURIComponent(token)
    } catch (e) {
      json = null
    }
    if (!json) throw new Error('link is not valid compressed data')

    var payload
    try {
      payload = JSON.parse(json)
    } catch (e) {
      throw new Error('link does not decode to valid JSON')
    }
    return unwrapState(payload)
  }

  function baseUrl() {
    return window.location.href.split('#')[0]
  }

  function shareUrl(state) {
    return baseUrl() + HASH_PREFIX + encode(state)
  }

  /* -------------------------------------------------- restore (before ready) */

  var restoredFrom = null
  var restoredParked = {}

  function warn(message) {
    if (window.console && console.warn) console.warn('[souls-persist] ' + message)
  }

  try {
    var restored = null
    var hash = window.location.hash

    if (hash.indexOf(HASH_PREFIX) === 0) {
      try {
        restored = decode(hash.slice(HASH_PREFIX.length))
        restoredFrom = 'link'
      } catch (linkError) {
        /* Fall through to the autosave rather than letting a mangled link cost you the build
           you were working on. */
        warn('ignoring link: ' + linkError.message)
      }
    }

    if (!restored) {
      var saved = store.get(KEY.autosave, null)
      if (saved) {
        restored = unwrapState(saved)
        restoredFrom = 'autosave'
      }
    }

    if (restored) {
      window.savedBuild = restored.build
      restoredParked = restored.parked
    }
  } catch (error) {
    /* Deliberately non-fatal: anything unusable here just gives you a clean planner. */
    window.savedBuild = undefined
    restoredFrom = null
    restoredParked = {}
    warn('ignoring saved build: ' + error.message)
  }

  /* --------------------------------------------------------- current state */

  function currentBuild() {
    return adapter.serialize()
  }

  function currentState() {
    return { build: currentBuild(), parked: currentParked() }
  }

  var writeHash = true
  var suspended = false
  var timer = null

  function persistNow() {
    if (suspended) return
    var state = currentState()
    store.set(KEY.autosave, wrap(state.build, state.parked))
    if (!writeHash) return
    try {
      window.history.replaceState(null, '', HASH_PREFIX + encode(state))
    } catch (e) {
      /* file:// forbids replaceState. Stop retrying; the share button still builds URLs. */
      writeHash = false
    }
  }

  function schedulePersist() {
    window.clearTimeout(timer)
    timer = window.setTimeout(persistNow, DEBOUNCE_MS)
  }

  /* ------------------------------------------------------------ named builds */

  function loadBuilds() {
    var stored = store.get(KEY.builds, null)
    if (!stored || stored.v !== FORMAT || stored.g !== game || !stored.builds) return []
    var valid = []
    for (var i = 0; i < stored.builds.length; i++) {
      var entry = stored.builds[i]
      try {
        unwrap(wrap(entry.build))
        valid.push(entry)
      } catch (e) {
        /* drop entries that would break the planner rather than let them through */
      }
    }
    return valid
  }

  function saveBuilds(builds) {
    return store.set(KEY.builds, { v: FORMAT, g: game, builds: builds })
  }

  function newId() {
    return String(Date.now()) + String(Math.floor(Math.random() * 1000))
  }

  function entryFor(name, state) {
    return {
      id: newId(),
      name: name,
      level: state.build.level,
      updatedAt: new Date().toISOString(),
      build: state.build,
      parked: state.parked
    }
  }

  function stateOf(entry) {
    return { build: entry.build, parked: parkedOf({ d: entry.parked }) }
  }

  function findIndex(builds, id) {
    for (var i = 0; i < builds.length; i++) {
      if (builds[i].id === id) return i
    }
    return -1
  }

  function saveCurrent(forceNew) {
    var builds = loadBuilds()
    var state = currentState()
    var currentId = store.get(KEY.currentId, null)
    var index = forceNew ? -1 : findIndex(builds, currentId)

    if (index === -1) {
      var name = window.prompt('Name this build:', suggestedName(state.build))
      if (name === null) return null
      name = name.replace(/^\s+|\s+$/g, '')
      if (!name) return null
      var entry = entryFor(name, state)
      builds.unshift(entry)
      store.set(KEY.currentId, entry.id)
    } else {
      builds[index].build = state.build
      builds[index].parked = state.parked
      builds[index].level = state.build.level
      builds[index].updatedAt = new Date().toISOString()
    }

    if (!saveBuilds(builds)) {
      toast('Could not save - storage unavailable')
      return null
    }
    toast(index === -1 ? 'Build saved' : 'Build updated')
    return builds[index === -1 ? 0 : index]
  }

  function suggestedName(build) {
    var className = ''
    try {
      var games = { darksouls: window.DarkSouls, darksouls2: window.DarkSouls2, darksouls3: window.DarkSouls3 }
      className = games[game].classes[build.class_].name
    } catch (e) {}
    return (className ? className + ' ' : '') + 'SL' + build.level
  }

  function applyBuild(state) {
    /* The planner only applies savedBuild during its ready handler, so re-entering a build means
       reloading the page with it in the hash - which is also exactly what a shared link does. */
    suspended = true
    window.clearTimeout(timer)
    window.location.href = shareUrl(state)
    window.location.reload()
  }

  /* ------------------------------------------------------------------- UI */

  function toast(message) {
    var el = $('.sp-toast')
    if (!el.length) el = $('<div class="sp-toast"></div>').appendTo(document.body)
    el.text(message).addClass('sp-toast--visible')
    window.clearTimeout(toast.timer)
    toast.timer = window.setTimeout(function () {
      el.removeClass('sp-toast--visible')
    }, 1800)
  }

  function copyToClipboard(text) {
    if (window.navigator.clipboard && window.isSecureContext) {
      window.navigator.clipboard.writeText(text).then(
        function () { toast('Share link copied') },
        function () { legacyCopy(text) }
      )
      return
    }
    legacyCopy(text)
  }

  function legacyCopy(text) {
    /* clipboard API needs a secure context, which file:// and plain http:// are not. */
    var field = $('<textarea class="sp-clipboard"></textarea>').val(text).appendTo(document.body)
    field[0].select()
    var copied = false
    try {
      copied = document.execCommand('copy')
    } catch (e) {}
    field.remove()
    toast(copied ? 'Share link copied' : 'Copy failed - link is in the address bar')
  }

  function renderRows() {
    var builds = loadBuilds()
    var currentId = store.get(KEY.currentId, null)
    var body = $('#builds-dialog .sp-builds tbody').empty()

    $('#builds-dialog .sp-empty').toggle(builds.length === 0)
    $('#builds-dialog .sp-builds').toggle(builds.length > 0)

    for (var i = 0; i < builds.length; i++) {
      var entry = builds[i]
      var row = $('<tr></tr>').attr('data-id', entry.id)
      if (entry.id === currentId) row.addClass('sp-builds__row--current')
      $('<td class="sp-builds__name"></td>').text(entry.name).appendTo(row)
      $('<td class="sp-builds__level"></td>').text('SL ' + entry.level).appendTo(row)
      $('<td class="sp-builds__date"></td>').text(entry.updatedAt.slice(0, 10)).appendTo(row)
      $('<td class="sp-builds__actions"></td>')
        .append('<button class="sp-action" data-action="load">Load</button>')
        .append('<button class="sp-action" data-action="share">Copy link</button>')
        .append('<button class="sp-action" data-action="rename">Rename</button>')
        .append('<button class="sp-action" data-action="delete">Delete</button>')
        .appendTo(row)
      body.append(row)
    }
  }

  function exportBuilds() {
    var payload = JSON.stringify({ v: FORMAT, g: game, builds: loadBuilds() }, null, 2)
    var blob = new Blob([payload], { type: 'application/json' })
    var url = window.URL.createObjectURL(blob)
    var link = $('<a></a>').attr({ href: url, download: 'souls-planner-' + game + '-builds.json' })
    $(document.body).append(link)
    link[0].click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  function importBuilds(file) {
    var reader = new FileReader()
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result)
        if (parsed.g !== game) throw new Error('file holds ' + parsed.g + ' builds')
        if (!parsed.builds || !parsed.builds.length) throw new Error('file holds no builds')
        var merged = loadBuilds()
        var added = 0
        for (var i = 0; i < parsed.builds.length; i++) {
          var entry = parsed.builds[i]
          unwrap(wrap(entry.build))
          if (findIndex(merged, entry.id) === -1) {
            merged.push(entry)
            added++
          }
        }
        saveBuilds(merged)
        renderRows()
        toast(added + ' build' + (added === 1 ? '' : 's') + ' imported')
      } catch (error) {
        toast('Import failed: ' + error.message)
      }
    }
    reader.readAsText(file)
  }

  var dialog = null

  function buildDialog() {
    var markup =
      '<div id="builds-dialog" class="form-controls">' +
      '<h2>Saved builds</h2>' +
      '<div class="sp-dialog__body">' +
      '<table class="sp-builds"><tbody></tbody></table>' +
      '<p class="sp-empty">No saved builds yet. Use the save button to keep this one.</p>' +
      '</div>' +
      '<footer>' +
      '<button class="default" id="builds-dialog__save-as">Save current as new</button>' +
      '<button id="builds-dialog__export">Export</button>' +
      '<button id="builds-dialog__import">Import</button>' +
      '<button id="builds-dialog__close">Close</button>' +
      '</footer>' +
      '<input type="file" accept="application/json" class="sp-file" />' +
      '</div>'

    /* Sit alongside the planner's own dialogs so ModalDialog's overlay handling behaves. */
    var el = $(markup).appendTo($('.modal-overlay').length ? $('.modal-overlay') : document.body)

    el.on('click', '.sp-action', function () {
      var action = $(this).attr('data-action')
      var id = $(this).closest('tr').attr('data-id')
      var builds = loadBuilds()
      var index = findIndex(builds, id)
      if (index === -1) return

      if (action === 'load') {
        store.set(KEY.currentId, id)
        applyBuild(stateOf(builds[index]))
      } else if (action === 'share') {
        copyToClipboard(shareUrl(stateOf(builds[index])))
      } else if (action === 'rename') {
        var name = window.prompt('Rename build:', builds[index].name)
        if (name === null) return
        name = name.replace(/^\s+|\s+$/g, '')
        if (!name) return
        builds[index].name = name
        saveBuilds(builds)
        renderRows()
      } else if (action === 'delete') {
        if (!window.confirm('Delete "' + builds[index].name + '"?')) return
        builds.splice(index, 1)
        saveBuilds(builds)
        if (store.get(KEY.currentId, null) === id) store.remove(KEY.currentId)
        renderRows()
      }
    })

    el.find('#builds-dialog__save-as').on('click', function () {
      if (saveCurrent(true)) renderRows()
    })
    el.find('#builds-dialog__export').on('click', exportBuilds)
    el.find('#builds-dialog__import').on('click', function () {
      el.find('.sp-file').val('').trigger('click')
    })
    el.find('.sp-file').on('change', function () {
      if (this.files && this.files[0]) importBuilds(this.files[0])
    })
    el.find('#builds-dialog__close').on('click', function () {
      dialog.close()
    })

    return el
  }

  function openDialog() {
    if (!dialog) {
      buildDialog()
      dialog = new ModalDialog($('#builds-dialog'), function () {
        dialog.close()
      })
    }
    renderRows()
    dialog.show()
  }

  function buildToolbar() {
    var options = $('.planner .character-class .options')
    if (!options.length) return

    $('<button class="material-icons" id="sp-button-save" title="Save build (Ctrl+S)">save</button>')
      .on('click', function () {
        saveCurrent(false)
      })
      .appendTo(options)

    $('<button class="material-icons" id="sp-button-builds" title="Saved builds">folder</button>')
      .on('click', openDialog)
      .appendTo(options)

    $('<button class="material-icons" id="sp-button-share" title="Copy share link">link</button>')
      .on('click', function () {
        copyToClipboard(shareUrl(currentState()))
      })
      .appendTo(options)
  }

  function rebindStockButtons() {
    /* Both of these were written for the live site and are wrong in an offline copy. */

    /* "/darksouls3" is an absolute path that only resolves on the original domain. */
    $('#button-new')
      .off('click')
      .on('click', function () {
        window.open('index.html')
      })

    /* A plain reload would just restore the build from the hash again. */
    $('#button-reset')
      .off('click')
      .on('click', function () {
        suspended = true
        window.clearTimeout(timer)
        store.remove(KEY.autosave)
        store.remove(KEY.currentId)
        try {
          window.history.replaceState(null, '', baseUrl())
        } catch (e) {
          window.location.href = baseUrl()
        }
        window.location.reload()
      })
  }

  $(document).ready(function () {
    if (!$('.planner').length) return

    buildToolbar()
    rebindStockButtons()
    buildToggles()
    applyParked(restoredParked)

    /* Choosing something for a parked slot obviously means you want it back. */
    $('.planner').on('change', 'select', function () {
      if (applying || !parked.hasOwnProperty(this.id)) return
      delete parked[this.id]
      $('#sp-slot-' + this.id).prop('checked', true)
      markParked(this.id)
    })

    /* One delegated listener covers every control in every game. Delegation matters: the event
       reaches .planner only after the planner's own handler has run on the element itself, so by
       the time we serialize, the recalculation is already done. The +/- stat buttons and the
       arrow-key handlers all go through .val(x).trigger('change'), so they are covered too. */
    $('.planner').on('change', 'select, input', schedulePersist)

    $(document).on('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.which === 83) {
        event.preventDefault()
        saveCurrent(false)
      }
    })

    if (restoredFrom === 'link') toast('Build loaded from link')

    /* Seed the hash and the autosave so the address bar is a valid share link from the start. */
    persistNow()

    /* Cheap drift check: the required list above must stay in step with serialize(). */
    if (Object.keys(currentBuild()).sort().join(',') !== adapter.required.slice().sort().join(',')) {
      warn('required[] is out of sync with serialize() for ' + game)
    }
  })

  /* Exposed for debugging from the console. */
  window.SoulsPersist = {
    game: game,
    current: currentBuild,
    state: currentState,
    parked: currentParked,
    shareUrl: function () {
      return shareUrl(currentState())
    },
    builds: loadBuilds,
    encode: encode,
    decode: decode
  }
})()
