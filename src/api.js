const PROXY_URL = 'https://falling-mouse-736b.hasyamo.workers.dev/'

// 「hasyamo#2」のような複製用サフィックスを落とす
function stripAlias(username) {
  const hash = username.indexOf('#')
  return hash >= 0 ? username.slice(0, hash) : username
}

export async function fetchCreator(username) {
  const id = stripAlias(username)
  const url = `${PROXY_URL}?id=${encodeURIComponent(id)}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }

  const json = await res.json()
  if (!json.data) {
    throw new Error('クリエイターが見つかりませんでした')
  }

  return {
    nickname: json.data.nickname,
    profileImageUrl: json.data.profileImageUrl,
    headerImageUrl: json.data.headerImageUrl || null,
    noteCount: json.data.noteCount,
    followerCount: json.data.followerCount ?? null,
  }
}
