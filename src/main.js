import './style.css'
import {
  runMigrationIfNeeded,
  getActiveCreators,
  getArchivedCreators,
  addCreator,
  updateCreator,
  setCreatorLevel,
  getCreatorStatus,
  setCreatorStatus,
  markVisit,
  isInTodayRotation,
  newArticleCount,
  checkAndResetIfNeeded,
  resetAllStatus,
  setPendingCreatorId,
  getPendingCreatorId,
  clearPendingCreatorId,
  parseNoteUrl,
  exportData,
  importData,
  LEVELS,
} from './storage.js'
import { fetchCreator } from './api.js'
import lines from './lines.json'

const BASE = import.meta.env.BASE_URL
const assetPath = (p) => (p.startsWith('/') ? BASE.replace(/\/$/, '') + p : p)

const $ = (id) => document.getElementById(id)

// Modals
const registerModal = $('registerModal')
const statusModal = $('statusModal')
const actionMenuModal = $('actionMenuModal')
const rewardModal = $('rewardModal')
const settingsModal = $('settingsModal')

// Inputs
const noteUrlInput = $('noteUrlInput')
const urlError = $('urlError')
const registerPreview = $('registerPreview')
const previewCreator = $('previewCreator')
const displayNameInput = $('displayNameInput')
const registerConfirmBtn = $('registerConfirmBtn')

let pendingRegisterProfile = null
let registerFetchToken = 0

// Sections
const naviEl = $('navi')
const lv1Grid = $('lv1Grid')
const lv1Empty = $('lv1Empty')
const lv1Meta = $('lv1Meta')
const expandGrid = $('expandGrid')
const expandEmpty = $('expandEmpty')
const expandMeta = $('expandMeta')
const emptyState = $('emptyState')

let currentStatusId = null
let currentActionId = null
let lastRewardShownDate = null

// --- Utils ---

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function weekdayKey(date = new Date()) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()]
}

function daysSinceVisit(creator) {
  if (!creator.lastVisitedAt) return null
  const ms = Date.now() - new Date(creator.lastVisitedAt).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

// --- Rendering ---

function render() {
  const creators = getActiveCreators()

  if (creators.length === 0) {
    naviEl.hidden = true
    $('lv1Section').hidden = true
    $('expandSection').hidden = true
    emptyState.hidden = false
    return
  }

  naviEl.hidden = false

  emptyState.hidden = true
  $('lv1Section').hidden = false
  $('expandSection').hidden = false

  const lv1 = creators.filter((c) => c.level === LEVELS.LV1)
  const expand = creators.filter((c) => c.level !== LEVELS.LV1 && isInTodayRotation(c))

  // lv1: sort by: new-first, then remaining by order
  const lv1Sorted = [...lv1].sort((a, b) => {
    const an = newArticleCount(a) > 0 ? 0 : 1
    const bn = newArticleCount(b) > 0 ? 0 : 1
    if (an !== bn) return an - bn
    return a.order - b.order
  })

  // expand: new-first, then last-visited-oldest-first
  const expandSorted = [...expand].sort((a, b) => {
    const an = newArticleCount(a) > 0 ? 0 : 1
    const bn = newArticleCount(b) > 0 ? 0 : 1
    if (an !== bn) return an - bn
    const av = a.lastVisitedAt ? new Date(a.lastVisitedAt).getTime() : 0
    const bv = b.lastVisitedAt ? new Date(b.lastVisitedAt).getTime() : 0
    return av - bv
  })

  renderGrid(lv1Grid, lv1Sorted)
  lv1Empty.hidden = lv1Sorted.length > 0
  lv1Meta.textContent = metaText(lv1Sorted)

  renderGrid(expandGrid, expandSorted)
  expandEmpty.hidden = expandSorted.length > 0
  expandMeta.textContent = metaText(expandSorted)

  renderNavi(creators, lv1Sorted, expandSorted)
  maybeShowReward(lv1Sorted)
}

function metaText(list) {
  if (list.length === 0) return ''
  const newCount = list.filter((c) => newArticleCount(c) > 0).length
  const doneCount = list.filter((c) => {
    const s = getCreatorStatus(c.id)
    return s.read || s.commented
  }).length
  const parts = [`${doneCount}/${list.length}`]
  if (newCount > 0) parts.push(`新着 ${newCount}`)
  return parts.join(' · ')
}

function renderGrid(grid, list) {
  grid.innerHTML = ''
  list.forEach((creator) => {
    grid.appendChild(buildCard(creator))
  })
}

function buildCard(creator) {
  const s = getCreatorStatus(creator.id)
  const done = s.read || s.commented
  const nCount = newArticleCount(creator)

  const card = document.createElement('div')
  card.className = 'card' + (done ? ' card--done' : '')
  card.dataset.creatorId = creator.id

  const badgeNew = nCount > 0
    ? `<span class="badge-new">新着${nCount > 1 ? ' ' + nCount : ''}</span>`
    : ''

  const toggles = `
    <button class="status-toggle ${s.read ? 'status-toggle--on' : ''}" data-toggle="read" aria-pressed="${s.read}">読了</button>
    <button class="status-toggle ${s.commented ? 'status-toggle--on' : ''}" data-toggle="commented" aria-pressed="${s.commented}">コメント</button>
  `

  const metaParts = []
  if (creator.level === LEVELS.LV1) metaParts.push('毎日')
  else if (creator.level === LEVELS.LV2) metaParts.push('週単位')
  else if (creator.level === LEVELS.LV3) metaParts.push('月単位')
  const dv = daysSinceVisit(creator)
  if (dv !== null) {
    metaParts.push(dv === 0 ? '今日' : `${dv}日前`)
  } else {
    metaParts.push('未訪問')
  }

  const headerStyle = creator.headerImageUrl
    ? `style="background-image: url('${encodeURI(creator.headerImageUrl)}')"`
    : ''

  card.innerHTML = `
    <div class="card-header-bg" ${headerStyle}></div>
    <div class="card-body">
      <div class="card-icon">${
        creator.iconUrl
          ? `<img src="${encodeURI(creator.iconUrl)}" alt="" />`
          : '👤'
      }</div>
      <div class="card-main">
        <div class="card-name">${escapeHtml(creator.name)}</div>
        <div class="card-meta">${metaParts.join(' · ')}</div>
      </div>
      <div class="card-right">
        ${badgeNew}
        <div class="status-toggles">${toggles}</div>
      </div>
    </div>
  `

  attachCardEvents(card, creator)
  return card
}

function attachCardEvents(card, creator) {
  let pressTimer = null
  let longPressed = false

  const startPress = (e) => {
    if (e.target.closest('.status-toggle')) return
    longPressed = false
    pressTimer = setTimeout(() => {
      longPressed = true
      if (navigator.vibrate) navigator.vibrate(30)
      openActionMenu(creator)
    }, 500)
  }

  const endPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  card.addEventListener('pointerdown', startPress)
  card.addEventListener('pointerup', endPress)
  card.addEventListener('pointercancel', endPress)
  card.addEventListener('pointerleave', endPress)

  // Status toggle buttons
  card.querySelectorAll('.status-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleStatus(creator, btn.dataset.toggle)
    })
  })

  card.addEventListener('click', (e) => {
    if (e.target.closest('.status-toggle')) return
    if (longPressed) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    navigateToCreator(creator)
  })

  card.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.status-toggle')) return
    e.preventDefault()
    openActionMenu(creator)
  })
}

async function toggleStatus(creator, field) {
  const current = getCreatorStatus(creator.id)
  const next = {
    read: current.read,
    commented: current.commented,
  }
  next[field] = !current[field]
  setCreatorStatus(creator.id, next)

  if (next.read || next.commented) {
    let articleCount = creator.lastKnownArticleCount
    try {
      const profile = await fetchCreator(creator.username)
      articleCount = profile.noteCount
      updateCreator(creator.id, {
        lastApiCheckedAt: new Date().toISOString(),
        iconUrl: profile.profileImageUrl,
        headerImageUrl: profile.headerImageUrl,
      })
    } catch {
      // ignore
    }
    markVisit(creator.id, { articleCount })
  }
  render()
}

// --- Navi ---

function renderNavi(all, lv1, expand) {
  const wk = weekdayKey()
  const char = lines.characters[wk]
  const dict = lines.navi[wk]
  if (!char || !dict) {
    naviEl.hidden = true
    return
  }

  const lv1New = lv1.reduce((sum, c) => sum + newArticleCount(c), 0)
  const expandNew = expand.reduce((sum, c) => sum + newArticleCount(c), 0)
  const lv1All = lv1.length
  const lv1Done = lv1.filter((c) => {
    const s = getCreatorStatus(c.id)
    return s.read || s.commented
  }).length

  let key
  if (lv1All === 0 && expand.length === 0) key = 'nothing'
  else if (lv1All > 0 && lv1Done === lv1All && expandNew === 0) key = 'all_done'
  else if (lv1New > 0) key = 'lv1_new'
  else if (lv1All > 0 && lv1Done === lv1All) key = 'lv1_done'
  else if (expandNew > 0) key = 'expand_only'
  else key = 'lv1_no_new'

  const template = dict[key] || dict.lv1_no_new || ''
  const text = fillTemplate(template, { lv1New, expandNew })

  $('naviImage').src = assetPath(char.eyes)
  $('naviName').textContent = char.name
  $('naviLine').textContent = text
  naviEl.hidden = false
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\$\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''))
}

// --- Reward modal ---

function maybeShowReward(lv1) {
  if (lv1.length === 0) return
  const allDone = lv1.every((c) => {
    const s = getCreatorStatus(c.id)
    return s.read || s.commented
  })
  if (!allDone) return
  const today = todayKey()
  const shown = localStorage.getItem('ohayomi_rewardShownAt')
  if (shown === today) return
  if (lastRewardShownDate === today) return

  lastRewardShownDate = today
  localStorage.setItem('ohayomi_rewardShownAt', today)

  const wk = weekdayKey()
  const char = lines.characters[wk]
  const rewardLines = lines.reward[wk] || []
  const line = rewardLines[Math.floor(Math.random() * rewardLines.length)] || 'おつかれさま'

  $('rewardImage').src = assetPath(char.chibi)
  $('rewardName').textContent = char.name
  $('rewardLine').textContent = line
  openModal(rewardModal)
}

$('rewardCloseBtn').addEventListener('click', () => closeModal(rewardModal))

// --- Navigation to note ---

function navigateToCreator(creator) {
  setPendingCreatorId(creator.id)
  window.open(creator.url, '_blank')
}

function handleReturn() {
  const pendingId = getPendingCreatorId()
  if (!pendingId) return
  const creator = getActiveCreators().find((c) => c.id === pendingId)
  clearPendingCreatorId()
  if (!creator) return
  openStatusModal(creator)
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkAndResetIfNeeded()
    handleReturn()
    render()
  }
})

window.addEventListener('focus', () => {
  handleReturn()
})

// --- Modals ---

function openModal(overlay) {
  overlay.classList.add('active')
}

function closeModal(overlay) {
  overlay.classList.remove('active')
}

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay)
  })
})

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const el = document.activeElement
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100)
    }
  })
}

// --- Registration ---

$('addBtn').addEventListener('click', () => {
  noteUrlInput.value = ''
  urlError.textContent = ''
  registerPreview.hidden = true
  registerConfirmBtn.disabled = true
  pendingRegisterProfile = null
  previewCreator.innerHTML = ''
  displayNameInput.value = ''
  openModal(registerModal)
})

noteUrlInput.addEventListener('input', () => {
  const url = noteUrlInput.value.trim()
  urlError.textContent = ''
  registerConfirmBtn.disabled = true
  pendingRegisterProfile = null

  if (!url) {
    registerPreview.hidden = true
    return
  }

  const username = parseNoteUrl(url)
  if (!username) {
    urlError.textContent = 'noteのURLを入力してください'
    registerPreview.hidden = true
    return
  }

  registerPreview.hidden = false
  previewCreator.innerHTML = '<span class="preview-loading">読み込み中…</span>'
  displayNameInput.value = ''

  const token = ++registerFetchToken
  fetchCreator(username)
    .then((profile) => {
      if (token !== registerFetchToken) return
      pendingRegisterProfile = { username, ...profile }
      const displayName = profile.nickname || username
      previewCreator.innerHTML = `
        <div class="card-icon">${
          profile.profileImageUrl
            ? `<img src="${encodeURI(profile.profileImageUrl)}" alt="" />`
            : '👤'
        }</div>
        <span>${escapeHtml(displayName)}</span>
      `
      displayNameInput.value = displayName
      registerConfirmBtn.disabled = false
    })
    .catch(() => {
      if (token !== registerFetchToken) return
      pendingRegisterProfile = null
      previewCreator.innerHTML = ''
      urlError.textContent = 'クリエイターが見つかりませんでした'
      registerPreview.hidden = true
    })
})

$('registerCancelBtn').addEventListener('click', () => closeModal(registerModal))

registerConfirmBtn.addEventListener('click', () => {
  if (!pendingRegisterProfile) return
  const { username, nickname, profileImageUrl, headerImageUrl, noteCount } = pendingRegisterProfile
  const displayName = displayNameInput.value.trim() || nickname || username

  const result = addCreator(username, displayName)
  if (!result) {
    urlError.textContent = 'このクリエイターは既に登録されています'
    return
  }

  updateCreator(result.id, {
    iconUrl: profileImageUrl,
    headerImageUrl: headerImageUrl,
    lastKnownArticleCount: noteCount,
    articleCountAtLastVisit: noteCount,
    lastApiCheckedAt: new Date().toISOString(),
  })

  pendingRegisterProfile = null
  closeModal(registerModal)
  render()
})

// --- Status modal ---

function openStatusModal(creator) {
  currentStatusId = creator.id
  const current = getCreatorStatus(creator.id)
  $('statusCreatorInfo').innerHTML = `
    <div class="card-icon">${
      creator.iconUrl
        ? `<img src="${encodeURI(creator.iconUrl)}" alt="" />`
        : '👤'
    }</div>
    <span>${escapeHtml(creator.name)}</span>
  `
  $('statusReadCheck').checked = current.read
  $('statusCommentedCheck').checked = current.commented
  openModal(statusModal)
}

$('statusConfirmBtn').addEventListener('click', async () => {
  if (!currentStatusId) return
  const read = $('statusReadCheck').checked
  const commented = $('statusCommentedCheck').checked
  setCreatorStatus(currentStatusId, { read, commented })

  if (read || commented) {
    const creator = getActiveCreators().find((c) => c.id === currentStatusId)
    if (creator) {
      let articleCount = creator.lastKnownArticleCount
      try {
        const profile = await fetchCreator(creator.username)
        articleCount = profile.noteCount
        updateCreator(creator.id, {
          lastApiCheckedAt: new Date().toISOString(),
          iconUrl: profile.profileImageUrl,
          headerImageUrl: profile.headerImageUrl,
        })
      } catch {
        // API失敗時はローカル値で
      }
      markVisit(creator.id, { articleCount })
    }
  }
  currentStatusId = null
  closeModal(statusModal)
  render()
})

$('statusCancelBtn').addEventListener('click', () => {
  currentStatusId = null
  closeModal(statusModal)
})

// --- Action menu (long-press) ---

function openActionMenu(creator) {
  currentActionId = creator.id
  $('actionMenuCreatorInfo').innerHTML = `
    <div class="card-icon">${
      creator.iconUrl
        ? `<img src="${encodeURI(creator.iconUrl)}" alt="" />`
        : '👤'
    }</div>
    <span>${escapeHtml(creator.name)}</span>
  `
  actionMenuModal.querySelectorAll('.action-btn[data-level]').forEach((btn) => {
    btn.classList.toggle('action-btn--current', btn.dataset.level === creator.level)
  })
  openModal(actionMenuModal)
}

actionMenuModal.querySelectorAll('.action-btn[data-level]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!currentActionId) return
    setCreatorLevel(currentActionId, btn.dataset.level)
    currentActionId = null
    closeModal(actionMenuModal)
    render()
  })
})

$('actionArchiveBtn').addEventListener('click', () => {
  if (!currentActionId) return
  updateCreator(currentActionId, { archived: true })
  currentActionId = null
  closeModal(actionMenuModal)
  render()
})

$('actionRenameBtn').addEventListener('click', () => {
  if (!currentActionId) return
  const creator = getActiveCreators().find((c) => c.id === currentActionId)
  if (!creator) return
  $('renameInput').value = creator.name
  closeModal(actionMenuModal)
  openModal($('renameModal'))
  setTimeout(() => $('renameInput').focus(), 100)
})

$('renameSaveBtn').addEventListener('click', () => {
  if (!currentActionId) return
  const name = $('renameInput').value.trim()
  if (name) {
    updateCreator(currentActionId, { name })
  }
  currentActionId = null
  closeModal($('renameModal'))
  render()
})

$('renameCancelBtn').addEventListener('click', () => {
  currentActionId = null
  closeModal($('renameModal'))
})

$('actionMenuCloseBtn').addEventListener('click', () => {
  currentActionId = null
  closeModal(actionMenuModal)
})

// --- Settings ---

$('settingsBtn').addEventListener('click', () => {
  renderArchivedList()
  openModal(settingsModal)
})

$('settingsCloseBtn').addEventListener('click', () => closeModal(settingsModal))

$('resetBtn').addEventListener('click', () => {
  resetAllStatus()
  localStorage.removeItem('ohayomi_rewardShownAt')
  lastRewardShownDate = null
  render()
  closeModal(settingsModal)
})

$('exportBtn').addEventListener('click', () => {
  const json = exportData()
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'ohayomi-backup.json'
  a.click()
  URL.revokeObjectURL(a.href)
})

const importFile = $('importFile')
$('importBtn').addEventListener('click', () => importFile.click())
importFile.addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      importData(reader.result)
      render()
      closeModal(settingsModal)
      refreshAllCreators()
    } catch {
      alert('ファイルの読み込みに失敗しました')
    }
  }
  reader.readAsText(file)
  importFile.value = ''
})

function renderArchivedList() {
  const archived = getArchivedCreators()
  const archivedList = $('archivedList')
  if (archived.length === 0) {
    archivedList.innerHTML = '<p class="archived-empty">なし</p>'
    return
  }

  archivedList.innerHTML = archived
    .map(
      (c) => `
    <div class="archived-item">
      <span>${escapeHtml(c.name)}</span>
      <button class="btn btn-primary" data-restore="${c.id}">復帰</button>
    </div>
  `
    )
    .join('')

  archivedList.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', () => {
      updateCreator(btn.dataset.restore, { archived: false })
      renderArchivedList()
      render()
    })
  })
}

// --- Refresh from API ---

async function refreshAllCreators() {
  const creators = getActiveCreators()
  for (const creator of creators) {
    try {
      const profile = await fetchCreator(creator.username)
      updateCreator(creator.id, {
        iconUrl: profile.profileImageUrl,
        headerImageUrl: profile.headerImageUrl,
        lastKnownArticleCount: profile.noteCount,
        lastApiCheckedAt: new Date().toISOString(),
      })
    } catch {
      // API失敗時はスキップ
    }
  }
  render()
}

// --- Service Worker ---

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')
}

// --- Init ---

runMigrationIfNeeded()
checkAndResetIfNeeded()
render()
refreshAllCreators()
