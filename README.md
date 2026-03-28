# ALICE Text-to-CAD SaaS

テキストから3Dプリント用 .3mf を生成する SaaS。SDF数式ベースで水密保証・Boolean演算・パラメトリック変更が可能。

## アーキテクチャ

```
┌─────────────────────────────────────────┐
│  格安VPS (Hetzner / Vultr, ~$5/mo)      │
│  ┌─────────────────────────────────┐    │
│  │  API Gateway (Rust/axum)        │    │
│  │  - JWT/APIキー認証              │    │
│  │  - Stripe課金 (回数/月額)       │    │
│  │  - レートリミット               │    │
│  │  - .3mf 配信                   │    │
│  └──────────────┬──────────────────┘    │
│  ┌──────────────┴──────────────────┐    │
│  │  Frontend (Next.js)             │    │
│  │  - テキスト入力UI               │    │
│  │  - 3Dプレビュー (WebGL)         │    │
│  │  - 生成履歴                     │    │
│  └─────────────────────────────────┘    │
└──────────────┬──────────────────────────┘
               │ REST (Cloudflare Tunnel)
               ▼
┌─────────────────────────────────────────┐
│  Mac mini 24/32GB (自宅 or colo)        │
│  ┌─────────────────────────────────┐    │
│  │  Inference Worker (Rust)        │    │
│  │  1. Qwen3.5-9B 1.58-bit LLM    │    │
│  │     テキスト → LOL DSL          │    │
│  │  2. alice-lol runtime_parser    │    │
│  │     LOL DSL → SdfNode           │    │
│  │  3. alice-sdf sdf_to_mesh       │    │
│  │     SdfNode → Mesh              │    │
│  │  4. alice-print node_to_3mf     │    │
│  │     Mesh → .3mf                 │    │
│  │  5. ビルドボリューム検証         │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

## パイプライン

```
"Make a phone stand with cable hole"
  │
  ▼ LLM (OpenAI互換API: llama.cpp / vLLM / Ollama)
  │
  ▼ LOL DSL
subtract {
    smooth_union {
        box3d { size: [80, 60, 5] }
        rotate {
            box3d { size: [80, 40, 5] }
            axis: [1, 0, 0], angle: 75
        }
        k: 3
    }
    translate {
        cylinder { radius: 5, height: 10 }
        offset: [0, -25, 0]
    }
}
  │
  ▼ alice-lol::runtime_parser::parse_lol()
  ▼ alice-sdf::mesh::sdf_to_mesh()
  ▼ alice-print::node_to_3mf()  ← TODO
  │
  ▼ phone_stand.3mf (Bambu Studio で即印刷)
```

## 差別化

| 項目 | 既存 Text-to-CAD (Zoo.dev等) | ALICE Text-to-CAD |
|------|----------------------------|-------------------|
| 表現方式 | メッシュ (三角形の集合) | **SDF数式** (距離関数) |
| 水密保証 | 後処理で修復 | **構造的に保証** |
| Boolean演算 | メッシュCSGで破綻しやすい | **SDF演算で完全** |
| パラメトリック | 不可 | **LOL DSLで変更可能** |
| ローカル推論 | クラウドAPI依存 | **Mac mini で完結** |
| コスト | API従量課金 | **初期投資のみ** |

## ターゲットプリンタ

| プリンタ | ビルドボリューム (mm) | 推奨最大 (5mmマージン) |
|---------|---------------------|----------------------|
| Bambu Lab H2D (single) | 325 × 320 × 320 | 315 × 310 × 315 |
| Bambu Lab H2D (dual) | 300 × 320 × 325 | 290 × 310 × 315 |

## セットアップ

### VPS側 (API Gateway + Frontend)

```bash
cd services/api-gateway
cargo build --release

cd ../../frontend
npm install && npm run build
```

### Mac mini側 (Inference Worker)

```bash
# LLMサーバー起動 (llama.cpp server)
llama-server -m qwen35-9b-1.58bit.alice --port 8000

# Worker起動
cd services/core-engine
LLM_ENDPOINT=http://localhost:8000 cargo run --release
```

### 接続 (Cloudflare Tunnel)

```bash
cloudflared tunnel --url http://localhost:8081
```

## API

### POST /api/v1/generate

```json
{
  "prompt": "A rounded box with a hole in the center",
  "printer": "bambu_h2d",
  "resolution": 128
}
```

Response:
```json
{
  "job_id": "uuid",
  "status": "completed",
  "lol_source": "subtract { ... }",
  "mesh_info": {
    "triangles": 12480,
    "bounding_box": { "x_mm": 40.0, "y_mm": 30.0, "z_mm": 20.0 },
    "watertight": true,
    "file_format": "3mf"
  }
}
```

### POST /api/v1/preview

テキスト → LOL DSL 生成 + 構文チェックのみ（メッシュ生成なし）。

### POST /api/v1/generate-lol

LOL DSL を直接入力 → .3mf 生成（LLMスキップ）。

### GET /health

Worker状態・対応プリンタ仕様を返す。

## 機能

| 機能 | 状態 |
|------|------|
| テキスト → LOL → SDF → .3mf パイプライン | 実装済み |
| .3mf バイナリレスポンス (Content-Disposition) | 実装済み |
| 3Dプレビュー (three.js + 3MFLoader) | 実装済み |
| LOL DSL 直接入力モード | 実装済み |
| Stripe 課金 (Free/Pro/Enterprise) | 実装済み |
| 生成履歴 (Supabase RLS) | 実装済み |
| Cloudflare Tunnel (Mac mini ↔ VPS) | セットアップスクリプト付き |
| Bambu Lab H2D ビルドボリューム検証 | 実装済み |

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| LLM | Qwen3.5-9B 1.58-bit (.alice) / llama.cpp / Ollama |
| DSL | alice-lol (LOL DSL → SdfNode → .3mf ワンストップ) |
| 3Dエンジン | alice-sdf (SDF → Mesh, SIMD 8-wide, Marching Cubes) |
| API | Rust / axum |
| フロントエンド | Next.js / React / Supabase / Stripe |
| 課金 | Stripe (月額 or 回数従量) |
| 接続 | Cloudflare Tunnel (Mac mini ↔ VPS) |

## ライセンス

AGPL-3.0-or-later
