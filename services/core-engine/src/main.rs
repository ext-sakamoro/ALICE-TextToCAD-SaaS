//! Text-to-CAD Inference Worker
//!
//! Mac mini (24/32GB) 上で動作。
//! テキスト → LLM → LOL DSL → alice-lol lol_to_3mf → .3mf バイナリ返却

use axum::{
    body::Body,
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use alice_lol::print_export::PrintConfig;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct WorkerState {
    start_time: Instant,
    llm_endpoint: String,
    system_prompt: String,
    output_dir: String,
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GenerateRequest {
    prompt: String,
    #[serde(default = "default_printer")]
    #[allow(dead_code)]
    printer: String,
    #[serde(default = "default_quality")]
    quality: String,
}

fn default_printer() -> String {
    "bambu_h2d".into()
}
fn default_quality() -> String {
    "high".into()
}

#[derive(Serialize)]
struct GenerateResponse {
    job_id: String,
    status: String,
    lol_source: Option<String>,
    mesh_info: Option<MeshInfo>,
    download_url: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct MeshInfo {
    vertex_count: usize,
    triangle_count: usize,
    file_format: String,
}

#[derive(Serialize)]
struct Health {
    status: String,
    version: String,
    uptime_secs: u64,
    llm_endpoint: String,
    printers: Vec<PrinterInfo>,
}

#[derive(Serialize)]
struct PrinterInfo {
    id: String,
    name: String,
    build_volume_mm: [f32; 3],
    max_with_margin_mm: [f32; 3],
}

// ---------------------------------------------------------------------------
// Printer specs
// ---------------------------------------------------------------------------

fn printers() -> Vec<PrinterInfo> {
    vec![
        PrinterInfo {
            id: "bambu_h2d".into(),
            name: "Bambu Lab H2D (single nozzle)".into(),
            build_volume_mm: [325.0, 320.0, 320.0],
            max_with_margin_mm: [315.0, 310.0, 315.0],
        },
        PrinterInfo {
            id: "bambu_h2d_dual".into(),
            name: "Bambu Lab H2D (dual nozzle)".into(),
            build_volume_mm: [300.0, 320.0, 325.0],
            max_with_margin_mm: [290.0, 310.0, 315.0],
        },
    ]
}

fn print_config_for_quality(quality: &str) -> PrintConfig {
    match quality {
        "preview" => PrintConfig::preview(),
        "high" => PrintConfig::high_quality(),
        "ultra" => PrintConfig::ultra(),
        _ => PrintConfig::high_quality(),
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
        printers: printers(),
    })
}

async fn generate(
    State(s): State<Arc<WorkerState>>,
    Json(req): Json<GenerateRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<GenerateResponse>)> {
    let job_id = uuid::Uuid::new_v4().to_string();
    tracing::info!(job_id = %job_id, prompt = %req.prompt, "generate");

    // Step 1: LLM → LOL DSL
    let lol_source = call_llm(&s.llm_endpoint, &s.system_prompt, &req.prompt)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(err_resp(&job_id, &format!("LLM error: {e}"))),
            )
        })?;

    // Step 2: LOL DSL → .3mf (alice-lol does everything)
    let config = print_config_for_quality(&req.quality);
    let output_path = format!("{}/{}.3mf", s.output_dir, job_id);

    let stats = alice_lol::print_export::lol_to_3mf(&lol_source, &output_path, &config).map_err(
        |e| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(GenerateResponse {
                    job_id: job_id.clone(),
                    status: "error".into(),
                    lol_source: Some(lol_source.clone()),
                    mesh_info: None,
                    download_url: None,
                    error: Some(format!("Pipeline error: {e}")),
                }),
            )
        },
    )?;

    // Step 3: .3mf バイナリ読み込み
    let bytes = tokio::fs::read(&output_path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(err_resp(&job_id, &format!("File read error: {e}"))),
        )
    })?;

    // ファイル削除（一時ファイル）
    let _ = tokio::fs::remove_file(&output_path).await;

    tracing::info!(
        job_id = %job_id,
        triangles = stats.triangle_count,
        vertices = stats.vertex_count,
        "generated"
    );

    // .3mf バイナリを直接返却
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/vnd.ms-package.3dmanufacturing-3dmodel+xml")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}.3mf\"", job_id),
        )
        .header("X-Job-Id", &job_id)
        .header("X-Triangle-Count", stats.triangle_count.to_string())
        .header("X-Vertex-Count", stats.vertex_count.to_string())
        .header("X-LOL-Source", urlencoding_lol(&lol_source))
        .body(Body::from(bytes))
        .unwrap();

    Ok(response)
}

/// メタデータのみ返すエンドポイント（プレビュー用、バイナリなし）
async fn generate_preview(
    State(s): State<Arc<WorkerState>>,
    Json(req): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, (StatusCode, Json<GenerateResponse>)> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let lol_source = call_llm(&s.llm_endpoint, &s.system_prompt, &req.prompt)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(err_resp(&job_id, &format!("LLM error: {e}"))),
            )
        })?;

    // LOL パースのみ（メッシュ生成なし）— 構文チェック
    alice_lol::runtime_parser::parse_lol(&lol_source).map_err(|e| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(GenerateResponse {
                job_id: job_id.clone(),
                status: "error".into(),
                lol_source: Some(lol_source.clone()),
                mesh_info: None,
                download_url: None,
                error: Some(format!("LOL parse error: {e}")),
            }),
        )
    })?;

    Ok(Json(GenerateResponse {
        job_id,
        status: "preview".into(),
        lol_source: Some(lol_source),
        mesh_info: None,
        download_url: None,
        error: None,
    }))
}

/// LOL DSL直接入力 → .3mf（LLMスキップ）
async fn generate_from_lol(
    State(s): State<Arc<WorkerState>>,
    Json(req): Json<DirectLolRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<GenerateResponse>)> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let config = print_config_for_quality(&req.quality);
    let output_path = format!("{}/{}.3mf", s.output_dir, job_id);

    let stats =
        alice_lol::print_export::lol_to_3mf(&req.lol_source, &output_path, &config).map_err(
            |e| {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(err_resp(&job_id, &format!("Pipeline error: {e}"))),
                )
            },
        )?;

    let bytes = tokio::fs::read(&output_path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(err_resp(&job_id, &format!("File read error: {e}"))),
        )
    })?;
    let _ = tokio::fs::remove_file(&output_path).await;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/vnd.ms-package.3dmanufacturing-3dmodel+xml")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}.3mf\"", job_id),
        )
        .header("X-Job-Id", &job_id)
        .header("X-Triangle-Count", stats.triangle_count.to_string())
        .header("X-Vertex-Count", stats.vertex_count.to_string())
        .body(Body::from(bytes))
        .unwrap();

    Ok(response)
}

#[derive(Deserialize)]
struct DirectLolRequest {
    lol_source: String,
    #[serde(default = "default_quality")]
    quality: String,
}

// ---------------------------------------------------------------------------
// LLM client (OpenAI互換)
// ---------------------------------------------------------------------------

async fn call_llm(endpoint: &str, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    #[derive(Serialize)]
    struct Req {
        model: String,
        messages: Vec<Msg>,
        temperature: f32,
        max_tokens: u32,
    }
    #[derive(Serialize)]
    struct Msg {
        role: String,
        content: String,
    }
    #[derive(Deserialize)]
    struct Resp {
        choices: Vec<Choice>,
    }
    #[derive(Deserialize)]
    struct Choice {
        message: ChoiceMsg,
    }
    #[derive(Deserialize)]
    struct ChoiceMsg {
        content: String,
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{endpoint}/v1/chat/completions"))
        .json(&Req {
            model: "default".into(),
            messages: vec![
                Msg { role: "system".into(), content: system_prompt.into() },
                Msg { role: "user".into(), content: user_prompt.into() },
            ],
            temperature: 0.3,
            max_tokens: 2048,
        })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let st = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("{st}: {body}"));
    }

    let r: Resp = resp.json().await.map_err(|e| format!("parse error: {e}"))?;
    r.choices
        .first()
        .map(|c| extract_lol_block(&c.message.content))
        .ok_or_else(|| "no choices".into())
}

/// LLM出力から LOL DSLブロックを抽出
fn extract_lol_block(content: &str) -> String {
    if let Some(start) = content.find("```lol") {
        let after = &content[start + 6..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = content.find("```") {
        let after = &content[start + 3..];
        let after = after.find('\n').map_or(after, |nl| &after[nl + 1..]);
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    content.trim().to_string()
}

/// LOLソースをヘッダー安全にエンコード（改行→スペース、ASCII範囲に制限）
fn urlencoding_lol(lol: &str) -> String {
    lol.replace('\n', " ").chars().take(200).collect()
}

fn err_resp(job_id: &str, error: &str) -> GenerateResponse {
    GenerateResponse {
        job_id: job_id.into(),
        status: "error".into(),
        lol_source: None,
        mesh_info: None,
        download_url: None,
        error: Some(error.into()),
    }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

fn load_system_prompt() -> String {
    // カスタムプロンプトファイルがあればそちらを使用
    if let Ok(custom) = std::fs::read_to_string("system_prompt.md") {
        return custom;
    }

    include_str!("system_prompt.md").to_string()
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

    let output_dir = env("OUTPUT_DIR", "/tmp/text-to-cad");
    std::fs::create_dir_all(&output_dir).expect("failed to create output dir");

    let state = Arc::new(WorkerState {
        start_time: Instant::now(),
        llm_endpoint: env("LLM_ENDPOINT", "http://localhost:8000"),
        system_prompt: load_system_prompt(),
        output_dir,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/generate", post(generate))
        .route("/api/v1/preview", post(generate_preview))
        .route("/api/v1/generate-lol", post(generate_from_lol))
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
    fn extract_lol_tagged() {
        let input = "Here:\n```lol\nsphere { radius: 10 }\n```\nDone.";
        assert_eq!(extract_lol_block(input), "sphere { radius: 10 }");
    }

    #[test]
    fn extract_lol_generic() {
        let input = "```\nbox3d { size: [10, 20, 30] }\n```";
        assert_eq!(extract_lol_block(input), "box3d { size: [10, 20, 30] }");
    }

    #[test]
    fn extract_lol_raw() {
        let input = "sphere { radius: 5 }";
        assert_eq!(extract_lol_block(input), "sphere { radius: 5 }");
    }

    #[test]
    fn extract_lol_with_lang_tag() {
        let input = "```rust\nlet x = 1;\n```";
        assert_eq!(extract_lol_block(input), "let x = 1;");
    }

    #[test]
    fn printers_not_empty() {
        assert!(!printers().is_empty());
        assert_eq!(printers()[0].id, "bambu_h2d");
    }

    #[test]
    fn quality_configs() {
        let _ = print_config_for_quality("preview");
        let _ = print_config_for_quality("high");
        let _ = print_config_for_quality("ultra");
        let _ = print_config_for_quality("unknown");
    }
}
