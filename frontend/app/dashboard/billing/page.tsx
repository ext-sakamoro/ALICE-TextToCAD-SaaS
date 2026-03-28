'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
const plans = [
  { name: 'Free', price: '$0/mo', features: ['5 generations/day', 'Preview quality', 'Community support'], priceId: '' },
  { name: 'Pro', price: '$19/mo', features: ['100 generations/day', 'High + Ultra quality', 'LOL DSL direct input', 'Priority support', 'Generation history'], priceId: 'price_pro' },
  { name: 'Enterprise', price: 'Custom', features: ['Unlimited generations', 'Self-hosted worker', 'Custom printer profiles', 'API access', 'SLA guarantee'], priceId: '' },
];
export default function BillingPage() {
  const [current, setCurrent] = useState('Free');
  const [usage, setUsage] = useState({ today: 0, limit: 5 });
  useEffect(() => { (async () => { try { const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return; const { data } = await supabase.from('profiles').select('plan').eq('id', user.id).single(); if (data) { setCurrent(data.plan || 'Free'); setUsage({ today: 0, limit: data.plan === 'Pro' ? 100 : 5 }); } } catch {} })(); }, []);
  const handleUpgrade = async (plan: typeof plans[0]) => {
    if (plan.name === 'Enterprise') { window.open('mailto:sakamoro@alicelaw.net?subject=Text-to-CAD%20Enterprise', '_blank'); return; }
    if (!plan.priceId) return;
    try { const r = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priceId: plan.priceId }) }); const { url } = await r.json(); if (url) window.location.href = url; } catch {}
  };
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      <div className="border rounded-lg p-4 max-w-md">
        <p className="text-sm text-muted-foreground">Today&apos;s usage</p>
        <p className="text-2xl font-bold">{usage.today} / {usage.limit} <span className="text-sm font-normal text-muted-foreground">generations</span></p>
        <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (usage.today / usage.limit) * 100)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
        {plans.map((p) => (
          <div key={p.name} className={`border rounded-lg p-6 space-y-4 ${current === p.name ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p className="text-2xl font-bold">{p.price}</p>
            <ul className="space-y-2">{p.features.map((f) => (<li key={f} className="text-sm text-muted-foreground flex items-center gap-2"><span className="text-primary">&#10003;</span>{f}</li>))}</ul>
            {current === p.name ? <p className="text-sm text-primary font-medium text-center">Current plan</p> : <button onClick={() => handleUpgrade(p)} className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{p.name === 'Enterprise' ? 'Contact Sales' : 'Upgrade'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
