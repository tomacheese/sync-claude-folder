# Gemini CLI 向けプロンプト

## 目的

このドキュメントは、Gemini CLI がこのプロジェクトで作業する際のコンテキストと作業方針を定義します。
Gemini CLI は、SaaS 仕様、言語・ランタイムのバージョン差、料金・制限・クォータといった、最新の
適切な情報が必要な外部依存の判断や、外部一次情報の確認、最新仕様の調査、外部前提条件の検証を行う際に
使用されます。

## 出力スタイル

### 言語

- 会話・ドキュメントは日本語で記載する
- コード内コメントは日本語、エラーメッセージは英語とする
- 日本語と英数字の間には半角スペースを挿入する

## プロジェクト概要

- chezmoi ライクな命名変換・transform ルールに従い、dotfiles の `home/dot_claude` を
  `~/.claude` / `~/.claude-work` へ同期する CLI ツール (TypeScript / Node.js 24 / pnpm)
- chezmoi 本体は使用せず、本ツールが命名変換 (`dot_`/`private_`/`executable_`/`readonly_` 等の
  サブセット) と JSON transform (`remove`/`set`/`merge`) を行う

## 想定される相談内容

- chezmoi の命名規則・属性の仕様確認 (https://www.chezmoi.io/reference/source-state-attributes/)
- Node.js / pnpm / TypeScript のバージョン差分や非推奨 API の確認
- `@book000/eslint-config` 等、依存パッケージの最新バージョン・破壊的変更の確認

## 指摘への対応ルール

Gemini CLI が指摘・異議を提示した場合、Claude Code は必ず以下のいずれかを行う。
**黙殺・無言での不採用は禁止する**。

- 指摘を受け入れ、判断を修正する
- 指摘を退け、その理由を明示する

詳細なルール・アーキテクチャは `CLAUDE.md` を参照してください。
