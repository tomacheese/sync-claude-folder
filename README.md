# sync-claude-folder

chezmoi ライクな命名変換ルールに従い、dotfiles リポジトリの `dot_claude` ソースを
`~/.claude`・`~/.claude-work` へ同期する CLI ツール。

## 背景

- `~/repos/dotfiles/home/dot_claude` (chezmoi ソース) を `~/.claude` へ実体化する。
- 同じ内容を、別アカウントで利用する `~/.claude-work` にも (認証/ランタイムを保護しつつ) 同期する。
- chezmoi 本体は使用せず、本ツールが chezmoi 命名変換 (`dot_`/`private_`/`executable_`/`readonly_` 等の
  サブセット) と JSON transform (`remove`/`set`/`merge`) を行う。

## セットアップ

```bash
pnpm install
```

## 使い方

### sync

`config.json` に定義された各ステージについて、同期プラン (create/update/delete/skip) を算出する。
既定では dry-run (計画表示のみ) で、`--apply` を指定した場合のみファイルへ反映する。

```bash
# 全ステージの計画を表示する (dry-run)
pnpm sync

# 特定ステージのみ
pnpm sync -- --stage dotfiles-to-claude

# 実際に反映する
pnpm sync -- --apply

# 別の config を使う
pnpm sync -- --config ./config.json --apply
```

書き込み・削除の前には、`~/.sync-claude-backup/<timestamp>/<relPath>` (既定値。
`--backup-root` で変更可) に既存ファイルがバックアップされる。

### migrate-claude

`~/.claude` が dotfiles ソースディレクトリへのジャンクション/シンボリックリンクになっている状態から、
実ディレクトリへ一回限りで完全移行する。`git ls-files` で求めたソース追跡ファイル集合を基に、
追跡対象外 (ランタイム/認証データ) のトップレベルエントリのみを新しい `~/.claude` へ移動する。

```bash
# 移行計画を確認する (dry-run, 必須)
pnpm migrate

# 実行する (バックアップ後に移動・実ディレクトリ化を行う)
pnpm migrate -- --apply
```

実行後、`sync --stage dotfiles-to-claude --apply` を実行してソースファイルを実体化すること。

## config.json

- `stages[].source` / `dest`: 同期元/同期先 (`~` 展開対応)
- `chezmoiNaming`: ソース名を chezmoi 命名規則で実名へ変換するか
- `mirror`: `managed` 範囲内でソースに存在しない実名ファイルを削除するか
- `managed`: 同期・ミラー対象とする実名 glob
- `ignore`: ソース側で無視する glob (変換前のソース名に対して判定)
- `protected`: dest 側で create/update/delete のいずれからも常に除外する glob
- `transforms`: JSON ファイルに対する `remove`/`set`/`merge` 操作

詳細は [`config.schema.json`](./config.schema.json) を参照。

## 開発

```bash
pnpm lint   # prettier + eslint + tsc
pnpm fix    # prettier + eslint --fix
pnpm test   # jest
```
