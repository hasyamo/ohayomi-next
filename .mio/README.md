# .mio/

このディレクトリは、澪（ミオ）運用の **交換箱** です。
詳細スペック：`hasyamo-vault/70_projects/mio/mio_spec_v2.md`

## Phase 2 のルール

このプロジェクトは **澪運用 Phase 2**（入口ログ＋出口ログ）です。

- 作業開始時に **`handoff.md`** を書く（目的・完了条件・やらないこと・止まって聞くこと）
  - テンプレ：`hasyamo-vault/90_templates/mio_handoff_template.md`
  - 書くのは1〜2分で済む範囲。それを超える項目は書かない
- 作業終了時に **`result.md`** を書く
  - テンプレ：`hasyamo-vault/90_templates/mio_result_template.md`
  - 完了条件の○×は handoff.md と突合して付ける
- 作業中の質問はチャット上で扱う（`questions.md` は Phase 3 まで作らない）
- `tmp/` は作らない

## ファイル

| ファイル | Git | 用途 |
|---|---|---|
| `README.md`（このファイル） | 管理する | 運用説明 |
| `handoff.md` | 管理しない | 作業開始時の入口ログ（1ファイル上書き運用） |
| `result.md` | 管理しない | 作業終了時の結果ログ |

`.gitignore` に以下を追加済み：

```gitignore
# Mio working handoff files
.mio/handoff.md
.mio/result.md
```

## status のルール

- `handoff.md` の status は **`active` / `done`** の2値のみ。
  - `active`：この発注に対応する作業が進行中
  - `done`：現場Botが最終 `result.md` を `status: open` で書いた直後、現場Bot自身が `done` に変える（澪の回収時点ではない）
- `result.md` の status は **`open` / `collected`** の2値のみ（`done` は使わない）。
  - `open`：現場Botが最終結果を書いた。澪の回収がまだ。成功・失敗・部分完了を問わない
  - `collected`：澪が本文を読み、回収先へ記録し、`collected_at` / `collected_to` を記録し終えた
- **前回の `result.md` が `open` のまま残っている場合、新しい作業を始めない。** はしゃも・澪へ回収を依頼する。

## 回収フロー

1. 作業開始時、Claude Code が `handoff.md` を書く（status: active）
2. 作業終了時、Claude Code が `result.md` を書く（status: open）→ 続けて `handoff.md` を `status: done` に変える
3. はしゃもが hasyamo-vault 側の澪に「result 回収して」と渡す
4. 澪が handoff.md と result.md を突合して回収先へ記録し、`status: collected` に変え、`collected_at` / `collected_to` を記録する
   - **回収時に本文を空にしない。** 次の作業を始める時だけ、現場Botが上書きする

回収先は `20_daily` に固定しない。`20_daily` は回収台帳。長期利用する内容の正本は、責務に応じてプロジェクト別ノート等に置く。

`.mio` は作業中の交換箱で、長期保管場所ではない。

## やってはいけないこと

- ジュリの口調を真似ない（このプロジェクトの Claude Code は澪ではないが、ジュリでもない）
- `result.md` を貯めない（1 件書いたら回収してもらう。status: open のまま新しい作業を始めない）
- `result.md` を回収時に空にしない（本文は保持したまま status を変える）
- 機密情報（API キー、`.env` 中身、個人情報）を `handoff.md` / `result.md` に書かない
- 観測所の会員リスト（creators.txt の中身）をこのリポジトリに置かない（**PUBLIC リポジトリ**）
