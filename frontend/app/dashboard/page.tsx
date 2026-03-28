'use client';
import { useState, lazy, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';

const ModelPreview = lazy(() => import('./components/ModelPreview'));

interface GenerateResult {
  jobId: string;
  lolSource: string;
  triangles: number;
  vertices: number;
  error?: string;
}

export default function DashboardPage() {
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState('high');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [lolMode, setLolMode] = useState(false);
  const [lolSource, setLolSource] = useState('');
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8081';

  const saveGeneration = async (gen: {
    prompt: string;
    lol_source: string;
    triangle_count: number;
    vertex_count: number;
    quality: string;
    status: string;
    error: string | null;
  }) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('generations').insert({ ...gen, user_id: user.id });
    } catch {
      // Supabase not configured — skip silently
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);
    setPreviewBlob(null);
    try {
      const endpoint = lolMode ? '/api/v1/generate-lol' : '/api/v1/generate';
      const body = lolMode
        ? { lol_source: lolSource, quality }
        : { prompt, quality };

      const resp = await fetch(`${workerUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json();
        const errResult = {
          jobId: err.job_id || '',
          lolSource: err.lol_source || '',
          triangles: 0,
          vertices: 0,
          error: err.error || `HTTP ${resp.status}`,
        };
        setResult(errResult);
        await saveGeneration({
          prompt: lolMode ? `[LOL] ${lolSource.slice(0, 200)}` : prompt,
          lol_source: err.lol_source || '',
          triangle_count: 0,
          vertex_count: 0,
          quality,
          status: 'error',
          error: errResult.error || null,
        });
        return;
      }

      const jobId = resp.headers.get('X-Job-Id') || '';
      const triangles = parseInt(resp.headers.get('X-Triangle-Count') || '0', 10);
      const vertices = parseInt(resp.headers.get('X-Vertex-Count') || '0', 10);
      const lol = resp.headers.get('X-LOL-Source') || '';

      const blob = await resp.blob();
      setPreviewBlob(blob);
      setResult({ jobId, lolSource: lol, triangles, vertices });

      await saveGeneration({
        prompt: lolMode ? `[LOL] ${lolSource.slice(0, 200)}` : prompt,
        lol_source: lol,
        triangle_count: triangles,
        vertex_count: vertices,
        quality,
        status: 'completed',
        error: null,
      });
    } catch (e) {
      setResult({
        jobId: '',
        lolSource: '',
        triangles: 0,
        vertices: 0,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!previewBlob || !result) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.jobId}.3mf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Text-to-CAD</h1>
      <p className="text-sm text-muted-foreground">
        Describe what you want to 3D print. The AI generates a mathematically precise .3mf file.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setLolMode(false)}
              className={`px-3 py-1 text-sm rounded-md ${!lolMode ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              Natural Language
            </button>
            <button
              onClick={() => setLolMode(true)}
              className={`px-3 py-1 text-sm rounded-md ${lolMode ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              LOL DSL
            </button>
          </div>

          {lolMode ? (
            <textarea
              value={lolSource}
              onChange={(e) => setLolSource(e.target.value)}
              placeholder={'smooth_union {\n  sphere { radius: 20 }\n  translate {\n    cylinder { radius: 8, height: 30 }\n    offset: [0, 15, 0]\n  }\n  k: 5\n}'}
              rows={10}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm font-mono"
            />
          ) : (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A phone stand with a 15 degree angle and a cable hole at the back"
              rows={4}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
            />
          )}

          {/* Quality */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Quality:</label>
            {['preview', 'high', 'ultra'].map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`px-3 py-1 text-sm rounded-md capitalize ${quality === q ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              >
                {q}
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || (!lolMode && !prompt.trim()) || (lolMode && !lolSource.trim())}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate .3mf'}
          </button>
        </div>

        {/* Right: Preview */}
        <div className="space-y-4">
          <Suspense fallback={<div className="w-full h-80 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground">Loading 3D viewer...</div>}>
            <ModelPreview blob={previewBlob} />
          </Suspense>

          {result && !result.error && (
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground space-x-4">
                <span>{result.triangles.toLocaleString()} triangles</span>
                <span>{result.vertices.toLocaleString()} vertices</span>
              </div>
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
              >
                Download .3mf
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Result / Error */}
      {result && (
        <div className={`border rounded-lg p-4 ${result.error ? 'border-red-500 bg-red-50 dark:bg-red-950' : 'border-green-500 bg-green-50 dark:bg-green-950'}`}>
          {result.error ? (
            <div>
              <p className="font-medium text-red-700 dark:text-red-300">Error</p>
              <p className="text-sm mt-1">{result.error}</p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-green-700 dark:text-green-300">Generated successfully</p>
              {result.lolSource && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-muted-foreground">LOL Source</summary>
                  <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto max-h-32">{result.lolSource}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground border-t pt-4">
        Target: Bambu Lab H2D (315 x 310 x 315 mm) | Powered by ALICE SDF Engine
      </div>
    </div>
  );
}
