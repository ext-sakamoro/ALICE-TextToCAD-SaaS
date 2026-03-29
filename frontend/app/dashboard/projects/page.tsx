'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/use-projects';

export default function ProjectsPage() {
  const { projects, loading, create, remove } = useProjects();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const p = await create(newName);
      router.push(`/dashboard/console?project=${p.id}`);
    } catch {
      // error
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    await remove(id);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Projects</h1>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="New project name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="px-3 py-2 border border-input rounded-md bg-background text-sm flex-1 max-w-xs"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/dashboard/console?project=${p.id}`)}
              className="border border-border rounded-lg p-4 text-left hover:bg-accent transition-colors group relative"
            >
              <h3 className="font-semibold">{p.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Updated {new Date(p.updated_at).toLocaleDateString()}
              </p>
              <span
                onClick={(e) => handleDelete(e, p.id)}
                className="absolute top-2 right-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 cursor-pointer"
              >
                Delete
              </span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="text-muted-foreground text-sm col-span-3">
              No projects yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
