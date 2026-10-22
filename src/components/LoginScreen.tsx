import React, { useState } from 'react';
import { Camera, ShieldCheck, KeyRound, Loader2, ArrowRight, Shield, UserCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { toast } from 'sonner';

interface LoginScreenProps {
  onLoginSuccess: (role: 'operador' | 'gerente' | 'dono', userName: string) => void;
}

const PRESET_ACCOUNTS = [
  {
    role: 'operador' as const,
    label: 'Quiosque (Fotógrafos)',
    email: 'quiosque@setland.com.br',
    icon: Camera,
    desc: 'Ingestão SD, Vitrine e PDV'
  },
  {
    role: 'gerente' as const,
    label: 'Gerência Operacional',
    email: 'gerente@setland.com.br',
    icon: ShieldCheck,
    desc: 'Pacotes, Equipe e Relatórios'
  },
  {
    role: 'dono' as const,
    label: 'Diretoria / Dono',
    email: 'dono@setland.com.br',
    icon: Shield,
    desc: 'Acesso Global e Configurações'
  }
];

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [selectedRole, setSelectedRole] = useState<'operador' | 'gerente' | 'dono' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSelectPreset = (preset: typeof PRESET_ACCOUNTS[0]) => {
    setSelectedRole(preset.role);
    setEmail(preset.email);
    setPassword('');
    setErrorMsg(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password) {
      setErrorMsg('Informe o e-mail e a senha de acesso.');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error('Usuário não localizado no banco de dados.');
      }

      // Consulta a role oficial na tabela system_users
      const { data: profile, error: profError } = await supabase
        .from('system_users')
        .select('name, role')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profError) {
        console.warn('Aviso ao consultar perfil:', profError);
      }

      const resolvedRole = (profile?.role || data.user.user_metadata?.role || 'operador') as 'operador' | 'gerente' | 'dono';
      const resolvedName = profile?.name || data.user.user_metadata?.name || 'Operador';

      toast.success(`Bem-vindo, ${resolvedName}!`);
      onLoginSuccess(resolvedRole, resolvedName);
    } catch (err: any) {
      console.error('Falha detalhada de autenticação:', err);
      
      let friendlyMessage = 'Falha ao autenticar terminal.';
      if (err.message === 'Invalid login credentials') {
        friendlyMessage = 'Credenciais inválidas: Verifique o e-mail e a senha digitados.';
      } else if (err.status === 500 || err.message?.includes('Database error')) {
        friendlyMessage = 'Erro interno no Supabase Auth (500). Verifique a tabela auth.identities no banco.';
      } else if (err.message) {
        friendlyMessage = `Erro: ${err.message}`;
      }

      setErrorMsg(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-ink flex items-center justify-center p-4 relative overflow-hidden">
      {/* Faixa arrastável sob o titleBarOverlay do Windows (mesma altura de 38px do electron/main.ts) */}
      <div className="app-drag-region absolute inset-x-0 top-0 h-[38px] z-10" />
      {/* Glow Superior */}
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-brand-accent/20 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10 bg-brand-bg/80 backdrop-blur-xl border border-brand-ink/10 rounded-2xl shadow-2xl p-8">
        
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-brand-accent/10 rounded-full flex items-center justify-center mb-4">
            <UserCheck className="w-8 h-8 text-brand-accent" />
          </div>
          <h1 className="text-2xl font-bold mb-1">Setland Fotos</h1>
          <p className="text-brand-ink/60 text-sm">Terminal Desktop • Controle de Acesso</p>
        </div>

        {/* Seleção Rápida de Identidade */}
        <div className="grid grid-cols-3 gap-2 mb-8">
          {PRESET_ACCOUNTS.map((preset) => {
            const Icon = preset.icon;
            const isSelected = selectedRole === preset.role;
            return (
              <button
                key={preset.role}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`p-3 rounded-xl border text-center flex flex-col items-center justify-between transition-all duration-200 cursor-pointer ${
                  isSelected 
                    ? 'border-brand-accent bg-brand-accent/15 shadow-md shadow-brand-accent/20 text-brand-accent' 
                    : 'border-brand-ink/10 hover:bg-brand-ink/5 opacity-70 hover:opacity-100 text-brand-ink'
                }`}
              >
                <Icon className={`w-6 h-6 mb-2 ${isSelected ? 'text-brand-accent' : 'text-brand-ink/50'}`} />
                <span className="text-xs font-semibold">{preset.label.split(' ')[0]}</span>
                <span className="text-[9px] opacity-60 mt-1 uppercase tracking-wider">{preset.role}</span>
              </button>
            );
          })}
        </div>

        {/* Formulário de Login */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-brand-ink/60 mb-1.5 uppercase tracking-wider">
              E-mail Operacional
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              required
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl bg-brand-ink/5 border border-brand-ink/10 text-brand-ink placeholder-brand-ink/30 text-sm focus:outline-none focus:border-brand-accent/80 transition-all font-mono disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-ink/60 mb-1.5 uppercase tracking-wider">
              Senha de Acesso
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                required
                disabled={loading}
                className="w-full pl-4 pr-11 py-3 rounded-xl bg-brand-ink/5 border border-brand-ink/10 text-brand-ink placeholder-brand-ink/30 text-sm focus:outline-none focus:border-brand-accent/80 transition-all font-mono disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-ink/40 hover:text-brand-ink transition-colors p-1 cursor-pointer"
                title={showPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Banner de Erro Inline */}
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{errorMsg}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-brand-accent hover:bg-brand-accent/90 text-brand-bg font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-70"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Autenticando Terminal...
              </>
            ) : (
              <>
                Entrar no Sistema
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>
        
        <div className="mt-8 flex flex-col items-center justify-center gap-1.5 text-xs text-brand-ink/40">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span>Sessão segura vinculada ao hardware do terminal</span>
          </div>
          <span className="font-mono text-[11px] text-brand-ink/50">
            Setland Fotos • v{__APP_VERSION__}
          </span>
        </div>
      </div>
    </div>
  );
}
