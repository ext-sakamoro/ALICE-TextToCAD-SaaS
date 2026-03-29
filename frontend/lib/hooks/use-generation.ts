'use client';
import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  generate,
  generateFromLol,
  type GenerateResult,
  type GenerateError,
} from '@/lib/api/client';

const PLAN_LIMITS: Record<string, number> = {
  Free: 5,
  Pro: 100,
  Enterprise: -1,
};

interface GenerationState {
  loading: boolean;
  result: (GenerateResult & { error?: undefined }) | null;
  error: GenerateError | null;
}

export function useGeneration() {
  const [state, setState] = useState<GenerationState>({
    loading: false,
    result: null,
    error: null,
  });

  const saveGeneration = useCallback(
    async (gen: {
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
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('generations').insert({ ...gen, user_id: user.id });
      } catch {
        // Supabase not configured
      }
    },
    [],
  );

  const run = useCallback(
    async (opts: {
      mode: 'natural' | 'lol';
      prompt: string;
      lolSource: string;
      quality: string;
    }) => {
      setState({ loading: true, result: null, error: null });
      const label =
        opts.mode === 'lol'
          ? `[LOL] ${opts.lolSource.slice(0, 200)}`
          : opts.prompt;

      try {
        // Check daily limit
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('plan')
            .eq('id', user.id)
            .single();
          const plan = profile?.plan || 'Free';
          const limit = PLAN_LIMITS[plan] ?? 5;
          if (limit !== -1) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const { count } = await supabase
              .from('generations')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .gte('created_at', startOfDay.toISOString());
            if ((count || 0) >= limit) {
              const err: GenerateError = {
                jobId: '',
                lolSource: '',
                error: `Daily limit reached (${count}/${limit}). Upgrade your plan for more generations.`,
              };
              setState({ loading: false, result: null, error: err });
              return null;
            }
          }
        }
        const res =
          opts.mode === 'lol'
            ? await generateFromLol(opts.lolSource, opts.quality)
            : await generate(opts.prompt, opts.quality);

        setState({ loading: false, result: res, error: null });
        await saveGeneration({
          prompt: label,
          lol_source: res.lolSource,
          triangle_count: res.triangles,
          vertex_count: res.vertices,
          quality: opts.quality,
          status: 'completed',
          error: null,
        });
        return res;
      } catch (e) {
        const err =
          e && typeof e === 'object' && 'error' in e
            ? (e as GenerateError)
            : {
                jobId: '',
                lolSource: '',
                error: e instanceof Error ? e.message : 'Unknown error',
              };
        setState({ loading: false, result: null, error: err });
        await saveGeneration({
          prompt: label,
          lol_source: err.lolSource || '',
          triangle_count: 0,
          vertex_count: 0,
          quality: opts.quality,
          status: 'error',
          error: err.error,
        });
        return null;
      }
    },
    [saveGeneration],
  );

  return { ...state, run };
}
