import React, { useState, useEffect, useRef } from 'react';
import { Camera, ShieldCheck, KeyRound, Loader2, ArrowRight, Shield, UserCheck, AlertCircle, Eye, EyeOff, Store } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { toast } from 'sonner';

export type UserRole = 'operador' | 'gerente' | 'dono' | 'lojinha';

interface LoginScreenProps {
  onLoginSuccess: (role: UserRole, userName: string) => void;
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
    role: 'lojinha' as const,
    label: 'Caixa da Lojinha',
    email: 'lojinha@setland.com.br',
    icon: Store,
    desc: 'Recebimento de Pedidos e Caixa'
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
  // Lê credenciais salvas no localStorage
  const savedCreds = (() => {
    try {
      const raw = localStorage.getItem('setland_saved_credentials');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [selectedRole, setSelectedRole] = useState<UserRole | null>(() => savedCreds?.role || null);
  const [email, setEmail] = useState(() => savedCreds?.email || '');
  const [password, setPassword] = useState(() => savedCreds?.password || '');
  const [rememberCredentials, setRememberCredentials] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  // Foco inteligente ao inicializar com credenciais salvas
  useEffect(() => {
    if (email && password) {
      submitButtonRef.current?.focus();
    } else if (email) {
      passwordInputRef.current?.focus();
    }
  }, []);

  // Atalho global: Se o usuário abrir o app com as credenciais salvas, apertar Enter submete o login
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        if (email.trim() && password) {
          const form = document.getElementById('login-form') as HTMLFormElement | null;
          if (form) {
            e.preventDefault();
            form.requestSubmit();
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [email, password, loading]);

  const handleSelectPreset = (preset: typeof PRESET_ACCOUNTS[0]) => {
    setSelectedRole(preset.role);
    setEmail(preset.email);
    setErrorMsg(null);

    // Se o preset clicado for o mesmo salvo no localStorage, restaura a senha salva; senão limpa
    try {
      const raw = localStorage.getItem('setland_saved_credentials');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.email === preset.email && saved?.password) {
          setPassword(saved.password);
          return;
        }
      }
    } catch {}

    setPassword('');
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

      const resolvedRole = (profile?.role || data.user.user_metadata?.role || selectedRole || 'operador') as UserRole;
      const resolvedName = profile?.name || data.user.user_metadata?.name || 'Operador';

      // Salva ou remove credenciais do localStorage conforme checkbox
      if (rememberCredentials) {
        localStorage.setItem('setland_saved_credentials', JSON.stringify({
          role: resolvedRole,
          email: email.trim(),
          password
        }));
      } else {
        localStorage.removeItem('setland_saved_credentials');
      }

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
    <div className="flex-1 w-full bg-brand-bg text-brand-ink flex items-center justify-center p-4 relative overflow-hidden">
      {/* Glow Superior */}
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-brand-accent/20 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-lg relative z-10 bg-brand-bg/80 backdrop-blur-xl border border-brand-ink/10 rounded-2xl shadow-2xl p-8">
        
        {/* Branding */}
        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 bg-brand-accent/10 rounded-full flex items-center justify-center mb-3">
            <UserCheck className="w-8 h-8 text-brand-accent" />
          </div>
          <h1 className="text-2xl font-bold mb-1">Setland Fotos</h1>
          <p className="text-brand-ink/60 text-sm">Terminal Desktop • Controle de Acesso</p>
        </div>

        {/* Seleção Rápida de Identidade (4 Presets) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
          {PRESET_ACCOUNTS.map((preset) => {
            const Icon = preset.icon;
            const isSelected = selectedRole === preset.role;
            return (
              <button
                key={preset.role}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`p-2.5 rounded-xl border text-center flex flex-col items-center justify-between transition-all duration-200 cursor-pointer ${
                  isSelected 
                    ? 'border-brand-accent bg-brand-accent/15 shadow-md shadow-brand-accent/20 text-brand-accent' 
                    : 'border-brand-ink/10 hover:bg-brand-ink/5 opacity-70 hover:opacity-100 text-brand-ink'
                }`}
              >
                <Icon className={`w-5 h-5 mb-1.5 ${isSelected ? 'text-brand-accent' : 'text-brand-ink/50'}`} />
                <span className="text-[11px] font-semibold leading-tight">{preset.label.split(' ')[0]}</span>
                <span className="text-[8px] opacity-60 mt-1 uppercase tracking-wider">{preset.role}</span>
              </button>
            );
          })}
        </div>

        {/* Formulário de Login */}
        <form id="login-form" onSubmit={handleLogin} className="space-y-4">
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
              className="w-full px-4 py-2.5 rounded-xl bg-brand-ink/5 border border-brand-ink/10 text-brand-ink placeholder-brand-ink/30 text-sm focus:outline-none focus:border-brand-accent/80 transition-all font-mono disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-ink/60 mb-1.5 uppercase tracking-wider">
              Senha de Acesso
            </label>
            <div className="relative">
              <input
                ref={passwordInputRef}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                required
                disabled={loading}
                className="w-full pl-4 pr-11 py-2.5 rounded-xl bg-brand-ink/5 border border-brand-ink/10 text-brand-ink placeholder-brand-ink/30 text-sm focus:outline-none focus:border-brand-accent/80 transition-all font-mono disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-ink/40 hover:text-brand-ink transition-colors p-1 cursor-pointer"
                title={showPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Checkbox: Lembrar senha neste computador */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-brand-ink/75 hover:text-brand-ink">
              <input
                type="checkbox"
                checked={rememberCredentials}
                onChange={(e) => setRememberCredentials(e.target.checked)}
                className="w-4 h-4 rounded border-brand-ink/20 text-brand-accent focus:ring-brand-accent/30 cursor-pointer accent-amber-500"
              />
              <span>Lembrar login e senha neste computador</span>
            </label>
          </div>

          {/* Banner de Erro Inline */}
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{errorMsg}</p>
            </div>
          )}

          <button
            ref={submitButtonRef}
            type="submit"
            disabled={loading}
            className="w-full mt-5 bg-brand-accent hover:bg-brand-accent/90 text-brand-bg font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-70 cursor-pointer"
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
        
        <div className="mt-6 flex flex-col items-center justify-center gap-1.5 text-xs text-brand-ink/40">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span>Sessão segura vinculada ao terminal</span>
          </div>
          <span className="font-mono text-[11px] text-brand-ink/50">
            Setland Fotos • v{__APP_VERSION__}
          </span>
        </div>
      </div>
    </div>
  );
}
