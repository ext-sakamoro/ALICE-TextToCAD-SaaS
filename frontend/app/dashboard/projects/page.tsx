'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
interface Project { id: string; name: string; created_at: string; updated_at: string }
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  useEffect(() => { fetchProjects(); }, []);
  const fetchProjects = async () => { try { const supabase = createClient(); const { data } = await supabase.from('projects').select('*').order('updated_at', { ascending: false }); if (data) setProjects(data); } catch {} };
  const handleCreate = async () => { if (!newName.trim()) return; setCreating(true); try { const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return; const { data, error } = await supabase.from('projects').insert({ name: newName.trim(), owner_id: user.id, config: {} }).select().single(); if (error) throw error; if (data) router.push(`/dashboard/console?project=${data.id}`); } catch {} finally { setCreating(false); } };
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Projects</h1>
      <div className="flex gap-2">
        <input type="text" placeholder="New project name" value={newName} onChange={(e) => setNewName(e.target.value)} className="px-3 py-2 border border-input rounded-md bg-background text-sm flex-1 max-w-xs" />
        <button onClick={handleCreate} disabled={creating || !newName.trim()} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">{creating ? 'Creating...' : 'Create'}</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (<button key={p.id} onClick={() => router.push(`/dashboard/console?project=${p.id}`)} className="border border-border rounded-lg p-4 text-left hover:bg-accent transition-colors"><h3 className="font-semibold">{p.name}</h3><p className="text-xs text-muted-foreground mt-1">Updated {new Date(p.updated_at).toLocaleDateString()}</p></button>))}
        {projects.length === 0 && <p className="text-muted-foreground text-sm col-span-3">No projects yet.</p>}
      </div>
    </div>
  );
}
