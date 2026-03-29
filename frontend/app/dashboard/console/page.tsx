'use client';
import { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useGeneration } from '@/lib/hooks/use-generation';

const ModelPreview = lazy(() => import('../components/ModelPreview'));

interface Generation {
  id: string;
  prompt: string;
  lol_source: string;
  triangle_count: number;
  quality: string;
  status: string;
  created_at: string;
}

export default function ConsolePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <ConsoleInner />
    </Suspense>
  );
}

function ConsoleInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('project');
  const [projectName, setProjectName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [lolSource, setLolSource] = useState('');
  const [lolMode, setLolMode] = useState(false);
  const [quality, setQuality] = useState('high');
  const [history, setHistory] = useState<Generation[]>([]);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  const { loading, result, error, run } = useGeneration();

  useEffect(() => {
    if (!projectId) {
      router.push('/dashboard/projects');
      return;
    }
    (async () => {
      try {
        const supabase = createClient();
        const { data: project } = await supabase
          .from('projects')
          .select('name')
          .eq('id', projectId)
          .single();
        if (project) setProjectName(project.name);

        const { data: gens } = await supabase
          .from('generations')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20);
        if (gens) setHistory(gens);
      } catch {
        // Supabase not configured
      }
    })();
  }, [projectId, router]);

  const handleGenerate = async () => {
    const res = await run({
      mode: lolMode ? 'lol' : 'natural',
      prompt,
      lolSource,
      quality,
    });
    if (res) {
      setPreviewBlob(res.blob);
      setHistory((prev) => [
        {
          id: res.jobId,
          prompt: lolMode ? `[LOL] ${lolSource.slice(0, 100)}` : prompt,
          lol_source: res.lolSource,
          triangle_count: res.triangles,
          quality,
          status: 'completed',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
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
    <div className="flex h-full">
      {/* Left panel: editor */}
      <div className="flex-1 flex flex-col border-r border-border">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/projects')}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            &larr; Projects
          </button>
          <h1 className="text-lg font-semibold">{projectName || 'Project'}</h1>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-auto">
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
              rows={12}
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

          {/* Error display */}
          {error && (
            <div className="border border-red-500 bg-red-50 dark:bg-red-950 rounded-lg p-4">
              <p className="font-medium text-red-700 dark:text-red-300">Error</p>
              <p className="text-sm mt-1">{error.error}</p>
            </div>
          )}

          {/* Success display */}
          {result && (
            <div className="border border-green-500 bg-green-50 dark:bg-green-950 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-green-700 dark:text-green-300">Generated</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.triangles.toLocaleString()} triangles / {result.vertices.toLocaleString()} vertices
                  </p>
                </div>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
                >
                  Download .3mf
                </button>
              </div>
              {result.lolSource && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-muted-foreground">LOL Source</summary>
                  <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto max-h-32">{result.lolSource}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: 3D preview + history */}
      <div className="w-96 flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold">3D Preview</h2>
        </div>
        <div className="p-4">
          <Suspense fallback={<div className="w-full h-64 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground">Loading viewer...</div>}>
            <ModelPreview blob={previewBlob} />
          </Suspense>
        </div>

        <div className="flex-1 p-4 border-t border-border overflow-auto">
          <h2 className="text-sm font-semibold mb-3">Recent Generations</h2>
          <div className="space-y-2">
            {history.map((g) => (
              <div key={g.id} className={`border rounded-md p-3 text-xs ${g.status === 'completed' ? 'border-border' : 'border-red-300'}`}>
                <p className="truncate font-medium">{g.prompt}</p>
                <div className="flex gap-3 mt-1 text-muted-foreground">
                  <span className="capitalize">{g.quality}</span>
                  {g.triangle_count > 0 && <span>{g.triangle_count.toLocaleString()} tri</span>}
                  <span>{new Date(g.created_at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
            {history.length === 0 && (
              <p className="text-muted-foreground text-xs">No generations yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
