# cc-sessions

Claude Code のセッション一覧を、Claude Code の中のペインで一目で見るための mod です。名前のないセッションに AI で名前案を付けて、まとめてリネームすることもできます。

```
26件  1/2  [ 前 ] [ 次 ] [ 更新 ]
● たった今  ~/Developer       セッション一覧ツール作成（ccs・/sessions）
○ 13分前    ~                 spinnerVerbs 豆知識ランダム化・Tips拡充
  2日前     ~                 Android 写真・動画のルーター自動バックアップアプリ
● 実行中 ○ 待機中 / 行を押す: 新しいウィンドウで開く / Esc 閉じる
```

## 中身

| パス | 役割 |
|---|---|
| `hooks/register.tsx` | mod 本体。`/sessions` に割り込んでペインを開く |
| `bin/ccs` | セッション一覧の CLI (Python 3)。mod はこれを呼んで一覧を作る |
| `extras/sessions.md` | `/sessions` コマンドの定義。mod が読み込まれていないときの代わりの表示も兼ねる |

`/sessions` をコマンドのファイルで常に定義しているのは、mod の `$.command.register` による登録がセッション単位で、`/clear` や `/resume` のあとに消えてしまうためです。

## 入れる

```sh
git clone https://github.com/poporpepopo/cc-sessions ~/Developer/cc-sessions
ln -s ~/Developer/cc-sessions/bin/ccs ~/.local/bin/ccs
mkdir -p ~/.claude/commands
ln -s ~/Developer/cc-sessions/extras/sessions.md ~/.claude/commands/sessions.md
```

`~/.claude/settings.json` に次を追加します。複数のフォルダは `:` で区切ります。

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Developer/cc-sessions" }
```

設定を変える前から動いている Claude Code には読み込まれません。バックグラウンドで動いているセッションは `/exit` しても終わらないので、`claude daemon stop --any` で止めてから開き直します。

## 使う

| コマンド | 動き |
|---|---|
| `/sessions` | ペインで一覧を開く |
| `/sessions 検索語` | タイトル・プロンプト・ディレクトリで絞り込む |
| `/sessions rename` | 名前のないセッションに Haiku で名前案を作り、ペインで確認して `[a]` で適用 |
| `/sessions rename all` | 名前の付いたセッションも含めて付け直す |

- 行を押すと、ターミナル.app の新しいウィンドウでそのセッションを `claude --resume` します。別のウィンドウやデスクトップアプリで開いているセッションは、二重に開くと記録が壊れるので開きません。
- リネーム案の画面では、`1`〜`9` かクリックで個別に除外できます。別プロセスで起動中のセッションは、外から書いても古い名前で書き戻されるので、既定で除外しています。`/sessions` を実行しているセッション自身には `/rename` で名前を付けます。
- ペインを描けない環境 (VS Code、`claude -p`) では、一覧を文字で返します。

### ccs (ターミナルから)

```
ccs              最近のセッション 30 件
ccs -a           全件
ccs 検索語       絞り込み
ccs -r 3         一覧の 3 番を、そのディレクトリで claude --resume する
ccs --json       JSON で出力
ccs --set-title ID 名前   /rename と同じ形で名前を付ける (名前に - を渡すと stdin から読む)
ccs --fix-titles          古い形式の名前を /rename の形式で書き直す
```

名前は `/rename` と同じく、セッションの記録に `custom-title` と `agent-name` の行を足し、`<セッションID>/custom-title.json` にも書きます。ファイルの更新日時は変えないので、一覧の並び順は崩れません。

## 確認する

```
claude plugin validate .
claude plugin test .
```

## 関連

[cc-autotitle](https://github.com/poporpepopo/cc-autotitle): 名前のないセッションに、ターンが終わったときに自動で名前を付ける mod。`ccs` を使います。
