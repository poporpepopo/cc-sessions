---
description: セッション一覧を表示 (rename で AI 一括リネーム)
argument-hint: "[検索語] | rename [all]"
disable-model-invocation: true
allowed-tools: Bash(~/.local/bin/ccs --fallback:*)
---
<!--
通常は ~/Developer/cc-sessions の mod がこのコマンドに割り込み、ペインで一覧を開く
(このファイルの中身はモデルに渡らない)。mod が読み込まれていないときだけ、以下が使われる。
-->
Claude Code のセッション一覧です (mod が読み込まれていないため簡易表示)。引数: `$ARGUMENTS`

!`~/.local/bin/ccs --fallback -n 40 -- $ARGUMENTS 2>&1 | head -60`

引数が `rename` で始まる場合: 上の一覧のうち、自分で名前を付けていないセッション
(`rename all` なら全部) に、内容が一目で分かる 15〜25 文字の日本語名を考えて表で提案してください。
書き込みはユーザーが承認した後にだけ、`~/.local/bin/ccs --set-title <ID> "<名前>"` で行ってください
(ID は `~/.local/bin/ccs --json` で取得)。
それ以外の場合は、一覧をそのまま見やすく示すだけにしてください。
最後に「ペインで見るには Claude Code を再起動して mod を読み込んでください」と一言添えてください。
