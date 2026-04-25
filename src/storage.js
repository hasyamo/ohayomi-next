const KEYS = {
  creators: 'ohayominext_creators',
  dailyStatus: 'ohayominext_dailyStatus',
  lastResetAt: 'ohayominext_lastResetAt',
  streak: 'ohayominext_streak',
  pendingCreatorId: 'ohayominext_pendingCreatorId',
  schemaVersion: 'ohayominext_schemaVersion',
}

const CURRENT_SCHEMA_VERSION = 2

const LEVELS = {
  LV1: 'lv1',
  LV2: 'lv2',
  LV3: 'lv3',
}

const ROTATION_DAYS = {
  lv2: 7,
  lv3: 30,
}

// --- Migration ---

export function runMigrationIfNeeded() {
  const current = parseInt(localStorage.getItem(KEYS.schemaVersion) || '1', 10)
  if (current >= CURRENT_SCHEMA_VERSION) return false

  const raw = localStorage.getItem(KEYS.creators)
  if (raw) {
    const creators = JSON.parse(raw)
    const migrated = creators.map((c) => {
      const next = { ...c }
      // lastCheckedAt → lastApiCheckedAt
      if ('lastCheckedAt' in next && !('lastApiCheckedAt' in next)) {
        next.lastApiCheckedAt = next.lastCheckedAt
        delete next.lastCheckedAt
      }
      // lastVisitedAt 初期値: 既存 lastCheckedAt を流用
      if (!('lastVisitedAt' in next)) {
        next.lastVisitedAt = next.lastApiCheckedAt || null
      }
      // level 初期値: アクティブは lv2、アーカイブも lv2（復帰時に使える）
      if (!('level' in next)) {
        next.level = LEVELS.LV2
      }
      // headerImageUrl は未取得でOK
      if (!('headerImageUrl' in next)) {
        next.headerImageUrl = null
      }
      return next
    })
    localStorage.setItem(KEYS.creators, JSON.stringify(migrated))
  }

  localStorage.setItem(KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION))
  return true
}

// --- Creators ---

export function getCreators() {
  return JSON.parse(localStorage.getItem(KEYS.creators) || '[]')
}

export function getActiveCreators() {
  return getCreators()
    .filter((c) => !c.archived)
    .sort((a, b) => a.order - b.order)
}

export function getArchivedCreators() {
  return getCreators().filter((c) => c.archived)
}

function saveCreators(creators) {
  localStorage.setItem(KEYS.creators, JSON.stringify(creators))
}

export function addCreator(username, name) {
  const creators = getCreators()
  const exists = creators.find((c) => c.username === username)
  if (exists) return null

  // note.com URL は # より前の本来の username で組み立てる
  const baseUsername = username.indexOf('#') >= 0 ? username.slice(0, username.indexOf('#')) : username

  const maxOrder = creators.reduce((max, c) => Math.max(max, c.order), 0)
  const creator = {
    id: 'c' + Date.now(),
    username,
    name: name || username,
    url: `https://note.com/${baseUsername}`,
    iconUrl: null,
    headerImageUrl: null,
    order: maxOrder + 1,
    archived: false,
    level: LEVELS.LV2,
    lastKnownArticleCount: null,
    lastApiCheckedAt: null,
    lastVisitedAt: null,
  }
  creators.push(creator)
  saveCreators(creators)
  return creator
}

export function updateCreator(id, updates) {
  const creators = getCreators()
  const idx = creators.findIndex((c) => c.id === id)
  if (idx === -1) return null
  Object.assign(creators[idx], updates)
  saveCreators(creators)
  return creators[idx]
}

export function reorderCreators(orderedIds) {
  const creators = getCreators()
  orderedIds.forEach((id, i) => {
    const c = creators.find((c) => c.id === id)
    if (c) c.order = i + 1
  })
  saveCreators(creators)
}

export function deleteCreator(id) {
  const creators = getCreators().filter((c) => c.id !== id)
  saveCreators(creators)

  // dailyStatus からも片付ける
  const daily = getDailyStatus()
  if (daily.items && daily.items[id]) {
    delete daily.items[id]
  }
  if (Array.isArray(daily.expandIds)) {
    daily.expandIds = daily.expandIds.filter((x) => x !== id)
  }
  saveDailyStatus(daily)
}

// --- Level ---

export { LEVELS, ROTATION_DAYS }

export function setCreatorLevel(id, level) {
  if (!Object.values(LEVELS).includes(level)) return null
  return updateCreator(id, { level })
}

// --- Rotation ---

function daysSince(iso, now = new Date()) {
  if (!iso) return Infinity
  const then = new Date(iso)
  const ms = now.getTime() - then.getTime()
  return ms / (1000 * 60 * 60 * 24)
}

// 今日の枠に入るか（lv1は常時 true / lv2/lv3は最終訪問からの経過日数で判定）
export function isInTodayRotation(creator, now = new Date()) {
  if (creator.level === LEVELS.LV1) return true
  const threshold = ROTATION_DAYS[creator.level]
  if (!threshold) return true
  return daysSince(creator.lastVisitedAt, now) >= threshold
}

// --- New article flag ---

export function hasNewArticles(creator) {
  if (creator.lastKnownArticleCount === null) return false
  if (creator.articleCountAtLastVisit === undefined || creator.articleCountAtLastVisit === null) {
    return creator.hasNew === true
  }
  return creator.lastKnownArticleCount > creator.articleCountAtLastVisit
}

export function newArticleCount(creator) {
  if (creator.lastKnownArticleCount === null) return 0
  const base = creator.articleCountAtLastVisit
  if (base === undefined || base === null) return creator.hasNew ? 1 : 0
  return Math.max(0, creator.lastKnownArticleCount - base)
}

// --- Daily Status ---

export function getDailyStatus() {
  return JSON.parse(localStorage.getItem(KEYS.dailyStatus) || '{}')
}

function saveDailyStatus(status) {
  localStorage.setItem(KEYS.dailyStatus, JSON.stringify(status))
}

export function getCreatorStatus(creatorId) {
  const daily = getDailyStatus()
  const item = daily.items?.[creatorId]
  return {
    read: item?.read || false,
    commented: item?.commented || false,
  }
}

export function setCreatorStatus(creatorId, { read, commented }) {
  const daily = getDailyStatus()
  if (!daily.items) daily.items = {}
  daily.items[creatorId] = {
    read,
    commented,
    updatedAt: (read || commented) ? new Date().toISOString() : null,
  }
  saveDailyStatus(daily)
}

// 読んだ / コメントしたを記録すると同時に lastVisitedAt と articleCountAtLastVisit を更新
export function markVisit(creatorId, { articleCount } = {}) {
  const nowIso = new Date().toISOString()
  const updates = { lastVisitedAt: nowIso }
  if (typeof articleCount === 'number') {
    updates.articleCountAtLastVisit = articleCount
    updates.lastKnownArticleCount = articleCount
  }
  return updateCreator(creatorId, updates)
}

// --- Daily Reset ---

export function getLastResetAt() {
  return localStorage.getItem(KEYS.lastResetAt)
}

function saveLastResetAt(isoString) {
  localStorage.setItem(KEYS.lastResetAt, isoString)
}

export function checkAndResetIfNeeded() {
  const now = new Date()
  const today5am = new Date(now)
  today5am.setHours(5, 0, 0, 0)

  if (now < today5am) {
    today5am.setDate(today5am.getDate() - 1)
  }

  const lastResetAt = getLastResetAt()
  if (!lastResetAt || new Date(lastResetAt) < today5am) {
    resetAllStatus()
    saveLastResetAt(now.toISOString())
    return true
  }
  return false
}

export function resetAllStatus() {
  const creators = getActiveCreators()
  // 今日のひろがり枠を確定する（lv1以外で、今日のローテーション対象）
  const now = new Date()
  const expandIds = creators
    .filter((c) => c.level !== LEVELS.LV1 && isInTodayRotation(c, now))
    .map((c) => c.id)

  const daily = {
    dateKey: now.toISOString().slice(0, 10),
    items: {},
    expandIds,
  }
  creators.forEach((c) => {
    daily.items[c.id] = { read: false, commented: false, updatedAt: null }
  })
  saveDailyStatus(daily)
}

// 今日のひろがり枠に入っているか
// - 朝5時のリセット時に expandIds がスナップショットされる
// - 一度でもこの関数が true を返した相手は今日の枠に追加（加算のみ、減算なし）
export function isInTodayExpand(creatorId) {
  const daily = getDailyStatus()
  if (!Array.isArray(daily.expandIds)) return false
  return daily.expandIds.includes(creatorId)
}

// 今日のひろがり枠を再計算して、必要なら追加する（加算のみ）
// 日中はチェックのON/OFFや訪問によって枠から消えないことを保証する
export function refreshTodayExpand() {
  const daily = getDailyStatus()
  if (!Array.isArray(daily.expandIds)) daily.expandIds = []
  const now = new Date()
  const creators = getActiveCreators()
  const items = daily.items || {}
  const set = new Set(daily.expandIds)
  creators.forEach((c) => {
    if (c.level === LEVELS.LV1) return
    const eligible = isInTodayRotation(c, now) || (items[c.id] && (items[c.id].read || items[c.id].commented))
    if (eligible) set.add(c.id)
  })
  daily.expandIds = Array.from(set)
  saveDailyStatus(daily)
}

// --- Pending Creator (sessionStorage) ---

export function setPendingCreatorId(id) {
  sessionStorage.setItem(KEYS.pendingCreatorId, id)
}

export function getPendingCreatorId() {
  return sessionStorage.getItem(KEYS.pendingCreatorId)
}

export function clearPendingCreatorId() {
  sessionStorage.removeItem(KEYS.pendingCreatorId)
}

// --- Export / Import ---

export function exportData() {
  return JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    creators: getCreators(),
    dailyStatus: getDailyStatus(),
    lastResetAt: getLastResetAt(),
  }, null, 2)
}

export function importData(json) {
  const data = JSON.parse(json)
  if (data && data.creators) {
    saveCreators(data.creators)
    if (data.dailyStatus) saveDailyStatus(data.dailyStatus)
    if (data.lastResetAt) saveLastResetAt(data.lastResetAt)
    if (data.schemaVersion) {
      localStorage.setItem(KEYS.schemaVersion, String(data.schemaVersion))
    }
    runMigrationIfNeeded()
    return
  }
  if (Array.isArray(data)) {
    saveCreators(data)
    runMigrationIfNeeded()
    return
  }
  throw new Error('Invalid format')
}

// --- URL Parsing ---

export function parseNoteUrl(url) {
  const match = url.match(/note\.com\/([^\/\?#]+)/)
  if (!match || match[1] === 'api') return null
  const base = match[1]
  // URL末尾に #2 のような数字サフィックスがあれば、重複登録用のエイリアスとして保持
  const aliasMatch = url.match(/#(\d+)\s*$/)
  if (aliasMatch) {
    return `${base}#${aliasMatch[1]}`
  }
  return base
}
