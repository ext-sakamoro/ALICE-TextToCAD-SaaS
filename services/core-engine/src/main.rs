//! Text-to-CAD Inference Worker
//!
//! Mac mini (24/32GB) 上で動作するワーカー。
//! 1. テキスト受信 → ローカルLLM で LOL DSL 生成
//! 2. LOL DSL → SdfNode (alice-lol runtime_parser)
//! 3. SdfNode → Mesh (alice-sdf sdf_to_mesh)
//! 4. Mesh → .3mf (alice-print node_to_3mf) ← TODO
//! 5. .3mf バイナリを API Gateway に返却

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct WorkerState {
    start_time: Instant,
    /// LLM API エンドポイント (llama.cpp server, vLLM, etc.)
    llm_endpoint: String,
    /// LOL DSL 生成用システムプロンプト
    system_prompt: String,
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GenerateRequest {
    /// ユーザーの自然言語入力
    prompt: String,
    /// ターゲットプリンタ (default: "bambu_h2d")
    #[serde(default = "default_printer")]
    printer: String,
    /// 解像度 (default: 128)
    #[serde(default = "default_resolution")]
    resolution: u32,
}

fn default_printer() -> String {
    "bambu_h2d".into()
}

fn default_resolution() -> u32 {
    128
}

#[derive(Serialize)]
struct GenerateResponse {
    job_id: String,
    status: String,
    /// 生成された LOL DSL (デバッグ/表示用)
    lol_source: Option<String>,
    /// メッシュ情報
    mesh_info: Option<MeshInfo>,
    /// エラー詳細
    error: Option<String>,
}

#[derive(Serialize)]
struct MeshInfo {
    triangles: usize,
    bounding_box: BoundingBox,
    watertight: bool,
    file_format: String,
}

#[derive(Serialize)]
struct BoundingBox {
    x_mm: f32,
    y_mm: f32,
    z_mm: f32,
}

#[derive(Serialize)]
struct Health {
    status: String,
    version: String,
    uptime_secs: u64,
    llm_endpoint: String,
    printer_specs: Vec<PrinterSpec>,
}

#[derive(Serialize, Clone)]
struct PrinterSpec {
    name: String,
    build_volume: [f32; 3],
    nozzle_mm: f32,
}

// ---------------------------------------------------------------------------
// Printer specs
// ---------------------------------------------------------------------------

fn bambu_h2d_spec() -> PrinterSpec {
    PrinterSpec {
        name: "Bambu Lab H2D (single)".into(),
        build_volume: [325.0, 320.0, 320.0],
        nozzle_mm: 0.4,
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health(State(s): State<Arc<WorkerState>>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        uptime_secs: s.start_time.elapsed().as_secs(),
        llm_endpoint: s.llm_endpoint.clone(),
        printer_specs: vec![bambu_h2d_spec()],
    })
}

async fn generate(
    State(s): State<Arc<WorkerState>>,
    Json(req): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, (StatusCode, Json<GenerateResponse>)> {
    let job_id = uuid::Uuid::new_v4().to_string();
    tracing::info!(job_id = %job_id, prompt = %req.prompt, "generate request");

    // Step 1: LLM で LOL DSL 生成
    let lol_source = match call_llm(&s.llm_endpoint, &s.system_prompt, &req.prompt).await {
        Ok(src) => src,
        Err(e) => {
            return Err((
                StatusCode::BAD_GATEWAY,
                Json(GenerateResponse {
                    job_id,
                    status: "error".into(),
                    lol_source: None,
                    mesh_info: None,
                    error: Some(format!("LLM error: {e}")),
                }),
            ));
        }
    };

    // Step 2: LOL DSL → SdfNode
    let sdf_node = match alice_lol::runtime_parser::parse_lol(&lol_source) {
        Ok(node) => node,
        Err(e) => {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(GenerateResponse {
                    job_id,
                    status: "error".into(),
                    lol_source: Some(lol_source),
                    mesh_info: None,
                    error: Some(format!("LOL parse error: {e}")),
                }),
            ));
        }
    };

    // Step 3: SdfNode → Mesh
    let config = alice_sdf::mesh::MeshConfig {
        resolution: req.resolution,
        ..Default::default()
    };
    let min_bounds = glam::Vec3::new(-200.0, -200.0, -200.0);
    let max_bounds = glam::Vec3::new(200.0, 200.0, 200.0);
    let mesh = alice_sdf::mesh::sdf_to_mesh(&sdf_node, min_bounds, max_bounds, &config);

    let bbox = mesh.bounding_box();
    let mesh_info = MeshInfo {
        triangles: mesh.triangle_count(),
        bounding_box: BoundingBox {
            x_mm: bbox.x_size(),
            y_mm: bbox.y_size(),
            z_mm: bbox.z_size(),
        },
        watertight: mesh.is_watertight(),
        file_format: "3mf".into(),
    };

    // Step 4: TODO — Mesh → .3mf via alice-print
    // let threemf_bytes = alice_print::node_to_3mf(&sdf_node, &print_config)?;

    // Step 5: ビルドボリューム検証
    let spec = bambu_h2d_spec();
    let margin = 5.0;
    if bbox.x_size() > spec.build_volume[0] - margin * 2.0
        || bbox.y_size() > spec.build_volume[1] - margin * 2.0
        || bbox.z_size() > spec.build_volume[2] - margin * 2.0
    {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(GenerateResponse {
                job_id,
                status: "error".into(),
                lol_source: Some(lol_source),
                mesh_info: Some(mesh_info),
                error: Some(format!(
                    "Exceeds build volume: {:.1}x{:.1}x{:.1}mm > {:.0}x{:.0}x{:.0}mm (with {}mm margin)",
                    bbox.x_size(), bbox.y_size(), bbox.z_size(),
                    spec.build_volume[0] - margin * 2.0,
                    spec.build_volume[1] - margin * 2.0,
                    spec.build_volume[2] - margin * 2.0,
                    margin,
                )),
            }),
        ));
    }

    Ok(Json(GenerateResponse {
        job_id,
        status: "completed".into(),
        lol_source: Some(lol_source),
        mesh_info: Some(mesh_info),
        error: None,
    }))
}

// ---------------------------------------------------------------------------
// LLM client
// ---------------------------------------------------------------------------

/// ローカルLLM (llama.cpp server / vLLM / Ollama) にリクエスト
async fn call_llm(endpoint: &str, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    #[derive(Serialize)]
    struct LlmRequest {
        model: String,
        messages: Vec<Message>,
        temperature: f32,
        max_tokens: u32,
    }

    #[derive(Serialize)]
    struct Message {
        role: String,
        content: String,
    }

    #[derive(Deserialize)]
    struct LlmResponse {
        choices: Vec<Choice>,
    }

    #[derive(Deserialize)]
    struct Choice {
        message: ChoiceMessage,
    }

    #[derive(Deserialize)]
    struct ChoiceMessage {
        content: String,
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{endpoint}/v1/chat/completions"))
        .json(&LlmRequest {
            model: "default".into(),
            messages: vec![
                Message {
                    role: "system".into(),
                    content: system_prompt.into(),
                },
                Message {
                    role: "user".into(),
                    content: user_prompt.into(),
                },
            ],
            temperature: 0.3,
            max_tokens: 2048,
        })
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM returned {status}: {body}"));
    }

    let llm_resp: LlmResponse = resp
        .json()
        .await
        .map_err(|e| format!("LLM response parse error: {e}"))?;

    llm_resp
        .choices
        .first()
        .map(|c| extract_lol_block(&c.message.content))
        .ok_or_else(|| "LLM returned no choices".into())
}

/// LLM出力から LOL DSLブロックを抽出 (```lol ... ``` or raw)
fn extract_lol_block(content: &str) -> String {
    // ```lol ... ``` ブロックを探す
    if let Some(start) = content.find("```lol") {
        let after = &content[start + 6..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    // ``` ... ``` ブロック
    if let Some(start) = content.find("```") {
        let after = &content[start + 3..];
        // skip optional language tag
        let after = if let Some(nl) = after.find('\n') {
            &after[nl + 1..]
        } else {
            after
        };
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    // フォールバック: そのまま返す
    content.trim().to_string()
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

fn load_system_prompt() -> String {
    // LLM_REFERENCE.md + LLM_PRINT_PROMPT.md をベースにしたシステムプロンプト
    format!(
        r#"You are a Text-to-CAD assistant. Convert the user's description into LOL DSL code.

## LOL DSL Rules
- Output ONLY valid LOL DSL inside a ```lol``` code block
- Use millimeters for all dimensions
- Ensure watertight geometry (no open edges)
- Minimum wall thickness: 0.8mm (2x nozzle diameter)
- Target printer: Bambu Lab H2D (build volume 315x310x315mm with margin)

## Available Primitives
sphere, box3d, rounded_box, cylinder, torus, cone, capsule, ellipsoid, plane,
octahedron, pyramid, hex_prism, tube, barrel, heart, tetrahedron, box_frame,
diamond, star_polygon, cross_shape, triangle, gyroid, schwarz_p, superellipsoid

## Operations
union, smooth_union, subtract, smooth_subtract, intersection, smooth_intersection

## Transforms
translate, rotate, scale

## Modifiers
round, onion, mirror, repeat, elongate, taper, polar_repeat

## Infill (for 3D printing)
lattice_infill, diamond_infill, schwarz_infill

## Example
User: "A rounded box with a hole in the center"
```lol
subtract {{
    rounded_box {{ size: [40, 30, 20], radius: 3 }}
    cylinder {{ radius: 5, height: 25 }}
}}
```
"#
    )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "text_to_cad_worker=info,tower_http=info".into()),
        )
        .init();

    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());

    let state = Arc::new(WorkerState {
        start_time: Instant::now(),
        llm_endpoint: env("LLM_ENDPOINT", "http://localhost:8000"),
        system_prompt: load_system_prompt(),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/generate", post(generate))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = env("WORKER_ADDR", "0.0.0.0:8081");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("Text-to-CAD Worker on {addr}");
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_lol_block_with_tag() {
        let input = "Here is the model:\n```lol\nsphere { radius: 10 }\n```\nDone.";
        assert_eq!(extract_lol_block(input), "sphere { radius: 10 }");
    }

    #[test]
    fn test_extract_lol_block_generic() {
        let input = "```\nbox3d { size: [10, 20, 30] }\n```";
        assert_eq!(extract_lol_block(input), "box3d { size: [10, 20, 30] }");
    }

    #[test]
    fn test_extract_lol_block_raw() {
        let input = "sphere { radius: 5 }";
        assert_eq!(extract_lol_block(input), "sphere { radius: 5 }");
    }

    #[test]
    fn test_bambu_spec() {
        let spec = bambu_h2d_spec();
        assert_eq!(spec.build_volume, [325.0, 320.0, 320.0]);
        assert!((spec.nozzle_mm - 0.4).abs() < f32::EPSILON);
    }
}
