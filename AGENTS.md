# AI エージェント向けプロンプト

## 目的

このドキュメントは、一般的な AI エージェントがこのプロジェクトで作業する際の基本方針を定義します。
詳細は `CLAUDE.md` を参照してください。

## 基本方針

### 言語使用ルール

- 会話言語: 日本語
- コード内コメント: 日本語
- エラーメッセージ: 英語
- 日本語と英数字の間には半角スペースを挿入する

### プロジェクト概要

- chezmoi ライクな命名変換・transform ルールに従い、dotfiles の `home/dot_claude` を
  `~/.claude` / `~/.claude-work` へ同期する CLI ツール (TypeScript / Node.js / pnpm)

### 開発コマンド

```bash
pnpm install
pnpm sync          # 同期プランの確認 (dry-run)
pnpm sync -- --apply
pnpm migrate       # ~/.claude 実体化移行 (dry-run)
pnpm lint
pnpm fix
pnpm test
```

### コミット・ブランチ

- コミットメッセージ: Conventional Commits (`<description>` は日本語)
- ブランチ名: Conventional Branch (`<type>/<description>`)

### 注意事項

- `src/apply.ts` / `src/migrate.ts` は破壊的操作を行う。dry-run (既定) で計画を確認したうえで
  `--apply` を指定すること。
- `config.json` の `protected` リストは認証情報・セッション履歴の保護に使われる。変更時は
  必ずユーザーに説明し承認を得ること。
- `skipLibCheck` を有効にして型エラーを回避することは禁止。

詳細なルール・アーキテクチャは `CLAUDE.md` を参照してください。
