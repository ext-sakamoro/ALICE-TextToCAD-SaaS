'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
const plans = [
  { name: 'Free', price: '$0/mo', features: ['5 projects', '100 API calls/hr', 'Community support'] },
  { name: 'Pro', price: '$49/mo', features: ['100 projects', '10,000 API calls/hr', 'Priority support', 'Advanced features'] },
  { name: 'Enterprise', price: 'Custom', features: ['Unlimited projects', 'Unlimited API calls', 'Dedicated support', 'SLA guarantee', 'Custom deployment'] },
];
export default function BillingPage() {
  const [current, setCurrent] = useState('Free');
  useEffect(() => { (async () => { try { const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return; const { data } = await supabase.from('profiles').select('plan').eq('id', user.id).single(); if (data) setCurrent(data.plan || 'Free'); } catch {} })(); }, []);
  const handleUpgrade = async (plan: string) => {
    if (plan === 'Enterprise') { window.open('mailto:sales@alice-platform.com?subject=Enterprise%20Plan', '_blank'); return; }
    try { const r = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) }); const { url } = await r.json(); if (url) window.location.href = url; } catch {}
  };
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
        {plans.map((p) => (
          <div key={p.name} className={`border rounded-lg p-6 space-y-4 ${current === p.name ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p className="text-2xl font-bold">{p.price}</p>
            <ul className="space-y-2">{p.features.map((f) => (<li key={f} className="text-sm text-muted-foreground flex items-center gap-2"><span className="text-primary">&#10003;</span>{f}</li>))}</ul>
            {current === p.name ? <p className="text-sm text-primary font-medium text-center">Current plan</p> : <button onClick={() => handleUpgrade(p.name)} className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">{p.name === 'Enterprise' ? 'Contact Sales' : 'Upgrade'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
