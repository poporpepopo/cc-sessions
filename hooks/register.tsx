import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Proposal, SessionRow } from '../types'

const PANE = 'sessions'
const TITLE = 'Sessions'

const rows = atom({ plugin: 'sessions', key: 'rows' } as const, [])
const query = atom({ plugin: 'sessions', key: 'query' } as const, '')
const page = atom({ plugin: 'sessions', key: 'page' } as const, 0)
const proposals = atom({ plugin: 'sessions', key: 'proposals' } as const, [])
const note = atom({ plugin: 'sessions', key: 'note' } as const, '')

const nameOf = (r: SessionRow) => r.title || r.ai_title || r.first || '(空)'

// PATH に ~/.local/bin が無い起動 (GUI から開いた IDE など) でも動くよう絶対パスで呼ぶ
let ccsPath = ''
async function ccs($: EngineInterface, args: string[], stdin?: string) {
  if (!ccsPath) {
    const home = await $.env.get('HOME')
    ccsPath = home ? `${home}/.local/bin/ccs` : 'ccs' // HOME が取れなければ PATH から探す
  }
  return $.process.run([ccsPath, ...args], { timeoutMs: 60000, ...(stdin === undefined ? {} : { stdin }) })
}

async function load($: EngineInterface): Promise<SessionRow[]> {
  const out = await ccs($, ['--json', '-a'])
  if (out.exitCode !== 0) throw new Error(out.stderr.trim() || `ccs exited ${out.exitCode}`)
  if (out.isStdoutTruncated) throw new Error('ccs の出力が大きすぎて読み切れませんでした')
  const list: SessionRow[] = JSON.parse(out.stdout)
  await update($, rows, () => list)
  return list
}

function filtered(list: SessionRow[], q: string) {
  if (!q) return list
  const needle = q.toLowerCase()
  return list.filter(r =>
    [r.title, r.ai_title, r.first, r.last, r.cwd, r.id].join(' ').toLowerCase().includes(needle),
  )
}

const wide = (c: string) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c)
const cells = (s: string) => [...s].reduce((n, c) => n + (wide(c) ? 2 : 1), 0)
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - cells(s)))

const clip = (s: string, n: number) => {
  const one = (s || '').replace(/\s+/g, ' ').trim()
  if (cells(one) <= n) return one
  let out = ''
  for (const c of one) {
    if (cells(out + c) > n - 1) break
    out += c
  }
  return out + '…'
}

// モデルの返答から [{"i":0,"title":"..."}] を取り出す。前後に文章が付いても、壊れていても投げない
function parseTitles(text: string): { i: number; title: string }[] {
  const tries = [text.trim(), ...(text.match(/\[\s*\{[\s\S]*?\}\s*\]/g) ?? [])]
  for (const t of tries) {
    try {
      const v: unknown = JSON.parse(t)
      if (!Array.isArray(v)) continue
      return v.flatMap(x =>
        x && typeof x === 'object' && Number.isInteger((x as { i: unknown }).i) &&
        typeof (x as { title: unknown }).title === 'string'
          ? [{ i: (x as { i: number }).i, title: (x as { title: string }).title.replace(/\s+/g, ' ').trim() }]
          : [],
      )
    } catch {
      // 次の候補へ
    }
  }
  return []
}

async function suggest($: EngineInterface, targets: SessionRow[], self: string) {
  const out: Proposal[] = []
  let missed = 0
  for (let i = 0; i < targets.length; i += 20) {
    const chunk = targets.slice(i, i + 20)
    const items = chunk.map((r, j) => ({
      i: j,
      dir: r.place,
      auto_title: r.ai_title,
      first_prompt: clip(r.first, 300),
      last_prompt: clip(r.last, 200),
    }))
    const res = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 4000,
      timeoutMs: 90000,
      system:
        'あなたは Claude Code のセッションに名前を付ける係です。各セッションの内容から、' +
        '後で一覧を見て何の作業か一目で分かる日本語の名前を付けてください。' +
        '15〜25文字程度、名詞止め、具体的な対象(アプリ名・ツール名など)を含める。' +
        '出力は JSON 配列のみ (前後に文章を付けない): [{"i":0,"title":"..."}, ...]',
      prompt: JSON.stringify(items),
    })
    if (!res.isAnswered) throw new Error(`モデルの呼び出しに失敗しました (${res.reason})`)
    const seen = new Set<number>()
    for (const g of parseTitles(res.text)) {
      const r = chunk[g.i]
      if (!r || !g.title || seen.has(g.i)) continue
      seen.add(g.i)
      // 起動中の他セッションは外から書いても古い agent-name で書き戻されるので既定で除外
      const live = !!r.status && r.id !== self
      out.push({ id: r.id, old: nameOf(r), title: g.title, skip: live, live })
    }
    missed += chunk.length - seen.size
  }
  return { props: out, missed }
}

// ペインが描けない (VS Code、幅不足、-p) ときは一覧を文字で返す
async function asText($: EngineInterface, q: string, reason: string) {
  // 検索語が「-」で始まってもオプションと読まれないよう -- で区切る
  const out = await ccs($, ['--fallback', '-n', '30', '--', ...(q ? q.split(/\s+/) : [])])
  if (out.exitCode !== 0) throw new Error(out.stderr.trim() || `ccs exited ${out.exitCode}`)
  return `ペインを開けなかったので文字で表示します (${reason})\n${out.stdout.trimEnd()}`
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const resumeCommand = (r: SessionRow) => `cd ${shq(r.cwd)} && claude --resume ${shq(r.id)}`

// ターミナル.app の新しいウィンドウでセッションを開く。新しいウィンドウはログインシェルから
// 始まるので、このセッションの CLAUDE_CODE_SESSION_ID などは引き継がない
export async function openInWindow($: EngineInterface, r: SessionRow): Promise<{ text: string; copy?: true }> {
  if (r.id === (await $.session.id())) return { text: 'このセッションです' }
  // 別のウィンドウやデスクトップアプリで開いているものを二重に開くと記録が壊れる。
  // デーモン上 (bg) のものは --resume で接続し直せる
  if (r.status && r.kind !== 'bg') return { text: 'このセッションは別のウィンドウかアプリで開いています' }
  const as = resumeCommand(r).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  try {
    const out = await $.process.run(
      ['osascript', '-e', `tell application "Terminal" to do script "${as}"`, '-e', 'tell application "Terminal" to activate'],
      { timeoutMs: 15000 },
    )
    if (out.exitCode === 0) return { text: `新しいウィンドウで開きました: ${nameOf(r)}` }
    return { text: `開けなかったので再開コマンドをコピーしました (${out.stderr.trim().slice(0, 80)})`, copy: true }
  } catch (err) {
    return { text: `開けなかったので再開コマンドをコピーしました (${err instanceof Error ? err.message : String(err)})`, copy: true }
  }
}

let applying = false

// /sessions そのものは ~/.claude/commands/sessions.md が常に定義している
// (セッション単位の $.command.register は /clear や /resume で消えるため使わない)。
// この mod は実行時に割り込んで、モデルを通さずペインで答える。
// 失敗してもフォールバック (モデル経由) に落ちないよう、必ず自分で { text } を返す。
export const register: Register = on => {
  on('command.run', { command: 'sessions' }, async ($, e) => {
    const args = (e.args ?? '').trim()
    const [sub, opt] = args.split(/\s+/)
    try {
      if (sub === 'rename') {
        const list = await load($)
        const targets = list.filter(r => r.first && r.turns > 0 && (opt === 'all' || !r.title))
        if (targets.length === 0) {
          return { text: 'リネーム対象はありません (全部名前付き)。`/sessions rename all` で付け直せます。' }
        }
        // 案の確認と適用にはペインが要る。描けない環境ではモデルを呼ぶ前に止める
        const canDraw = await openPane($)
        if (!canDraw.isPlaced) {
          return { text: `rename はペインで確認してから適用するため、ペインを描けないこの環境では使えません (${canDraw.reason})。` }
        }
        $.ui.status(`${targets.length} 件の名前を考え中…`)
        let result
        try {
          result = await suggest($, targets, await $.session.id())
        } finally {
          $.ui.status(undefined)
        }
        const { props, missed } = result
        if (props.length === 0) {
          return { text: 'モデルの返答から名前案を読み取れませんでした。もう一度試してください。' }
        }
        await update($, proposals, () => props)
        await update($, page, () => 0)
        await update($, note, () => (missed ? `${missed} 件は案を作れませんでした` : ''))
        const live = props.filter(x => x.live).length
        return {
          text: `${props.length} 件のリネーム案を作りました${missed ? ` (${missed} 件は失敗)` : ''}。` +
            'ペインで確認して [a] で適用、数字/クリックで個別に除外できます。' +
            (live ? ` 起動中の ${live} 件は既定で除外しています (このセッション自身は /rename で付けます)。` : ''),
        }
      }

      await update($, query, () => args)
      await update($, page, () => 0)
      const list = filtered(await load($), args)
      const opened = await openPane($)
      const pending = (await read($, proposals)).length
      if (!opened.isPlaced) {
        const table = await asText($, args, opened.reason)
        return { text: pending ? `${table}\n(未適用のリネーム案 ${pending} 件はペインのある環境で確認できます)` : table }
      }
      return {
        text: `セッション ${list.length} 件${args ? ` (「${args}」で絞り込み)` : ''}` +
          (pending ? ` / 未適用のリネーム案 ${pending} 件をペインに表示中 ([x] で取消)` : ''),
      }
    } catch (err) {
      return { text: `エラー: ${err instanceof Error ? err.message : String(err)}` }
    }
  }).catch(($, e, next) => ({ text: `失敗しました (${next.error.kind}: ${next.error.message ?? ''})` }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    const room = Math.max(4, e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 30) - 6)
    const props = await read($, proposals)
    const msg = await read($, note)
    const stored = await read($, page)

    if (props.length > 0) {
      const per = Math.max(1, room - 4) // ボタン行・説明行・ページ行・メッセージ行
      const pages = Math.max(1, Math.ceil(props.length / per))
      const p = Math.min(stored, pages - 1)
      const shown = props.slice(p * per, p * per + per)
      const chosen = props.filter(x => !x.skip).length

      const apply = async () => {
        if (applying) return
        applying = true
        try {
          const list = await read($, proposals)
          let ok = 0
          const failed: string[] = []
          const self = await $.session.id()
          for (const x of list) {
            if (x.skip) continue
            try {
              if (x.id === self) {
                // 自分自身は本物の /rename で (メモリ上の名前も変わる)
                await $.command.run({ command: 'rename', args: x.title })
                ok++
                continue
              }
              const r = await ccs($, ['--set-title', x.id, '-'], x.title)
              if (r.exitCode === 0) ok++
              else failed.push(`${x.title}: ${r.stderr.trim()}`)
            } catch (err) {
              failed.push(`${x.title}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
          await update($, proposals, () => [])
          await update($, page, () => 0)
          await update($, note, () =>
            `${ok} 件リネームしました${failed.length ? ` / 失敗 ${failed.length} 件: ${failed[0]}` : ''}`)
          await load($).catch(() => {})
          $.ui.toast(`${ok} 件のセッション名を更新しました`)
        } finally {
          applying = false
        }
      }
      const cancel = async () => {
        await update($, proposals, () => [])
        await update($, page, () => 0)
        await update($, note, () => 'リネームを取り消しました')
      }
      const half = Math.max(10, Math.floor((cols - 8) / 2))
      return (
        <Box flexDirection="column" width={cols}>
          <Box gap={2}>
            <Button hotkey="a" onPress={apply}>{`適用 (${chosen}/${props.length}件)`}</Button>
            <Button hotkey="x" onPress={cancel}>取消</Button>
            {pages > 1 && <Button hotkey="p" onPress={() => update($, page, n => Math.max(0, Math.min(n, pages - 1) - 1))}>前</Button>}
            {pages > 1 && <Button hotkey="n" onPress={() => update($, page, n => Math.min(pages - 1, n + 1))}>次</Button>}
            {pages > 1 && <Text dimColor>{`${p + 1}/${pages}`}</Text>}
          </Box>
          <Text dimColor>行を押す (1-9) と除外/戻す。「旧 → 新」 全ページの未除外分が適用されます</Text>
          {msg ? <Text color="yellow">{msg}</Text> : null}
          {shown.map((x, i) => (
            <Button
              key={x.id}
              plain
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={() =>
                update($, proposals, l => l.map(y => (y.id === x.id ? { ...y, skip: !y.skip } : y)))
              }
            >
              {x.live ? <Text color="yellow">起動中 </Text> : null}
              <Text dimColor strikethrough={x.skip}>{clip(x.old, half - (x.live ? 9 : 2))}</Text>
              {' → '}
              <Text bold={!x.skip} color={x.skip ? undefined : 'green'} strikethrough={x.skip}>
                {clip(x.title, half)}
              </Text>
            </Button>
          ))}
        </Box>
      )
    }

    const q = await read($, query)
    const list = filtered(await read($, rows), q)
    const per = Math.max(1, room - 3) // ボタン行・メッセージ行・凡例行
    const pages = Math.max(1, Math.ceil(list.length / per))
    const p = Math.min(stored, pages - 1)
    const shown = list.slice(p * per, p * per + per)
    const placeW = 16
    const agoW = 8
    const titleW = Math.max(12, cols - placeW - agoW - 8)

    return (
      <Box flexDirection="column" width={cols}>
        <Box gap={2}>
          <Text bold>{`${list.length}件${q ? ` 「${q}」` : ''}  ${p + 1}/${pages}`}</Text>
          <Button hotkey="p" onPress={() => update($, page, n => Math.max(0, Math.min(n, pages - 1) - 1))}>前</Button>
          <Button hotkey="n" onPress={() => update($, page, n => Math.min(pages - 1, n + 1))}>次</Button>
          <Button
            hotkey="r"
            onPress={async () => {
              try {
                await load($)
              } catch (err) {
                await update($, note, () => `更新に失敗: ${err instanceof Error ? err.message : String(err)}`)
              }
            }}
          >
            更新
          </Button>
        </Box>
        {msg ? <Text color="green">{msg}</Text> : null}
        {shown.map(r => (
          <Button
            key={r.id}
            plain
            onPress={async press => {
              const msg = await openInWindow($, r)
              if (msg.copy) await $.ui.copy({ text: resumeCommand(r), surface: press.surface })
              $.ui.toast(msg.text)
            }}
          >
            <Text color={r.status === 'busy' ? 'green' : 'yellow'}>
              {r.status === 'busy' ? '● ' : r.status ? '○ ' : '  '}
            </Text>
            <Text dimColor>{pad(r.ago, agoW)}</Text>
            {' '}
            <Text color="cyan">{pad(clip(r.place, placeW), placeW)}</Text>
            {'  '}
            <Text bold={!!r.title}>{clip(nameOf(r), titleW)}</Text>
          </Button>
        ))}
        <Text dimColor>● 実行中 ○ 待機中 / 行を押す: 新しいウィンドウで開く / Esc 閉じる</Text>
      </Box>
    )
  })
}
