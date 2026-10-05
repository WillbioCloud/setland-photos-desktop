import React, { useState, useEffect } from 'react';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (role: 'gerente' | 'dono') => void;
}

export default function AdminLoginModal({ isOpen, onClose, onLoginSuccess }: AdminLoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Limpa os campos e mensagens sempre que o modal for reaberto
  useEffect(() => {
    if (isOpen) {
      setEmail('');
      setPassword('');
      setErrorMsg(null);
      setLoading(false);
    }
  }, [isOpen]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password) {
      setErrorMsg('Informe o e-mail e a senha gerencial.');
      return;
    }

    setLoading(true);

    try {
      // 1. Autentica a nova sessão com as credenciais fornecidas
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (error) throw error;
      if (!data.user) throw new Error('Usuário não localizado no banco de dados.');

      // 2. Consulta o cargo oficial cadastrado
      const { data: profile, error: profileErr } = await supabase
        .from('system_users')
        .select('name, role')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileErr) throw profileErr;

      const role = profile?.role;

      // 3. Validação estrita: somente 'gerente' ou 'dono' podem elevar privilégios
      if (role !== 'gerente' && role !== 'dono') {
        throw new Error('Acesso recusado: esta conta não possui cargo de Gerente ou Dono.');
      }

      toast.success(`Acesso gerencial concedido: ${profile.name}`);
      onLoginSuccess(role);
      onClose();
    } catch (err: any) {
      console.error('Falha de elevação gerencial:', err);
      let friendly = 'Falha ao autenticar acesso gerencial.';
      if (err.message === 'Invalid login credentials') {
        friendly = 'E-mail ou senha incorretos.';
      } else if (err.message) {
        friendly = err.message;
      }
      setErrorMsg(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-brand-surface border-border sm:max-w-md sm:rounded-[2rem] p-8">
        <DialogHeader className="flex flex-col items-center text-center mt-2 mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5 border border-brand-accent/20">
            <Lock className="h-8 w-8" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground tracking-tight">Acesso Restrito</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm mt-2">
            Insira suas credenciais de Gerente ou Dono para acessar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-ink ml-1 block">E-mail</label>
            <Input 
              type="email" 
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 rounded-xl bg-background border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-ink ml-1 block">Senha</label>
            <Input 
              type="password" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 rounded-xl bg-background border-border font-mono tracking-widest"
            />
          </div>

          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{errorMsg}</p>
            </div>
          )}

          <div className="pt-5 flex gap-3">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl font-medium text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors text-sm border border-transparent"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 bg-brand-accent text-brand-accent-fg rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm shadow-sm disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validando...
                </>
              ) : (
                'Desbloquear'
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
