/**
 * Text-to-CAD API client
 * Worker URL is configured via NEXT_PUBLIC_WORKER_URL env var.
 */

const workerUrl = () =>
  process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8081';

export interface GenerateResult {
  jobId: string;
  lolSource: string;
  triangles: number;
  vertices: number;
  blob: Blob;
}

export interface GenerateError {
  jobId: string;
  lolSource: string;
  error: string;
}

export interface PreviewResult {
  jobId: string;
  lolSource: string;
  status: string;
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

/** Natural language prompt → .3mf binary */
export async function generate(
  prompt: string,
  quality: string,
): Promise<GenerateResult> {
  const resp = await fetch(`${workerUrl()}/api/v1/generate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ prompt, quality }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw {
      jobId: err.job_id || '',
      lolSource: err.lol_source || '',
      error: err.error || `HTTP ${resp.status}`,
    } as GenerateError;
  }

  return parseBinaryResponse(resp);
}

/** LOL DSL → .3mf binary (skip LLM) */
export async function generateFromLol(
  lolSource: string,
  quality: string,
): Promise<GenerateResult> {
  const resp = await fetch(`${workerUrl()}/api/v1/generate-lol`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ lol_source: lolSource, quality }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw {
      jobId: err.job_id || '',
      lolSource: err.lol_source || '',
      error: err.error || `HTTP ${resp.status}`,
    } as GenerateError;
  }

  return parseBinaryResponse(resp);
}

/** Preview (syntax check only, no mesh) */
export async function preview(
  prompt: string,
  quality: string,
): Promise<PreviewResult> {
  const resp = await fetch(`${workerUrl()}/api/v1/preview`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ prompt, quality }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw {
      jobId: data.job_id || '',
      lolSource: data.lol_source || '',
      error: data.error || `HTTP ${resp.status}`,
    } as GenerateError;
  }

  return {
    jobId: data.job_id,
    lolSource: data.lol_source || '',
    status: data.status,
  };
}

async function parseBinaryResponse(resp: Response): Promise<GenerateResult> {
  const jobId = resp.headers.get('X-Job-Id') || '';
  const triangles = parseInt(resp.headers.get('X-Triangle-Count') || '0', 10);
  const vertices = parseInt(resp.headers.get('X-Vertex-Count') || '0', 10);
  const lolSource = resp.headers.get('X-LOL-Source') || '';
  const blob = await resp.blob();

  return { jobId, lolSource, triangles, vertices, blob };
}
