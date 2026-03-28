'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Generation {
  id: string;
  prompt: string;
  lol_source: string;
  triangle_count: number;
  vertex_count: number;
  quality: string;
  status: string;
  error: string | null;
  created_at: string;
}

export default function HistoryPage() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('generations')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) setGenerations(data);
      } catch {
        // Supabase not configured yet
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Generation History</h1>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : generations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No generations yet. Go to Generate to create your first .3mf.</p>
      ) : (
        <div className="space-y-3">
          {generations.map((g) => (
            <div key={g.id} className={`border rounded-lg p-4 ${g.status === 'error' ? 'border-red-300' : 'border-border'}`}>
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{g.prompt}</p>
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                    <span>{new Date(g.created_at).toLocaleString()}</span>
                    <span className="capitalize">{g.quality}</span>
                    {g.triangle_count > 0 && <span>{g.triangle_count.toLocaleString()} triangles</span>}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${g.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
                  {g.status}
                </span>
              </div>
              {g.lol_source && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-muted-foreground">LOL Source</summary>
                  <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto max-h-32">{g.lol_source}</pre>
                </details>
              )}
              {g.error && <p className="text-xs text-red-500 mt-1">{g.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
