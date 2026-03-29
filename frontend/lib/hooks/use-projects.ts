'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface Project {
  id: string;
  name: string;
  config: Record<string, unknown>;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });
      if (data) setProjects(data);
    } catch {
      // Supabase not configured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const create = useCallback(async (name: string) => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: name.trim(), owner_id: user.id, config: {} })
      .select()
      .single();
    if (error) throw error;
    setProjects((prev) => [data, ...prev]);
    return data as Project;
  }, []);

  const remove = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase.from('projects').delete().eq('id', id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    const supabase = createClient();
    await supabase
      .from('projects')
      .update({ name: name.trim() })
      .eq('id', id);
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)),
    );
  }, []);

  return { projects, loading, create, remove, rename, refresh: fetch_ };
}
