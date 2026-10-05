import React from 'react';
import { Briefcase } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EmployeeModal({ isOpen, onClose }: EmployeeModalProps) {
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('Operador');
  const [pin, setPin] = React.useState('');
  const [email, setEmail] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('employees').insert({
      name,
      role,
      pin: role === 'Gerente' ? pin : null,
      email: role === 'Gerente' ? email : null,
      status: 'Ativo'
    });

    if (error) {
      toast.error('Erro ao cadastrar funcionário');
      return;
    }

    toast.success('Funcionário cadastrado com sucesso!');
    window.dispatchEvent(new CustomEvent('employee-created'));
    
    setName('');
    setRole('Operador');
    setPin('');
    setEmail('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-brand-surface border-border sm:max-w-lg sm:rounded-[2rem] p-8">
        <DialogHeader className="flex flex-col items-center text-center mt-2 mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5 border border-brand-accent/20">
            <Briefcase className="h-8 w-8" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground tracking-tight">Novo Funcionário</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm mt-2">
            Cadastre um novo membro na operação.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-ink ml-1 block">Nome Completo</label>
            <Input 
              type="text" 
              placeholder="Ex: João Silva"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl bg-background border-border"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-brand-ink ml-1 block">Cargo</label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full h-11 bg-background border border-border rounded-xl text-foreground focus:ring-brand-accent">
                  <SelectValue placeholder="Selecione o cargo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Operador">Operador</SelectItem>
                  <SelectItem value="Gerente">Gerente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-brand-ink ml-1 block">PIN de Acesso</label>
              <Input 
                type="password" 
                maxLength={6}
                placeholder="6 dígitos"
                required={role === 'Gerente'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="h-11 rounded-xl bg-background border-border font-mono tracking-widest"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-ink ml-1 block">E-mail <span className="text-brand-muted font-normal">(Opcional, apenas para Gerente)</span></label>
            <Input 
              type="email" 
              placeholder="gerente@setland.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl bg-background border-border"
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
              Salvar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
