use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Json, Response},
    routing::{any, get},
    Router,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

struct AppState {
    core_url: String,
    jwt_secret: String,
    supabase_url: String,
    supabase_service_key: String,
    rate_limiters: DashMap<String, TokenBucket>,
    start_time: Instant,
}

struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(max: f64, rate: f64) -> Self {
        Self { tokens: max, max_tokens: max, refill_rate: rate, last_refill: Instant::now() }
    }
    fn try_consume(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.max_tokens);
        self.last_refill = now;
        if self.tokens >= 1.0 { self.tokens -= 1.0; true } else { false }
    }
}

#[derive(Serialize)]
struct Health { status: String, version: String, uptime_secs: u64 }

#[derive(Serialize)]
struct Err { error: String, #[serde(skip_serializing_if = "Option::is_none")] details: Option<String> }

#[derive(Serialize)]
struct LicenseInfo { license: String, source_code: String, notice: String }

#[derive(Deserialize, Serialize, Clone)]
struct Claims {
    sub: String,
    email: Option<String>,
    role: Option<String>,
    exp: usize,
    #[serde(default)]
    plan: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api_gateway=info,tower_http=info".into()),
        )
        .init();
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
    let state = Arc::new(AppState {
        core_url: env("CORE_ENGINE_URL", "http://core-engine:8081"),
        jwt_secret: env("JWT_SECRET", "dev-secret-change-me"),
        supabase_url: env("SUPABASE_URL", ""),
        supabase_service_key: env("SUPABASE_SERVICE_ROLE_KEY", ""),
        rate_limiters: DashMap::new(),
        start_time: Instant::now(),
    });
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    let public = Router::new()
        .route("/health", get(health))
        .route("/license", get(license_handler));
    let api = Router::new()
        .route("/api/v1/{*p}", any(proxy_core))
        .layer(middleware::from_fn_with_state(state.clone(), auth_mw))
        .layer(middleware::from_fn_with_state(state.clone(), rate_mw));
    let app = Router::new()
        .merge(public)
        .merge(api)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let addr = std::env::var("GATEWAY_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("API Gateway on {addr}");
    axum::serve(listener, app).await.unwrap();
}

async fn health(State(s): State<Arc<AppState>>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        uptime_secs: s.start_time.elapsed().as_secs(),
    })
}

async fn license_handler() -> (HeaderMap, Json<LicenseInfo>) {
    let mut h = HeaderMap::new();
    h.insert("X-License", "AGPL-3.0-or-later".parse().unwrap());
    (h, Json(LicenseInfo {
        license: "AGPL-3.0-or-later".into(),
        source_code: "https://github.com/ALICE-TextToCAD-SaaS".into(),
        notice: "SaaS operators must publish complete service source code under AGPL-3.0.".into(),
    }))
}

/// Validate API key against Supabase profiles table
async fn validate_api_key(state: &AppState, key: &str) -> Option<Claims> {
    if state.supabase_url.is_empty() || state.supabase_service_key.is_empty() {
        // Supabase not configured — accept key in dev mode
        return Some(Claims {
            sub: "api-key-user".into(),
            email: None,
            role: Some("api".into()),
            exp: usize::MAX,
            plan: Some("Free".into()),
        });
    }

    let client = reqwest::Client::new();
    let url = format!(
        "{}/rest/v1/profiles?api_key=eq.{}&select=id,plan",
        state.supabase_url, key
    );

    #[derive(Deserialize)]
    struct Profile {
        id: String,
        plan: Option<String>,
    }

    let resp = client
        .get(&url)
        .header("apikey", &state.supabase_service_key)
        .header("Authorization", format!("Bearer {}", state.supabase_service_key))
        .send()
        .await
        .ok()?;

    let profiles: Vec<Profile> = resp.json().await.ok()?;
    let profile = profiles.first()?;

    Some(Claims {
        sub: profile.id.clone(),
        email: None,
        role: Some("api".into()),
        exp: usize::MAX,
        plan: Some(profile.plan.clone().unwrap_or_else(|| "Free".into())),
    })
}

async fn auth_mw(
    State(s): State<Arc<AppState>>, mut req: Request, next: Next,
) -> Result<Response, (StatusCode, Json<Err>)> {
    let auth = req.headers().get("Authorization").and_then(|h| h.to_str().ok()).map(|s| s.to_string());
    let api_key = req.headers().get("X-API-Key").and_then(|h| h.to_str().ok()).map(|s| s.to_string());

    // JWT Bearer token
    if let Some(a) = &auth {
        if let Some(token) = a.strip_prefix("Bearer ") {
            let mut val = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
            val.validate_aud = false;
            match jsonwebtoken::decode::<Claims>(
                token,
                &jsonwebtoken::DecodingKey::from_secret(s.jwt_secret.as_bytes()),
                &val,
            ) {
                Ok(data) => {
                    req.extensions_mut().insert(data.claims);
                    return Ok(next.run(req).await);
                }
                Err(e) => return Err((StatusCode::UNAUTHORIZED, Json(Err { error: "Invalid token".into(), details: Some(e.to_string()) }))),
            }
        }
    }

    // API Key validation
    if let Some(key) = api_key {
        if let Some(claims) = validate_api_key(&s, &key).await {
            req.extensions_mut().insert(claims);
            return Ok(next.run(req).await);
        }
        return Err((StatusCode::UNAUTHORIZED, Json(Err { error: "Invalid API key".into(), details: None })));
    }

    Err((StatusCode::UNAUTHORIZED, Json(Err { error: "Auth required".into(), details: Some("Provide Bearer token or X-API-Key".into()) })))
}

async fn rate_mw(
    State(s): State<Arc<AppState>>, req: Request, next: Next,
) -> Result<Response, (StatusCode, Json<Err>)> {
    let claims = req.extensions().get::<Claims>().cloned();
    let uid = claims.as_ref().map(|c| c.sub.clone()).unwrap_or_else(|| "anon".into());
    let plan = claims.as_ref().and_then(|c| c.plan.as_deref()).unwrap_or("Free");

    // Plan-based rate limits (tokens per hour)
    let max_tokens = match plan {
        "Enterprise" => 100_000.0,
        "Pro" => 10_000.0,
        _ => 100.0,
    };

    let ok = {
        let mut e = s.rate_limiters.entry(uid.clone()).or_insert_with(|| TokenBucket::new(max_tokens, max_tokens / 3600.0));
        // Update bucket limits if plan changed
        if (e.max_tokens - max_tokens).abs() > 1.0 {
            *e = TokenBucket::new(max_tokens, max_tokens / 3600.0);
        }
        e.try_consume()
    };
    if !ok {
        return Err((StatusCode::TOO_MANY_REQUESTS, Json(Err { error: "Rate limit exceeded".into(), details: None })));
    }

    // Record usage asynchronously
    let state = s.clone();
    let method = req.method().to_string();
    let endpoint = req.uri().path().to_string();
    let uid_clone = uid.clone();
    let start = Instant::now();

    let resp = next.run(req).await;

    let status_code = resp.status().as_u16() as i32;
    let response_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    // Fire-and-forget usage recording
    tokio::spawn(async move {
        record_usage(&state, &uid_clone, &endpoint, &method, status_code, response_time_ms).await;
    });

    Ok(resp)
}

async fn record_usage(
    state: &AppState,
    user_id: &str,
    endpoint: &str,
    method: &str,
    status_code: i32,
    response_time_ms: f64,
) {
    if state.supabase_url.is_empty() || state.supabase_service_key.is_empty() {
        return;
    }
    // Skip non-UUID user IDs (dev mode)
    if user_id.len() != 36 {
        return;
    }

    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/api_usage", state.supabase_url);

    let body = serde_json::json!({
        "user_id": user_id,
        "endpoint": endpoint,
        "method": method,
        "status_code": status_code,
        "response_time_ms": response_time_ms,
    });

    let _ = client
        .post(&url)
        .header("apikey", &state.supabase_service_key)
        .header("Authorization", format!("Bearer {}", state.supabase_service_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;
}

async fn forward(url: &str, req: Request) -> Result<Response, (StatusCode, Json<Err>)> {
    let client = reqwest::Client::new();
    let path = req.uri().path().to_owned();
    let q = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let method = req.method().clone();
    let hdrs = req.headers().clone();
    let body = axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(Err { error: "Body read fail".into(), details: Some(e.to_string()) })))?;
    let mut r = client.request(method, format!("{url}{path}{q}"));
    for (k, v) in hdrs.iter() { if k != "host" { r = r.header(k, v); } }
    let resp = r.body(body).send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, Json(Err { error: "Upstream unavailable".into(), details: Some(e.to_string()) })))?;
    let st = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let rh = resp.headers().clone();
    let rb = resp.bytes().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, Json(Err { error: "Read fail".into(), details: Some(e.to_string()) })))?;
    let mut b = Response::builder().status(st);
    for (k, v) in rh.iter() { b = b.header(k, v); }
    b.body(Body::from(rb))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(Err { error: "Build fail".into(), details: Some(e.to_string()) })))
}

async fn proxy_core(
    State(s): State<Arc<AppState>>, req: Request,
) -> Result<Response, (StatusCode, Json<Err>)> {
    forward(&s.core_url, req).await
}
