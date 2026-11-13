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
| `bin/ccs.cmd` | Windows 用。`bin/ccs` を `py -3` (無ければ `python`) で動かす |
| `extras/install-windows.ps1` | Windows 用。`ccs` のラッパーと `sessions.md` をホームの下に置く |

`/sessions` をコマンドのファイルで常に定義しているのは、mod の `$.command.register` による登録がセッション単位で、`/clear` や `/resume` のあとに消えてしまうためです。

## 入れる

macOS と Windows で動きます。Windows の手順は下の「Windows」にあります。

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

### Windows

Python 3 (`py -3` か `python`) と Git for Windows (Git Bash) が要ります。PowerShell で実行します。置き場所は好きなフォルダで構いません。

```powershell
git clone https://github.com/poporpepopo/cc-sessions D:\src\cc-sessions
powershell -NoProfile -ExecutionPolicy Bypass -File D:\src\cc-sessions\extras\install-windows.ps1
```

Windows はシンボリックリンクを作るのに管理者権限が要り、拡張子のないスクリプトも直接は実行できません。そこで `ln -s` の代わりに、`install-windows.ps1` が次の 3 つをホームの下に置きます。レジストリや PATH は変えません。

| 置くもの | 役割 |
|---|---|
| `~\.local\bin\ccs.cmd` | PowerShell やコマンドプロンプトから `ccs` と打つためのラッパー |
| `~\.local\bin\ccs` | Git Bash 用のラッパー。`/sessions` のコマンドのファイルがこれを呼ぶ |
| `~\.claude\commands\sessions.md` | `extras/sessions.md` のコピー |

ラッパーには clone したフォルダのパスが書き込まれます。フォルダを動かしたときと、`git pull` で `sessions.md` が変わったときは、もう一度実行します。mod 本体はラッパーを使わず、自分のフォルダの `bin/ccs` を `py -3` (無ければ `python`) で直接動かします。

`~\.claude\settings.json` には絶対パスで書きます。`\` は `\\` と書き、複数のフォルダは `:` ではなく `;` で区切ります。

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "D:\\src\\cc-sessions" }
```

## 使う

| コマンド | 動き |
|---|---|
| `/sessions` | ペインで一覧を開く |
| `/sessions 検索語` | タイトル・プロンプト・ディレクトリで絞り込む |
| `/sessions rename` | 名前のないセッションに Haiku で名前案を作り、ペインで確認して `[a]` で適用 |
| `/sessions rename all` | 名前の付いたセッションも含めて付け直す |

- 行を押すと、ターミナル.app の新しいウィンドウでそのセッションを `claude --resume` します。別のウィンドウやデスクトップアプリで開いているセッションは、二重に開くと記録が壊れるので開きません。
- Windows では、行を押すと Windows Terminal (`wt.exe -d ディレクトリ claude --resume ID`) で開きます。Windows Terminal が無ければ新しいコンソールのウィンドウで開きます。どちらも駄目なときと、セッションのディレクトリがもう無いときは、PowerShell に貼れる再開コマンド (`Set-Location -LiteralPath '...'; claude --resume '...'`) をクリップボードにコピーします。
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

Windows での違い:

- 起動中かどうかは、プロセスの有無に加えて、作成時刻が記録 (`procStart`) と合うかで確かめます。同じ PID を別のプロセスが使い回していても、起動中とは出ません。
- `ccs -r` は `claude` を子プロセスとして起動し、その終了コードを返します。
- パイプやファイルに出すときの文字コードは、コードページに関係なく UTF-8 です (`PYTHONIOENCODING` を設定していれば、そちらに従います)。PowerShell 5.1 でパイプに流すと日本語が化けるときは、先に `[Console]::OutputEncoding = [Text.Encoding]::UTF8` を実行します。
- PowerShell 5.1 はパイプに渡す日本語を `?` に変えてしまうので、`--set-title` の名前は stdin ではなく引数で渡します。
- 記録に作業ディレクトリが残っていないセッションは、`~\.claude\projects` のフォルダ名 (`C--Users-me-my-app`) から場所を推測します。記号がすべて `-` になっているので、実在するフォルダと突き合わせても、正しく戻せないことがあります。

名前は `/rename` と同じく、セッションの記録に `custom-title` と `agent-name` の行を足し、`<セッションID>/custom-title.json` にも書きます。ファイルの更新日時は変えないので、一覧の並び順は崩れません。

## 確認する

```
claude plugin validate .
claude plugin test .
```

## 関連

[cc-autotitle](https://github.com/poporpepopo/cc-autotitle): 名前のないセッションに、ターンが終わったときに自動で名前を付ける mod。`ccs` を使います。

## ライセンス

MIT。[LICENSE](LICENSE) を参照。
