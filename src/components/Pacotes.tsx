import React, { useState } from 'react';
import { Search, Plus, Lock, Image as ImageIcon, Camera, Edit2, Power, PowerOff } from 'lucide-react';
import PackageModal from './PackageModal';
import { supabase } from '@/lib/supabaseClient';

interface PacotesProps {
  userRole: 'operador' | 'gerente' | 'dono';
}

export default function Pacotes({ userRole }: PacotesProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [packagesList, setPackagesList] = useState<any[]>([]);
  
  const loadPackages = async () => {
    const { data } = await supabase.from('packages').select('*').order('created_at', { ascending: true });
    if (data) {
      setPackagesList(data.map(p => ({
        ...p,
        desc: p.description,
        icon: p.category === 'Avulsa' ? ImageIcon : Camera
      })));
    }
  };

  React.useEffect(() => {
    loadPackages();
    window.addEventListener('package-created', loadPackages);
    return () => window.removeEventListener('package-created', loadPackages);
  }, []);

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    await supabase.from('packages').update({ active: !currentActive }).eq('id', id);
    loadPackages();
  };

  const isAdminAuth = userRole === 'gerente' || userRole === 'dono';
  
  const filtered = packagesList.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-brand-ink">Gestão de Pacotes</h2>
          <p className="text-brand-muted text-sm mt-1">Configure os preços e os produtos oferecidos no Frente de Caixa.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-muted" />
            <input 
              type="text" 
              placeholder="Buscar pacote..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-4 py-2.5 bg-brand-surface shadow-sm rounded-full text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all w-64 border border-transparent"
            />
          </div>
          
          {isAdminAuth && (
            <button 
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand-accent text-brand-accent-fg rounded-full text-sm font-semibold transition-colors shadow-sm hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Novo Pacote
            </button>
          )}
        </div>
      </div>

      {/* Modo Leitura Banner */}
      {!isAdminAuth && (
        <div className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-2xl p-5 shadow-sm animate-in fade-in duration-300">
          <div className="p-2 rounded-full bg-brand-bg">
            <Lock className="h-5 w-5 text-brand-muted" />
          </div>
          <p className="text-sm font-medium text-brand-muted">
            <strong className="text-brand-ink font-semibold">Modo Leitura ativo.</strong> A criação e edição de pacotes é restrita a gerentes. Faça login no cadeado acima para editar.
          </p>
        </div>
      )}

      {/* Grid de Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(pkg => {
          const Icon = pkg.icon;
          return (
            <div 
              key={pkg.id} 
              className={`flex flex-col bg-brand-surface rounded-[2rem] border border-brand-border shadow-sm p-6 transition-all ${pkg.active ? 'opacity-100 hover:shadow-md' : 'opacity-50 grayscale'}`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="w-14 h-14 rounded-2xl bg-brand-accent/10 flex items-center justify-center text-brand-accent border border-brand-accent/20">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="px-3 py-1 bg-brand-bg rounded-full text-xs font-medium text-brand-muted border border-brand-border">
                  {pkg.category}
                </div>
              </div>

              <div className="flex-1">
                <h3 className="text-lg font-bold text-brand-ink leading-tight">{pkg.name}</h3>
                
                <div className="flex flex-wrap gap-2 mt-2">
                  {pkg.req_printed > 0 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      {pkg.req_printed} Impressa{pkg.req_printed > 1 ? 's' : ''}
                    </span>
                  )}
                  {pkg.req_digital > 0 && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                      {pkg.req_digital} Digital{pkg.req_digital > 1 ? 'is' : ''}
                    </span>
                  )}
                  {(pkg.req_printed === 0 && pkg.req_digital === 0 && pkg.category === 'Combo') && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      S/ Regra Definida
                    </span>
                  )}
                </div>

                <p className="text-sm text-brand-muted mt-2 line-clamp-2">{pkg.desc}</p>
              </div>

              <div className="mt-6 flex items-end justify-between border-t border-brand-border-dashed pt-5">
                <div>
                  <p className="text-xs text-brand-muted mb-0.5">Preço base</p>
                  <p className="text-2xl font-bold font-mono text-brand-ink">
                    R$ {pkg.price.toFixed(2).replace('.', ',')}
                  </p>
                </div>
                
                {isAdminAuth && (
                  <div className="flex gap-2">
                    <button className="p-2.5 rounded-xl bg-brand-bg hover:bg-brand-accent/10 hover:text-brand-accent text-brand-muted transition-colors border border-brand-border shadow-sm">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => handleToggleActive(pkg.id, pkg.active)}
                      className={`p-2.5 rounded-xl bg-brand-bg transition-colors border border-brand-border shadow-sm ${pkg.active ? 'hover:bg-brand-danger/10 hover:text-brand-danger text-brand-muted' : 'hover:bg-emerald-500/10 hover:text-emerald-600 text-brand-muted'}`}
                    >
                      {pkg.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <PackageModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
