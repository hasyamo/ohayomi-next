import './style.css'
import {
  runMigrationIfNeeded,
  getActiveCreators,
  getArchivedCreators,
  addCreator,
  updateCreator,
  deleteCreator,
  setCreatorLevel,
  getCreatorStatus,
  setCreatorStatus,
  markVisit,
  isInTodayRotation,
  isInTodayExpand,
  refreshTodayExpand,
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
const slowGrid = $('slowGrid')
const slowEmpty = $('slowEmpty')
const slowMeta = $('slowMeta')
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
    $('slowSection').hidden = true
    emptyState.hidden = false
    return
  }

  naviEl.hidden = false

  emptyState.hidden = true
  $('lv1Section').hidden = false
  $('expandSection').hidden = false
  $('slowSection').hidden = false

  // ひろがり枠の加算（今日の周期入り or チェック済みは消さない）
  refreshTodayExpand()

  const byOrder = (a, b) => a.order - b.order
  const lv1 = creators.filter((c) => c.level === LEVELS.LV1).sort(byOrder)
  const expand = creators
    .filter((c) => c.level !== LEVELS.LV1 && isInTodayExpand(c.id))
    .sort(byOrder)
  const slow = creators
    .filter((c) => c.level !== LEVELS.LV1 && !isInTodayExpand(c.id))
    .sort(byOrder)

  renderGrid(lv1Grid, lv1)
  lv1Empty.hidden = lv1.length > 0
  lv1Meta.textContent = metaText(lv1)

  renderGrid(expandGrid, expand)
  expandEmpty.hidden = expand.length > 0
  expandMeta.textContent = metaText(expand)

  renderGrid(slowGrid, slow)
  slowEmpty.hidden = slow.length > 0
  slowMeta.textContent = metaText(slow)

  renderNavi(creators, lv1, expand)
  maybeShowReward(lv1)
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
  const hasNew = nCount > 0
  card.className = 'card'
    + (done ? ' card--done' : '')
    + (!done && !hasNew ? ' card--quiet' : '')
  card.dataset.creatorId = creator.id

  const badgeNew = nCount > 0
    ? `<span class="badge-new">新着${nCount > 1 ? ' ' + nCount : ''}</span>`
    : ''

  const toggles = `
    <button class="status-toggle ${s.read ? 'status-toggle--on' : ''}" data-toggle="read" aria-pressed="${s.read}">読了</button>
    <button class="status-toggle ${s.commented ? 'status-toggle--on' : ''}" data-toggle="commented" aria-pressed="${s.commented}">コメント</button>
  `

  const levelLabelClass = creator.level === LEVELS.LV1 ? 'card-level--lv1'
    : creator.level === LEVELS.LV2 ? 'card-level--lv2'
    : 'card-level--lv3'
  const levelLabel = creator.level === LEVELS.LV1 ? '毎日'
    : creator.level === LEVELS.LV2 ? '週単位'
    : '月単位'
  const dv = daysSinceVisit(creator)
  const visitLabel = dv === null ? '未訪問' : dv === 0 ? '今日' : `${dv}日前`

  const headerBg = creator.headerImageUrl
    ? `<div class="card-header-bg" style="background-image: url('${encodeURI(creator.headerImageUrl)}')"></div>`
    : `<div class="card-header-bg card-header-bg--empty"><span>No Image</span></div>`

  card.innerHTML = `
    ${headerBg}
    <div class="card-body">
      <div class="card-icon">${
        creator.iconUrl
          ? `<img src="${encodeURI(creator.iconUrl)}" alt="" />`
          : '👤'
      }</div>
      <div class="card-main">
        <div class="card-name">${escapeHtml(creator.name)}</div>
        <div class="card-meta"><span class="card-level ${levelLabelClass}">${levelLabel}</span><span class="card-visit"> · ${visitLabel}</span></div>
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

  // 未チェックのクリエイターに来ている新着だけをカウント
  const lv1New = lv1.reduce((sum, c) => {
    const s = getCreatorStatus(c.id)
    if (s.read || s.commented) return sum
    return sum + newArticleCount(c)
  }, 0)
  const expandNew = expand.reduce((sum, c) => {
    const s = getCreatorStatus(c.id)
    if (s.read || s.commented) return sum
    return sum + newArticleCount(c)
  }, 0)
  const lv1All = lv1.length
  const lv1Done = lv1.filter((c) => {
    const s = getCreatorStatus(c.id)
    return s.read || s.commented
  }).length

  const lv1InProgress = lv1All > 0 && lv1Done > 0 && lv1Done < lv1All

  let key
  if (lv1All === 0 && expand.length === 0) key = 'nothing'
  else if (lv1All > 0 && lv1Done === lv1All && expandNew === 0) key = 'all_done'
  else if (lv1InProgress) key = 'lv1_progress'
  else if (lv1New > 0) key = 'lv1_new'
  else if (lv1All > 0 && lv1Done === lv1All) key = 'lv1_done'
  else if (expandNew > 0) key = 'expand_only'
  else key = 'lv1_no_new'

  const templateRaw = dict[key] || dict.lv1_no_new || ''
  const template = pickOne(templateRaw)
  const lv1Remaining = lv1All - lv1Done
  const text = fillTemplate(template, { lv1New, expandNew, lv1Done, lv1All, lv1Remaining })

  $('naviImage').src = assetPath(char.eyes)
  $('naviName').textContent = char.name
  $('naviLine').textContent = text
  naviEl.hidden = false
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\$\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''))
}

function pickOne(v) {
  if (Array.isArray(v)) return v[Math.floor(Math.random() * v.length)] || ''
  return v || ''
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
  const shown = localStorage.getItem('ohayominext_rewardShownAt')
  if (shown === today) return
  if (lastRewardShownDate === today) return

  lastRewardShownDate = today
  localStorage.setItem('ohayominext_rewardShownAt', today)

  const wk = weekdayKey()
  const char = lines.characters[wk]
  const rewardLines = lines.reward[wk] || []
  const line = rewardLines[Math.floor(Math.random() * rewardLines.length)] || 'おつかれさま'

  $('rewardImage').src = assetPath(char.chibi)
  $('rewardName').textContent = char.name
  $('rewardLine').textContent = line
  openModal(rewardModal)
}

$('rewardCloseBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  closeModal(rewardModal)
})

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
  localStorage.removeItem('ohayominext_rewardShownAt')
  lastRewardShownDate = null
  render()
  closeModal(settingsModal)
})

const exportModal = $('exportModal')
const importModal = $('importModal')
const exportText = $('exportText')
const importText = $('importText')
const importError = $('importError')

$('exportBtn').addEventListener('click', () => {
  exportText.value = exportData()
  closeModal(settingsModal)
  openModal(exportModal)
  setTimeout(() => {
    exportText.focus()
    exportText.select()
  }, 100)
})

$('exportCopyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportText.value)
    $('exportCopyBtn').textContent = 'コピーしました'
    setTimeout(() => { $('exportCopyBtn').textContent = 'コピー' }, 1500)
  } catch {
    exportText.select()
    document.execCommand('copy')
    $('exportCopyBtn').textContent = 'コピーしました'
    setTimeout(() => { $('exportCopyBtn').textContent = 'コピー' }, 1500)
  }
})

$('exportCloseBtn').addEventListener('click', () => closeModal(exportModal))

$('importBtn').addEventListener('click', () => {
  importText.value = ''
  importError.textContent = ''
  closeModal(settingsModal)
  openModal(importModal)
  setTimeout(() => importText.focus(), 100)
})

$('importConfirmBtn').addEventListener('click', () => {
  const json = importText.value.trim()
  if (!json) {
    importError.textContent = 'テキストを貼り付けてください'
    return
  }
  try {
    importData(json)
    render()
    closeModal(importModal)
    refreshAllCreators()
  } catch {
    importError.textContent = '読み込みに失敗しました。正しい形式のテキストを貼り付けてください。'
  }
})

$('importCancelBtn').addEventListener('click', () => closeModal(importModal))

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
      <span class="archived-name">${escapeHtml(c.name)}</span>
      <div class="archived-actions">
        <button class="btn btn-secondary" data-restore="${c.id}">復帰</button>
        <button class="btn btn-danger" data-delete="${c.id}">削除</button>
      </div>
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

  archivedList.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delete
      const creator = getArchivedCreators().find((c) => c.id === id)
      if (!creator) return
      if (!confirm(`「${creator.name}」を完全に削除しますか？この操作は取り消せません。`)) return
      deleteCreator(id)
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

// --- Debug ---

function isDebugMode() {
  return new URLSearchParams(window.location.search).has('debug')
}

function shiftTimeBackward(days) {
  // days > 0: 時計を進めた扱い（既存データを過去へ）
  // days < 0: 時計を戻す扱い（既存データを未来へ）
  const ms = days * 24 * 60 * 60 * 1000
  const creators = JSON.parse(localStorage.getItem('ohayominext_creators') || '[]')
  creators.forEach((c) => {
    if (c.lastVisitedAt) {
      c.lastVisitedAt = new Date(new Date(c.lastVisitedAt).getTime() - ms).toISOString()
    }
    if (c.lastApiCheckedAt) {
      c.lastApiCheckedAt = new Date(new Date(c.lastApiCheckedAt).getTime() - ms).toISOString()
    }
  })
  localStorage.setItem('ohayominext_creators', JSON.stringify(creators))

  // lastResetAt も過去にずらす（+方向の時は次回 render で自動リセットが走るように過去に寄せる）
  if (days > 0) {
    // 進める方向: 最後のリセットを十分過去に置いて、checkAndResetIfNeeded でリセットを走らせる
    localStorage.removeItem('ohayominext_lastResetAt')
  } else {
    // 戻す方向: lastResetAt は触らない（今日のままでOK）
  }

  // dailyStatus は完全にクリア（read/commented/expandIds すべて）
  localStorage.removeItem('ohayominext_dailyStatus')
  localStorage.removeItem('ohayominext_rewardShownAt')
}

if (isDebugMode()) {
  const panel = $('debugPanel')
  if (panel) panel.hidden = false
  document.querySelectorAll('[data-shift-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.shiftDays, 10)
      shiftTimeBackward(days)
      checkAndResetIfNeeded()
      render()
    })
  })
}

// --- Sort modal ---

const sortModal = $('sortModal')
const sortList = $('sortList')
let currentSortSection = null

const SECTION_LABELS = {
  lv1: 'コミュニティ',
  expand: 'ひろがり',
  slow: 'ゆっくり',
}

function openSortModal(section) {
  currentSortSection = section
  $('sortModalTitle').textContent = SECTION_LABELS[section] + 'の並び替え'
  renderSortList()
  openModal(sortModal)
}

function getSectionCreators(section) {
  const creators = getActiveCreators()
  const byOrder = (a, b) => a.order - b.order
  if (section === 'lv1') {
    return creators.filter((c) => c.level === LEVELS.LV1).sort(byOrder)
  }
  if (section === 'expand') {
    return creators.filter((c) => c.level !== LEVELS.LV1 && isInTodayExpand(c.id)).sort(byOrder)
  }
  if (section === 'slow') {
    return creators.filter((c) => c.level !== LEVELS.LV1 && !isInTodayExpand(c.id)).sort(byOrder)
  }
  return []
}

function renderSortList() {
  const list = getSectionCreators(currentSortSection)
  if (list.length === 0) {
    sortList.innerHTML = '<p class="sort-empty">該当する人はいません。</p>'
    return
  }
  sortList.innerHTML = list
    .map(
      (c, i) => `
    <div class="sort-item">
      <div class="card-icon">${
        c.iconUrl ? `<img src="${encodeURI(c.iconUrl)}" alt="" />` : '👤'
      }</div>
      <span class="sort-name">${escapeHtml(c.name)}</span>
      <div class="sort-btns">
        <button class="sort-btn" data-move-up="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
        <button class="sort-btn" data-move-down="${c.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button>
      </div>
    </div>
  `
    )
    .join('')

  sortList.querySelectorAll('[data-move-up]').forEach((btn) => {
    btn.addEventListener('click', () => moveSortItem(btn.dataset.moveUp, -1))
  })
  sortList.querySelectorAll('[data-move-down]').forEach((btn) => {
    btn.addEventListener('click', () => moveSortItem(btn.dataset.moveDown, 1))
  })
}

function moveSortItem(id, direction) {
  const list = getSectionCreators(currentSortSection)
  const idx = list.findIndex((c) => c.id === id)
  const swapIdx = idx + direction
  if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return

  // 該当2人のorderを入れ替える
  const a = list[idx]
  const b = list[swapIdx]
  const aOrder = a.order
  updateCreator(a.id, { order: b.order })
  updateCreator(b.id, { order: aOrder })

  renderSortList()
  render()
}

document.querySelectorAll('[data-sort-section]').forEach((btn) => {
  btn.addEventListener('click', () => {
    openSortModal(btn.dataset.sortSection)
  })
})

$('sortCloseBtn').addEventListener('click', () => {
  currentSortSection = null
  closeModal(sortModal)
})

// --- Version update notice ---

const APP_VERSION = __APP_VERSION__
const VERSION_KEY = 'ohayominext_lastSeenVersion'

// ヘッダーにバージョン表示
$('headerVersion').textContent = 'v' + APP_VERSION

async function checkVersionUpdate() {
  const lastSeen = localStorage.getItem(VERSION_KEY)
  if (lastSeen === APP_VERSION) return

  // 現バージョンの更新内容を取得
  let items = null
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'updates.json?t=' + Date.now())
    if (res.ok) {
      const data = await res.json()
      items = data[APP_VERSION]
    }
  } catch {
    // 失敗時はモーダルを出さない
  }

  if (!items || items.length === 0) {
    localStorage.setItem(VERSION_KEY, APP_VERSION)
    return
  }

  $('updateVersion').textContent = 'v' + APP_VERSION
  $('updateBody').innerHTML = items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')
  const modal = $('updateModal')
  openModal(modal)
  $('updateCloseBtn').addEventListener('click', () => {
    localStorage.setItem(VERSION_KEY, APP_VERSION)
    closeModal(modal)
  }, { once: true })
}

// --- Init ---

runMigrationIfNeeded()
checkAndResetIfNeeded()
render()
refreshAllCreators()
checkVersionUpdate()
