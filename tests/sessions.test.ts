import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROWS = [
  { id: 'aaa', title: '', ai_title: 'Pixel10のリモートデバッグ', first: 'adb で接続したい', last: 'ok',
    cwd: '/Users/me/Developer', place: '~/Developer', branch: '', ago: '2分前', status: 'busy', turns: 3 },
  { id: 'bbb', title: '名前付き', ai_title: 'x', first: 'hello', last: 'bye',
    cwd: '/Users/me', place: '~', branch: '', ago: '2日前', status: '', turns: 2 },
  { id: 'ccc', title: '', ai_title: '別ウィンドウ', first: '作業中', last: '…',
    cwd: '/Users/me', place: '~', branch: '', ago: '1分前', status: 'idle', turns: 1 },
  { id: 'ddd', title: '', ai_title: '終わった作業', first: 'メモ', last: 'ok',
    cwd: "/Users/me/it's", place: '~', branch: '', ago: '3日前', status: '', turns: 1 },
  { id: 'eee', title: 'デーモン上', ai_title: '', first: 'bg', last: 'bg',
    cwd: '/Users/me', place: '~', branch: '', ago: '5分前', status: 'idle', kind: 'bg', turns: 1 },
]

const PANE = {
  plugin: 'sessions',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'sessions',
  viewport: { columns: 100, rows: 30 },
  props: {
    title: 'Sessions', isFocused: true, bodyColumns: 100, placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 }, view: {},
  },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

type Call = { argv: string[]; stdin?: string }

// ccs・モデル・ペインを差し替える。placed=false でペインが描けない環境を模す
// windows=true で Windows (環境変数 OS が Windows_NT) を模す。run で process.run の結果を argv ごとに変える
type Opts = {
  modelText?: string; placed?: boolean; ccsFails?: boolean; noHome?: boolean; windows?: boolean
  run?: (argv: string[]) => { exitCode?: number; stderr?: string } | undefined
}

function world(on: On, opts: Opts = {}) {
  const calls: Call[] = []
  const renamed: string[] = []
  let modelCalls = 0
  on('env.get', async (_$, e) => ({
    value: e.name === 'OS' ? (opts.windows ? 'Windows_NT' : undefined) : opts.noHome ? undefined : '/Users/me',
  }) as never)
  on('session.id', async () => ({ value: 'aaa' })) // このセッション自身は aaa
  on('command.run', { command: 'rename' }, async (_$, e) => {
    renamed.push(e.args)
    return { text: `Session renamed to: ${e.args}` }
  })
  on('process.run', async (_$, e) => {
    calls.push({ argv: [...e.argv], stdin: e.init?.stdin })
    if (opts.ccsFails) throw new Error('spawn ENOENT')
    const out = e.argv.includes('--json') ? JSON.stringify(ROWS) : e.argv.includes('--fallback') ? 'TABLE' : ''
    const over = opts.run?.([...e.argv]) // 投げれば「起動できない」
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...over } }
  })
  on('model.complete', async () => (modelCalls++, {
    value: {
      isAnswered: true,
      text: opts.modelText ?? '[{"i":0,"title":"Pixel 10 のワイヤレスADB接続"},{"i":1,"title":"別窓の作業"},{"i":2,"title":"メモの整理"}]',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }) as never)
  on('ui.open', async () =>
    ({ value: opts.placed === false ? { isPlaced: false, reason: 'too narrow' } : { isPlaced: true } }) as never)
  const toasts: string[] = []
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => (toasts.push(e.text), { value: undefined }))
  const copied: string[] = []
  on('ui.copy', async (_$, e) => (copied.push(e.text), { value: {} }) as never)
  return { calls, renamed, toasts, copied, models: () => modelCalls }
}

test('行を押すと新しいウィンドウで開く。自分自身と別の場所で開いているものは開かない', async ($, on) => {
  const { calls, toasts } = world(on)
  await $.command.run({ ...RUN, command: 'sessions', args: '' })
  const ui = await $.ui.mount(PANE)
  const osa = () => calls.filter(c => c.argv[0] === 'osascript')

  await ui.press({ key: 'aaa' })
  expect(toasts.at(-1)).toBe('このセッションです')
  await ui.press({ key: 'ccc' })
  expect(toasts.at(-1)).toContain('別のウィンドウかアプリで開いています')
  expect(osa().length).toBe(0)

  // 終わったセッション: cd 先の ' もエスケープしてターミナル.app に渡す
  await ui.press({ key: 'ddd' })
  // シェルの '\'' の \ は、AppleScript の文字列の中では \\ と書く
  expect(osa()[0]?.argv[2]).toBe(`tell application "Terminal" to do script "cd '/Users/me/it'\\\\''s' && claude --resume 'ddd'"`)
  expect(toasts.at(-1)).toContain('新しいウィンドウで開きました')

  // デーモン上で動いているものは --resume で接続し直せるので開く
  await ui.press({ key: 'eee' })
  expect(osa().length).toBe(2)
})

test('osascript が失敗したら、シェルに貼れる再開コマンドをコピーする', async ($, on) => {
  const { toasts, copied } = world(on, { run: argv => (argv[0] === 'osascript' ? { exitCode: 1, stderr: 'not allowed' } : undefined) })
  await $.command.run({ ...RUN, command: 'sessions', args: '' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'ddd' })
  expect(toasts.at(-1)).toContain('再開コマンドをコピーしました (not allowed)')
  expect(copied).toEqual([`cd '/Users/me/it'\\''s' && claude --resume 'ddd'`])
})

test('Windows では bin/ccs を py -3 で動かし、行を押すと ccs --open-window で開く', async ($, on) => {
  const { calls, toasts, copied } = world(on, { windows: true })
  await $.command.run({ ...RUN, command: 'sessions', args: '' })
  // 最初に py -3 が使えるか確かめてから、mod のフォルダの bin/ccs を絶対パスで渡す
  expect(calls[0]?.argv).toEqual(['py', '-3', '-c', 'pass'])
  expect(calls[1]?.argv.slice(0, 2)).toEqual(['py', '-3'])
  expect(calls[1]?.argv[2]).toMatch(/[\\/]bin\\ccs$/)
  expect(calls[1]?.argv.slice(3)).toEqual(['--json', '-a'])

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'aaa' })
  await ui.press({ key: 'ccc' })
  expect(calls.some(c => c.argv.includes('--open-window'))).toBe(false)
  await ui.press({ key: 'ddd' })
  expect(calls.at(-1)?.argv.slice(3)).toEqual(['--open-window', 'ddd'])
  expect(toasts.at(-1)).toContain('新しいウィンドウで開きました')
  expect(calls.some(c => c.argv[0] === 'osascript')).toBe(false)
  expect(copied).toEqual([])
})

test('Windows で py が無ければ python で動かす', async ($, on) => {
  const { calls } = world(on, {
    windows: true,
    run: argv => {
      if (argv[0] === 'py') throw new Error('spawn py ENOENT')
      return undefined
    },
  })
  const res = await $.command.run({ ...RUN, command: 'sessions', args: '' })
  expect(res.text).toContain('5 件')
  expect(calls[1]?.argv[0]).toBe('python')
  expect(calls[1]?.argv[1]).toMatch(/[\\/]bin\\ccs$/)
  expect(calls[1]?.argv.slice(2)).toEqual(['--json', '-a'])
})

test('Windows で開けなければ PowerShell に貼れる再開コマンドをコピーし、開いている最中のものはコピーしない', async ($, on) => {
  let code = 1
  const { toasts, copied } = world(on, {
    windows: true,
    run: argv => (argv.includes('--open-window') ? { exitCode: code, stderr: 'ccs: claude が見つかりません' } : undefined),
  })
  await $.command.run({ ...RUN, command: 'sessions', args: '' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'ddd' })
  expect(toasts.at(-1)).toContain('再開コマンドをコピーしました (ccs: claude が見つかりません)')
  // PowerShell の ' は '' と書く。&& は 5.1 に無いので ; で続ける
  expect(copied).toEqual([`Set-Location -LiteralPath '/Users/me/it''s'; claude --resume 'ddd'`])

  code = 3 // ccs が「別の場所で開いている」と答えた (一覧を読んだあとに開かれた)
  await ui.press({ key: 'eee' })
  expect(toasts.at(-1)).toContain('別のウィンドウかアプリで開いています')
  expect(copied.length).toBe(1)
})

test('一覧を出し、AI 案を適用すると無名のセッションだけに名前を付ける', async ($, on) => {
  const { calls, renamed } = world(on)

  const list = await $.command.run({ ...RUN, command: 'sessions', args: '' })
  expect(list.text).toContain('5 件')
  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /Pixel10のリモートデバッグ/ })).toBeDefined()
  expect(await ui.find({ text: /名前付き/ })).toBeDefined()
  await ui.unmount()

  const res = await $.command.run({ ...RUN, command: 'sessions', args: 'rename' })
  expect(res.text).toContain('3 件')
  expect(res.text).toContain('起動中の 1 件は既定で除外')
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /ワイヤレスADB接続/ })).toBeDefined()
  expect(await ui.find({ text: /起動中/ })).toBeDefined()
  await ui.press({ key: '適用 (2/3件)' })

  // このセッション自身 (aaa) は本物の /rename、終わったセッションは ccs (絶対パス・名前は stdin)
  expect(renamed).toEqual(['Pixel 10 のワイヤレスADB接続'])
  expect(calls).toContainEqual({ argv: ['/Users/me/.local/bin/ccs', '--set-title', 'ddd', '-'], stdin: 'メモの整理' })
  // 名前付きの bbb と、別プロセスで起動中の ccc には書かない
  expect(calls.some(c => c.argv[1] === '--set-title' && (c.argv[2] === 'bbb' || c.argv[2] === 'ccc' || c.argv[2] === 'aaa'))).toBe(false)
})

test('モデルが説明文付きで返しても名前案を拾い、読めなければエラーを返す', async ($, on) => {
  world(on, { modelText: '以下です。\n[{"i":0,"title":"案A"}]\n補足: [注] は無視' })
  const ok = await $.command.run({ ...RUN, command: 'sessions', args: 'rename' })
  expect(ok.text).toContain('1 件のリネーム案')
})

test('名前案が 0 件なら「作りました」と言わない', async ($, on) => {
  world(on, { modelText: 'すみません、できません' })
  const res = await $.command.run({ ...RUN, command: 'sessions', args: 'rename' })
  expect(res.text).toContain('読み取れませんでした')
})

test('ペインが描けない環境では一覧を文字で返し、検索語はオプションと読まれないよう -- の後ろに渡す', async ($, on) => {
  const { calls } = world(on, { placed: false })
  const res = await $.command.run({ ...RUN, command: 'sessions', args: '--set-title x' })
  expect(res.text).toContain('TABLE')
  expect(calls).toContainEqual({ argv: ['/Users/me/.local/bin/ccs', '--fallback', '-n', '30', '--', '--set-title', 'x'], stdin: undefined })
})

test('ペインが描けない環境の rename はモデルを呼ぶ前に止める', async ($, on) => {
  const w = world(on, { placed: false })
  const res = await $.command.run({ ...RUN, command: 'sessions', args: 'rename' })
  expect(res.text).toContain('使えません')
  expect(w.models()).toBe(0)
})

test('HOME が取れなければ PATH の ccs を使う', async ($, on) => {
  const { calls } = world(on, { noHome: true })
  await $.command.run({ ...RUN, command: 'sessions', args: '' })
  expect(calls[0]?.argv[0]).toBe('ccs')
})

test('ccs が起動できなくてもフォールバック (モデル経由) に落ちずエラーを表示する', async ($, on) => {
  world(on, { ccsFails: true })
  const res = await $.command.run({ ...RUN, command: 'sessions', args: '' })
  expect(res.text).toContain('エラー')
})
