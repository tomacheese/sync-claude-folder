# Claude Code 作業方針

## 目的

このドキュメントは、Claude Code がこのプロジェクトで作業する際の方針とプロジェクト固有ルールを定義します。

## 判断記録のルール

判断は必ずレビュー可能な形で記録すること:

1. **判断内容の要約**: 何を決定したかを明確に記載
2. **検討した代替案**: 考慮した他の選択肢を列挙
3. **採用しなかった案とその理由**: なぜその案を選ばなかったかを明示
4. **前提条件・仮定・不確実性**: 判断の前提となる条件や仮定を明示
5. **他エージェントによるレビュー可否**: 他のエージェントがレビューできるかを示す

**重要**: 前提・仮定・不確実性を明示すること。仮定を事実のように扱ってはならない。

## プロジェクト概要

- **目的**: chezmoi ライクな命名変換・transform ルールに従い、dotfiles リポジトリの
  `home/dot_claude` を `~/.claude` / `~/.claude-work` へ同期する CLI ツール
- **主な機能**:
  - chezmoi 命名変換のサブセット (`dot_`/`private_`/`executable_`/`readonly_`/`exact_`/`literal_`/`symlink_` 等)
  - JSON Pointer ベースの transform (`remove`/`set`/`merge`)
  - `config.json` 駆動の create/update/delete/skip プラン算出と適用 (dry-run 既定)
  - `~/.claude` のジャンクション/シンボリックリンクから実ディレクトリへの一回限りの移行 (`migrate-claude`)

## 重要ルール

- **会話言語**: 日本語
- **コード内コメント**: 日本語
- **エラーメッセージ**: 英語
- **日本語と英数字の間**: 半角スペースを挿入
- **コミットメッセージ**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う
  - 形式: `<type>(<scope>): <description>`
  - `<description>` は日本語で記載
  - 例: `feat: chezmoi 命名変換モジュールを追加`

## 環境のルール

- **ブランチ命名**: [Conventional Branch](https://conventional-branch.github.io) に従う
  - 形式: `<type>/<description>`
  - `<type>` は短縮形 (feat, fix など) を使用
- **GitHub リポジトリ調査**: テンポラリディレクトリに git clone して、そこでコード検索すること
- **Renovate PR**: Renovate が作成した既存の PR に対して、追加コミットや更新を行ってはならない

## Git Worktree について

このプロジェクトでは Git Worktree は使用していません。通常の Git ブランチ運用を行ってください。

## コード改修時のルール

- **TypeScript の skipLibCheck**: 有効にして型エラーを回避することは絶対にしてはならない
- **docstring**: 関数・インターフェース・クラスには JSDoc を日本語で記載・更新すること
- **エラーメッセージの絵文字**: 既存のエラーメッセージで先頭に絵文字がある場合は、全体で統一すること

## 開発コマンド

```bash
# 依存関係のインストール (必須: pnpm を使用)
pnpm install

# 同期プランの確認 (dry-run)
pnpm sync

# 同期の実行
pnpm sync -- --apply

# ~/.claude の実体化移行 (dry-run)
pnpm migrate

# Lint チェック (全体: prettier, eslint, tsc)
pnpm lint

# 自動修正
pnpm fix

# テスト実行 (カバレッジ報告付き)
pnpm test
```

## アーキテクチャと主要ファイル

| ファイル | 目的 |
|---|---|
| `src/main.ts` | CLI エントリポイント (`sync` / `migrate-claude` の dispatch) |
| `src/config.ts` | `config.json` の型定義・読み込み・検証 |
| `src/chezmoi-name.ts` | chezmoi 命名変換 (ソース名 → 実名・種別・属性) |
| `src/fsutil.ts` | パス展開・glob 判定・再帰走査などのユーティリティ |
| `src/planner.ts` | ステージごとの create/update/delete/skip プラン算出 |
| `src/transforms.ts` | JSON Pointer ベースの transform (`remove`/`set`/`merge`) |
| `src/apply.ts` | プランの適用 (バックアップ取得・書き込み・削除・chmod) |
| `src/migrate.ts` | `~/.claude` の実体化移行 (一回限り) |
| `config.json` | 同期ステージ定義 (source/dest/managed/ignore/protected/transforms) |
| `config.schema.json` | `config.json` の JSON Schema |

### 実装パターン

推奨:
- 各モジュールは単一責務を保つ (命名変換 / transform / プラン算出 / 適用 / 移行 を分離)
- 破壊的操作 (`apply.ts`, `migrate.ts`) は必ず dry-run を既定とし、`--apply` 指定時のみ実行する
- 上書き・削除前には常にバックアップを取得する

非推奨:
- `skipLibCheck` の使用
- dry-run を経ずに `migrate-claude --apply` を実行するフロー変更

## テスト

- テストフレームワーク: Jest + ts-jest
- テストファイル配置: 各ソースファイルに隣接する `*.test.ts` (`testMatch: ["**/*.test.ts"]`)
- テストコマンド: `pnpm test`
- `src/chezmoi-name.ts` / `src/transforms.ts` / `src/planner.ts` は一時ディレクトリ (`os.tmpdir()`) を用いて検証する

### 追加テスト条件

- 新しい chezmoi 属性・transform 操作・プラン分岐を追加する場合は必ず対応するテストを追加する
- `protected` / `mirror` の境界条件 (削除されない・上書きされない) は必ずテストでカバーする

## ドキュメント更新ルール

### 更新対象

以下のドキュメントを更新する場合は、同時に更新すること:

- `README.md`: 使い方・config.json の説明変更時
- `CLAUDE.md` (このファイル) / `AGENTS.md` / `GEMINI.md`: 開発方針・コマンド変更時
- `config.schema.json`: `config.json` の構造変更時

## 作業チェックリスト

### 新規改修時

1. プロジェクトについて詳細に探索し理解すること
2. 作業を行うブランチが適切であること。すでに PR を提出しクローズされたブランチでないこと
3. 最新のリモートブランチに基づいた新規ブランチであること
4. PR がクローズされ、不要となったブランチは削除されていること
5. `pnpm install` で依存パッケージをインストールしたこと

### コミット・プッシュする前

1. コミットメッセージが Conventional Commits に従っていること (`<description>` は日本語)
2. コミット内容にセンシティブな情報が含まれていないこと
3. `pnpm lint` でエラーが発生しないこと
4. `pnpm test` が成功すること

### プルリクエストを作成する前

1. プルリクエストの作成をユーザーから依頼されていること
2. コミット内容にセンシティブな情報が含まれていないこと
3. コンフリクトする恐れが無いこと

## リポジトリ固有

- `~/.claude` および `~/.claude-work` は認証情報・セッション履歴を含む実運用ディレクトリである。
  `config.json` の `protected` リストは常に最優先で適用され、`migrate-claude` / `sync --apply` から
  保護される。protected リストを変更する場合は、変更内容を必ずユーザーに説明し承認を得ること。
- `hooks/symlink_literal_executable_*.sh` は dotfiles 側の方針 (`symlink_executable_` 回避策禁止) に
  反する残骸であり、本ツールでは `ignore` 設定により常に無視する。dotfiles 側からの削除は本ツールの
  スコープ外。
