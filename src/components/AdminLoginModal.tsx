import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (role: 'gerente' | 'dono') => void;
}

export default function AdminLoginModal({ isOpen, onClose, onLoginSuccess }: AdminLoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === 'dono@setland.com') {
      onLoginSuccess('dono');
    } else if (email === 'gerente@setland.com') {
      onLoginSuccess('gerente');
    }
    onClose();
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
              className="flex-1 py-3 px-4 bg-brand-accent text-brand-accent-fg rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm shadow-sm"
            >
              Entrar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
